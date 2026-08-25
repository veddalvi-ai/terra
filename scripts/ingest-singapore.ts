/**
 * Milestone 2: HDB resale + rental (data.gov.sg) -> region / transaction / region_summary.
 * Scoped to one town, last 12 months (same bounded-slice pattern as the UK/FR
 * connectors). This is the one source in coverage.md that gives buy AND rent
 * for the same geography — the whole point of this run is validating that a
 * real computed yield can come out the other end, not estimated.
 *
 * Source: data.gov.sg, resale d_8b84c4ee58e3cfc0ece0d773c8ca6abc,
 * rental d_c9f57187485a850908655db0e8cfe651. Open Data Licence, commercial OK.
 * Gotcha (coverage.md): HDB resale is public housing only (~80% of population);
 * private condos are a separate URA feed with different fields — not blended here.
 */
import { pool } from './lib/db';
import { ensureListingTypeColumn, insertTransactions, writeRegionSummaries, type TransactionRow } from './lib/transactions';
import { rollup, type RollupTransaction, type RegionParents } from '../lib/rollup';
import { geocodePlace } from './lib/nominatim';

const TOWN = 'TAMPINES';
const MONTHS_BACK = 12;
const RESALE_RESOURCE_ID = 'd_8b84c4ee58e3cfc0ece0d773c8ca6abc';
const RENTAL_RESOURCE_ID = 'd_c9f57187485a850908655db0e8cfe651';
const SOURCE = 'sg-data-gov';

function monthsAgo(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
const CUTOFF_MONTH = monthsAgo(MONTHS_BACK);

async function fetchJsonWithRetry(url: string, retries = 2): Promise<{ result: { records: Record<string, string>[] } }> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url);
    const json = await res.json();
    if (json?.result?.records) return json;
    if (attempt < retries) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
  throw new Error(`data.gov.sg request failed after ${retries + 1} attempts: ${url}`);
}

async function fetchRecent(
  resourceId: string,
  dateField: string
): Promise<Record<string, string>[]> {
  const all: Record<string, string>[] = [];
  let offset = 0;
  const limit = 1000;

  while (true) {
    const url =
      `https://data.gov.sg/api/action/datastore_search?resource_id=${resourceId}` +
      `&filters=${encodeURIComponent(JSON.stringify({ town: TOWN }))}` +
      `&sort=${encodeURIComponent(`${dateField} desc`)}&limit=${limit}&offset=${offset}`;
    const json = await fetchJsonWithRetry(url);
    const records: Record<string, string>[] = json.result.records;
    if (records.length === 0) break;

    await new Promise((r) => setTimeout(r, 300)); // be polite between pages

    let hitCutoff = false;
    for (const r of records) {
      if (r[dateField] < CUTOFF_MONTH) {
        hitCutoff = true;
        break;
      }
      all.push(r);
    }
    if (hitCutoff || records.length < limit) break;
    offset += limit;
  }
  return all;
}

function flatTypeToPropertyType(flatType: string): string {
  return `hdb-${flatType.toLowerCase().replace(/\s+/g, '-')}`;
}

async function main() {
  await ensureListingTypeColumn();

  console.log(`Fetching resale records for ${TOWN} since ${CUTOFF_MONTH}...`);
  const resale = await fetchRecent(RESALE_RESOURCE_ID, 'month');
  console.log(`${resale.length} resale transactions.`);

  console.log(`Fetching rental records for ${TOWN} since ${CUTOFF_MONTH}...`);
  const rental = await fetchRecent(RENTAL_RESOURCE_ID, 'rent_approval_date');
  console.log(`${rental.length} rental transactions.`);

  if (resale.length === 0 && rental.length === 0) {
    console.log('Nothing to ingest — check TOWN against the dataset.');
    await pool.end();
    return;
  }

  console.log(`Geocoding "${TOWN}, Singapore" via Nominatim...`);
  const sgCoords = await geocodePlace('Singapore');
  const townCoords = await geocodePlace(`${TOWN}, Singapore`);

  const existingCountry = await pool.query(
    `select id from region where level = 'country' and name = 'Singapore'`
  );
  const countryId =
    existingCountry.rows[0]?.id ??
    (
      await pool.query(
        `insert into region (level, name, country_code, parent_id, geom)
         values ('country', 'Singapore', 'SG', null, ST_SetSRID(ST_MakePoint($1, $2), 4326))
         returning id`,
        [sgCoords.lng, sgCoords.lat]
      )
    ).rows[0].id;

  const existingCity = await pool.query(
    `select id from region where level = 'city' and name = 'Singapore' and parent_id = $1`,
    [countryId]
  );
  const cityId =
    existingCity.rows[0]?.id ??
    (
      await pool.query(
        `insert into region (level, name, country_code, parent_id, geom)
         values ('city', 'Singapore', 'SG', $1, ST_SetSRID(ST_MakePoint($2, $3), 4326))
         returning id`,
        [countryId, sgCoords.lng, sgCoords.lat]
      )
    ).rows[0].id;

  const existingTown = await pool.query(
    `select id from region where level = 'area' and name = $1 and parent_id = $2`,
    [TOWN, cityId]
  );
  const townId =
    existingTown.rows[0]?.id ??
    (
      await pool.query(
        `insert into region (level, name, country_code, parent_id, geom)
         values ('area', $1, 'SG', $2, ST_SetSRID(ST_MakePoint($3, $4), 4326))
         returning id`,
        [TOWN, cityId, townCoords.lng, townCoords.lat]
      )
    ).rows[0].id;

  const parents: RegionParents = { [townId]: cityId, [cityId]: countryId, [countryId]: null };

  const saleRows: TransactionRow[] = resale.map((r) => ({
    regionId: townId,
    source: SOURCE,
    saleDate: `${r.month}-01`,
    price: Number(r.resale_price),
    currency: 'SGD',
    address: `${r.block} ${r.street_name}`,
    propertyType: flatTypeToPropertyType(r.flat_type),
    floorAreaSqm: r.floor_area_sqm ? Number(r.floor_area_sqm) : null,
    listingType: 'sale',
    externalId: `sg-resale-${r._id}`,
  }));

  const rentRows: TransactionRow[] = rental.map((r) => ({
    regionId: townId,
    source: SOURCE,
    saleDate: `${r.rent_approval_date}-01`,
    price: Number(r.monthly_rent),
    currency: 'SGD',
    address: `${r.block} ${r.street_name}`,
    propertyType: flatTypeToPropertyType(r.flat_type),
    floorAreaSqm: null,
    listingType: 'rent',
    externalId: `sg-rental-${r._id}`,
  }));

  console.log('Inserting transactions...');
  const insertedSale = await insertTransactions(saleRows);
  const insertedRent = await insertTransactions(rentRows);
  console.log(`Inserted ${insertedSale} sale + ${insertedRent} rent transactions.`);

  console.log('Computing region_summary rollups (sale and rent kept separate)...');
  const saleRollupInputs: RollupTransaction[] = resale.map((r) => ({
    regionId: townId,
    period: r.month,
    price: Number(r.resale_price),
  }));
  const rentRollupInputs: RollupTransaction[] = rental.map((r) => ({
    regionId: townId,
    period: r.rent_approval_date,
    price: Number(r.monthly_rent),
  }));
  const saleSummaries = rollup(saleRollupInputs, parents, 10);
  const rentSummaries = rollup(rentRollupInputs, parents, 10);
  await writeRegionSummaries(saleSummaries, 'sale');
  await writeRegionSummaries(rentSummaries, 'rent');
  console.log(`${saleSummaries.length} sale + ${rentSummaries.length} rent region_summary rows written.`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
