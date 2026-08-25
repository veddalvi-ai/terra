/**
 * Milestone 2: DVF (Demandes de valeurs foncières) -> region / transaction / region_summary.
 * Scoped to one arrondissement for the first real run (same bounded-slice
 * pattern as ingest-uk.ts). Unlike UK, DVF ships lon/lat directly — no
 * geocoding step needed. Unlike UK, DVF ships floor area (surface_reelle_bati).
 *
 * Source: https://files.data.gouv.fr/geo-dvf/latest/csv/{year}/departements/{dept}.csv.gz
 * Licence: Licence Ouverte 2.0.
 * Gotcha (coverage.md): excludes Alsace/Moselle/Mayotte; bundles house+garage+land
 * as one price for multi-lot sales — we don't attempt to separate them here.
 */
import { parse } from 'csv-parse/sync';
import zlib from 'node:zlib';
import { pool } from './lib/db';
import { ensureListingTypeColumn, insertTransactions, writeRegionSummaries, type TransactionRow } from './lib/transactions';
import { rollup, type RollupTransaction, type RegionParents } from '../lib/rollup';

const YEAR = '2025';
const DEPARTMENT = '75';
const COMMUNE_FILTER = 'Paris 4e Arrondissement';
const SOURCE = 'fr-dvf';

const CSV_URL = `https://files.data.gouv.fr/geo-dvf/latest/csv/${YEAR}/departements/${DEPARTMENT}.csv.gz`;

interface DvfRow {
  mutationId: string;
  saleDate: string;
  price: number;
  streetNumber: string;
  street: string;
  postcode: string;
  commune: string;
  propertyType: string;
  floorAreaSqm: number | null;
  lng: number;
  lat: number;
}

function parseDvf(csvText: string): DvfRow[] {
  const records: Record<string, string>[] = parse(csvText, { columns: true });
  const filtered = records.filter(
    (r) =>
      r.nature_mutation === 'Vente' &&
      (r.type_local === 'Maison' || r.type_local === 'Appartement') &&
      r.nom_commune === COMMUNE_FILTER &&
      r.longitude &&
      r.latitude
  );

  // A mutation (sale) can span multiple rows — one per lot — all sharing the
  // same id_mutation and the SAME total price. Counting each lot as its own
  // transaction would double-count the price. Keep one row per mutation.
  const seen = new Set<string>();
  const deduped: DvfRow[] = [];
  for (const r of filtered) {
    if (seen.has(r.id_mutation)) continue;
    seen.add(r.id_mutation);
    deduped.push({
      mutationId: r.id_mutation,
      saleDate: r.date_mutation,
      price: Number(r.valeur_fonciere),
      streetNumber: r.adresse_numero,
      street: r.adresse_nom_voie,
      postcode: r.code_postal,
      commune: r.nom_commune,
      propertyType: r.type_local === 'Maison' ? 'house' : 'flat',
      floorAreaSqm: r.surface_reelle_bati ? Number(r.surface_reelle_bati) : null,
      lng: Number(r.longitude),
      lat: Number(r.latitude),
    });
  }
  return deduped;
}

async function upsertRegion(
  level: 'country' | 'city' | 'area',
  name: string,
  countryCode: string,
  parentId: string | null,
  lng: number,
  lat: number
): Promise<string> {
  const existing = await pool.query(
    `select id from region where level = $1 and name = $2 and parent_id is not distinct from $3`,
    [level, name, parentId]
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const inserted = await pool.query(
    `insert into region (level, name, country_code, parent_id, geom)
     values ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326))
     returning id`,
    [level, name, countryCode, parentId, lng, lat]
  );
  return inserted.rows[0].id;
}

function saleQuarter(dateStr: string): string {
  const [year, month] = dateStr.split('-').map(Number);
  return `${year}-Q${Math.ceil(month / 3)}`;
}

async function main() {
  await ensureListingTypeColumn();

  console.log(`Fetching ${CSV_URL}...`);
  const gzBuffer = Buffer.from(await (await fetch(CSV_URL)).arrayBuffer());
  const csvText = zlib.gunzipSync(gzBuffer).toString('utf-8');
  const rows = parseDvf(csvText);
  console.log(`${rows.length} residential sales found in ${COMMUNE_FILTER}.`);

  if (rows.length === 0) {
    console.log('Nothing to ingest — check COMMUNE_FILTER against the CSV.');
    await pool.end();
    return;
  }

  const franceId = await upsertRegion('country', 'France', 'FR', null, 2.2137, 46.2276);
  // Centroid of the filtered rows — good enough for a single-commune "city" pin.
  const avgLng = rows.reduce((s, r) => s + r.lng, 0) / rows.length;
  const avgLat = rows.reduce((s, r) => s + r.lat, 0) / rows.length;
  const communeId = await upsertRegion('city', COMMUNE_FILTER, 'FR', franceId, avgLng, avgLat);

  const parents: RegionParents = { [communeId]: franceId, [franceId]: null };

  const txRows: TransactionRow[] = rows.map((r) => ({
    regionId: communeId,
    source: SOURCE,
    saleDate: r.saleDate,
    price: r.price,
    currency: 'EUR',
    address: [r.streetNumber, r.street].filter(Boolean).join(' '),
    propertyType: r.propertyType,
    floorAreaSqm: r.floorAreaSqm,
    listingType: 'sale',
    externalId: `fr-dvf-${r.mutationId}`,
  }));

  console.log('Inserting transactions...');
  const inserted = await insertTransactions(txRows);
  console.log(`Inserted ${inserted} new transactions (${rows.length - inserted} already present).`);

  console.log('Computing region_summary rollups...');
  const rollupInputs: RollupTransaction[] = rows.map((r) => ({
    regionId: communeId,
    period: saleQuarter(r.saleDate),
    price: r.price,
  }));
  const summaries = rollup(rollupInputs, parents, 10);
  await writeRegionSummaries(summaries, 'sale');
  console.log(`${summaries.length} region_summary rows written.`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
