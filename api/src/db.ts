import pg from 'pg';
import { config } from './config.js';

// Postgres returns BIGINT and COUNT as strings by default. Our ids never get
// near 2^53, so parse them as normal numbers.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
});

export type Db = pg.Pool | pg.PoolClient;

// Runs fn inside a transaction. Commits if fn succeeds, rolls back if it throws.
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
