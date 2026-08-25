import { pool } from './db';
import type { RollupResult } from '../../lib/rollup';

export interface TransactionRow {
  regionId: string;
  source: string;
  saleDate: string;
  price: number;
  currency: string;
  address: string | null;
  propertyType: string | null;
  floorAreaSqm: number | null;
  listingType: 'sale' | 'rent';
  externalId: string;
}

/** One-time, idempotent — safe to call at the top of every ingestion script. */
export async function ensureListingTypeColumn() {
  await pool.query(`alter table transaction add column if not exists external_id text unique`);
  await pool.query(
    `alter table transaction add column if not exists listing_type text not null default 'sale'`
  );
  await pool.query(
    `do $$ begin
       if not exists (select 1 from pg_constraint where conname = 'transaction_listing_type_check') then
         alter table transaction add constraint transaction_listing_type_check
           check (listing_type in ('sale', 'rent'));
       end if;
     end $$;`
  );

  // region_summary needs the same split — the Buy/Rent toggle (spec §3.3) queries
  // this table directly, and a sale median and a rent median must never collapse
  // into one row.
  await pool.query(
    `alter table region_summary add column if not exists listing_type text not null default 'sale'`
  );
  await pool.query(
    `do $$ begin
       if not exists (select 1 from pg_constraint where conname = 'region_summary_listing_type_check') then
         alter table region_summary add constraint region_summary_listing_type_check
           check (listing_type in ('sale', 'rent'));
       end if;
     end $$;`
  );
  await pool.query(`alter table region_summary drop constraint if exists region_summary_region_id_period_key`);
  await pool.query(
    `do $$ begin
       if not exists (select 1 from pg_constraint where conname = 'region_summary_region_period_type_key') then
         alter table region_summary add constraint region_summary_region_period_type_key
           unique (region_id, period, listing_type);
       end if;
     end $$;`
  );
}

/**
 * Batched multi-row insert, ON CONFLICT (external_id) DO NOTHING for idempotent
 * re-runs. Chunked to stay well under Postgres's parameter limit.
 */
export async function insertTransactions(rows: TransactionRow[], chunkSize = 500): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const values: unknown[] = [];
    const placeholders = chunk.map((r, idx) => {
      const base = idx * 10;
      values.push(
        r.regionId,
        r.source,
        r.saleDate,
        r.price,
        r.currency,
        r.address,
        r.propertyType,
        r.floorAreaSqm,
        r.listingType,
        r.externalId
      );
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10})`;
    });

    const res = await pool.query(
      `insert into transaction
         (region_id, source, sale_date, price, currency, address, property_type, floor_area_sqm, listing_type, external_id)
       values ${placeholders.join(',')}
       on conflict (external_id) do nothing
       returning id`,
      values
    );
    inserted += res.rowCount ?? 0;
  }
  return inserted;
}

export async function writeRegionSummaries(summaries: RollupResult[], listingType: 'sale' | 'rent') {
  for (const s of summaries) {
    await pool.query(
      `insert into region_summary (region_id, period, median_price, transaction_count, tier, listing_type)
       values ($1, $2, $3, $4, 'A', $5)
       on conflict (region_id, period, listing_type) do update
         set median_price = excluded.median_price, transaction_count = excluded.transaction_count`,
      [s.regionId, s.period, s.medianPrice, s.transactionCount, listingType]
    );
  }
}
