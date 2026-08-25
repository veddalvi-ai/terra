import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { currencyForCountry } from '@/lib/currency';

// Area card data for one region (spec §3.3) — the aggregate price, not a
// transaction ledger. transaction_count + period still satisfy guardrail 1
// ("never show a number without source count + date") without listing every
// individual sale.
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

  return NextResponse.json({
    region: { ...region.rows[0], currency: currencyForCountry(region.rows[0].country_code) },
    summaries: summaries.rows,
  });
}
