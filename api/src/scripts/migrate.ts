// Applies every .sql file in api/migrations that hasn't been applied yet, in name order.
// Applied migrations are recorded in the schema_migrations table.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../db.js';

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');

export async function migrate() {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);

  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
  const { rows } = await pool.query<{ name: string }>('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.name));

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(migrationsDir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`Applied ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  migrate()
    .then(() => {
      console.log('Migrations up to date');
      return pool.end();
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
