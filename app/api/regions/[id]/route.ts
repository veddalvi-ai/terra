import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { currencyForCountry } from '@/lib/currency';

// Area card + transaction-detail data for one region (spec §3.3, §3.4).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const region = await pool.query(
    `select id, name, level, country_code, ST_X(geom) as lng, ST_Y(geom) as lat
     from region where id = $1`,
    [id]
  );
  if (!region.rows[0]) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const summaries = await pool.query(
    `select period, listing_type, median_price, transaction_count, tier
     from region_summary where region_id = $1 order by period desc, listing_type`,
    [id]
  );

  // Guardrail 1: never show a price without the transaction record it came from.
  // Sale and rent are fetched separately, each with its own LIMIT — a region can
  // have hundreds of same-day sale rows that would otherwise crowd every rent
  // row out of a single shared LIMIT 20.
  const recentTransactions = (listingType: 'sale' | 'rent') =>
    pool.query(
      `select id, source, sale_date::text as sale_date, price, currency, address, property_type, floor_area_sqm, listing_type
       from transaction
       where region_id = $1 and listing_type = $2
       order by sale_date desc limit 20`,
      [id, listingType]
    );
  const [saleTx, rentTx] = await Promise.all([recentTransactions('sale'), recentTransactions('rent')]);

  return NextResponse.json({
    region: { ...region.rows[0], currency: currencyForCountry(region.rows[0].country_code) },
    summaries: summaries.rows,
    transactions: { sale: saleTx.rows, rent: rentTx.rows },
  });
}
