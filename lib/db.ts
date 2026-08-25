import { Pool } from 'pg';

declare global {
  // eslint-disable-next-line no-var
  var __terraPool: Pool | undefined;
}

// Reused across hot-reloads in dev so we don't open a new pool on every save.
export const pool =
  global.__terraPool ??
  new Pool({ connectionString: process.env.DATABASE_URL });

if (process.env.NODE_ENV === 'development') {
  global.__terraPool = pool;
}
