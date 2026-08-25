import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';

// spec §3.5 — address/city/country autocomplete -> flyTo(). A query with zero
// rows is a real answer ("no data here"), not an error.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get('q')?.trim();
  if (!q) return NextResponse.json([]);

  const result = await pool.query(
    `select id, name, level, country_code, ST_X(geom) as lng, ST_Y(geom) as lat
     from region where name ilike $1 order by level, name limit 10`,
    [`%${q}%`]
  );
  return NextResponse.json(result.rows);
}
