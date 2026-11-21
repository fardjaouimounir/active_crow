import pg from 'pg';
import { databaseUrl } from './client.js';

// Shared by the showcase CLI and pg-boss workers, within one PostgreSQL database.
const LOCK_KEY = 'fieldflow.showcase.replay';
const EXCLUSIVE = 'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired';
const SHARED = 'SELECT pg_try_advisory_lock_shared(hashtextextended($1, 0)) AS acquired';

export async function tryWithShowcaseLock(
  run,
  { exclusive = false, connectionString = databaseUrl } = {},
) {
  // Session-level locks need a dedicated connection and must not be returned to a pool.
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 5_000 });
  await client.connect();
  try {
    const {
      rows: [{ acquired }],
    } = await client.query(exclusive ? EXCLUSIVE : SHARED, [LOCK_KEY]);
    if (!acquired) return { acquired };
    return { acquired, value: await run() };
  } finally {
    await client.end();
  }
}
