import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { currencyForCountry } from '@/lib/currency';

// Every region that has at least one region_summary row — i.e. every pin the
// globe can actually show a price for. Level 'country' is excluded: country
// pins render from the static tier map in Milestone 4, not from live data.
export async function GET() {
  const result = await pool.query(`
    select
      r.id, r.name, r.level, r.country_code,
      ST_X(r.geom) as lng, ST_Y(r.geom) as lat,
      sale.median_price as sale_median, sale.transaction_count as sale_count,
      sale.period as sale_period, sale.tier as tier,
      rent.median_price as rent_median, rent.transaction_count as rent_count,
      rent.period as rent_period
    from region r
    left join lateral (
      select * from region_summary s
      where s.region_id = r.id and s.listing_type = 'sale'
      order by s.period desc limit 1
    ) sale on true
    left join lateral (
      select * from region_summary s
      where s.region_id = r.id and s.listing_type = 'rent'
      order by s.period desc limit 1
    ) rent on true
    where r.level in ('city', 'area') and (sale.median_price is not null or rent.median_price is not null)
  `);

  const rows = result.rows.map((r) => ({ ...r, currency: currencyForCountry(r.country_code) }));
  return NextResponse.json(rows);
}
