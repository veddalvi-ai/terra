/**
 * Milestone 1: HM Land Registry Price Paid Data -> region / transaction / region_summary.
 * Scoped to London for the first real run (context.md build sequence: prove the
 * pipeline shape on one bounded slice before widening). Widening to the full
 * monthly file is a filter change, not a rewrite — see TOWN_FILTER below.
 *
 * Source: https://www.gov.uk/government/statistical-data-sets/price-paid-data-downloads
 * Licence: OGL v3.0. No floor area in this source (coverage.md gotcha) —
 * floor_area_sqm is always null for UK transactions.
 */
import { parse } from 'csv-parse/sync';
import { pool } from './lib/db';
import { ensureListingTypeColumn, insertTransactions, writeRegionSummaries, type TransactionRow } from './lib/transactions';
import { rollup, type RollupTransaction, type RegionParents } from '../lib/rollup';

const CSV_URL = 'https://price-paid-data.publicdata.landregistry.gov.uk/pp-monthly-update-new-version.csv';
const TOWN_FILTER = 'LONDON';
const SOURCE = 'uk-hmlr';

const PROPERTY_TYPES: Record<string, string> = {
  D: 'detached',
  S: 'semi-detached',
  T: 'terraced',
  F: 'flat',
  O: 'other',
};

interface PricePaidRow {
  id: string;
  price: number;
  saleDate: string; // YYYY-MM-DD
  postcode: string;
  propertyType: string;
  paon: string;
  saon: string;
  street: string;
  town: string;
  district: string;
  county: string;
}

function parseCsv(csvText: string): PricePaidRow[] {
  const rows: string[][] = parse(csvText, { relax_quotes: true });
  return rows
    .map((r) => ({
      id: r[0],
      price: Number(r[1]),
      saleDate: r[2].slice(0, 10),
      postcode: r[3],
      propertyType: PROPERTY_TYPES[r[4]] ?? 'other',
      paon: r[7],
      saon: r[8],
      street: r[9],
      town: r[11],
      district: r[12],
      county: r[13],
    }))
    .filter((r) => r.town === TOWN_FILTER && r.postcode);
}

interface Geocode {
  lat: number;
  lng: number;
  adminDistrict: string;
}

async function geocodePostcodes(postcodes: string[]): Promise<Map<string, Geocode>> {
  const result = new Map<string, Geocode>();
  const unique = Array.from(new Set(postcodes));

  for (let i = 0; i < unique.length; i += 100) {
    const batch = unique.slice(i, i + 100);
    const res = await fetch('https://api.postcodes.io/postcodes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postcodes: batch }),
    });
    const json = await res.json();
    for (const entry of json.result) {
      if (entry.result) {
        result.set(entry.query, {
          lat: entry.result.latitude,
          lng: entry.result.longitude,
          adminDistrict: entry.result.admin_district,
        });
      }
    }
    console.log(`  geocoded ${Math.min(i + 100, unique.length)}/${unique.length} postcodes`);
  }

  return result;
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
  const quarter = Math.ceil(month / 3);
  return `${year}-Q${quarter}`;
}

async function main() {
  await ensureListingTypeColumn();

  console.log(`Fetching ${CSV_URL}...`);
  const csvText = await (await fetch(CSV_URL)).text();
  const rows = parseCsv(csvText);
  console.log(`${rows.length} ${TOWN_FILTER} transactions found in monthly file.`);

  console.log('Geocoding postcodes via postcodes.io...');
  const geocodes = await geocodePostcodes(rows.map((r) => r.postcode));

  const ukId = await upsertRegion('country', 'United Kingdom', 'GB', null, -2.0, 54.0);
  const londonId = await upsertRegion('city', 'London', 'GB', ukId, -0.1276, 51.5072);

  const districtCentroids = new Map<string, { lng: number; lat: number; count: number }>();
  for (const row of rows) {
    const geo = geocodes.get(row.postcode);
    if (!geo) continue;
    const c = districtCentroids.get(geo.adminDistrict) ?? { lng: 0, lat: 0, count: 0 };
    c.lng += geo.lng;
    c.lat += geo.lat;
    c.count += 1;
    districtCentroids.set(geo.adminDistrict, c);
  }

  const areaIds = new Map<string, string>();
  const parents: RegionParents = { [londonId]: ukId, [ukId]: null };
  for (const [district, c] of districtCentroids) {
    const id = await upsertRegion('area', district, 'GB', londonId, c.lng / c.count, c.lat / c.count);
    areaIds.set(district, id);
    parents[id] = londonId;
  }

  const txRows: TransactionRow[] = [];
  const rollupInputs: RollupTransaction[] = [];
  for (const row of rows) {
    const geo = geocodes.get(row.postcode);
    if (!geo) continue;
    const areaId = areaIds.get(geo.adminDistrict);
    if (!areaId) continue;

    const address = [row.saon, row.paon, row.street].filter(Boolean).join(', ');
    txRows.push({
      regionId: areaId,
      source: SOURCE,
      saleDate: row.saleDate,
      price: row.price,
      currency: 'GBP',
      address,
      propertyType: row.propertyType,
      floorAreaSqm: null,
      listingType: 'sale',
      externalId: row.id,
    });
    rollupInputs.push({ regionId: areaId, period: saleQuarter(row.saleDate), price: row.price });
  }

  console.log('Inserting transactions...');
  const inserted = await insertTransactions(txRows);
  console.log(`Inserted ${inserted} new transactions (${rows.length - inserted} already present).`);

  console.log('Computing region_summary rollups...');
  const summaries = rollup(rollupInputs, parents, 10);
  await writeRegionSummaries(summaries, 'sale');
  console.log(`${summaries.length} region_summary rows written.`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
