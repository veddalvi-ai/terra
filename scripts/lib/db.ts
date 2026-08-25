import { Pool } from 'pg';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Check .env.local.');
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
