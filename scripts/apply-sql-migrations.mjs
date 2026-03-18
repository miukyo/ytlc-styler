import dotenv from 'dotenv';
dotenv.config();
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;

if (!connectionString) {
	throw new Error('Missing DATABASE_URL or SUPABASE_DB_URL.');
}

const migrationsDir = path.resolve(process.cwd(), 'migrations');
const migrationFiles = (await readdir(migrationsDir))
	.filter((name) => name.endsWith('.sql'))
	.sort((a, b) => a.localeCompare(b));

const pool = new Pool({ connectionString });
const client = await pool.connect();

try {
	await client.query(`
		CREATE TABLE IF NOT EXISTS public._app_migrations (
			name TEXT PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`);

	for (const migrationName of migrationFiles) {
		const alreadyApplied = await client.query(
			'SELECT 1 FROM public._app_migrations WHERE name = $1',
			[migrationName]
		);

		if (alreadyApplied.rowCount) {
			console.log(`[skip] ${migrationName}`);
			continue;
		}

		const migrationPath = path.join(migrationsDir, migrationName);
		const sql = await readFile(migrationPath, 'utf8');

		await client.query('BEGIN');
		try {
			await client.query(sql);
			await client.query('INSERT INTO public._app_migrations (name) VALUES ($1)', [migrationName]);
			await client.query('COMMIT');
			console.log(`[applied] ${migrationName}`);
		} catch (error) {
			await client.query('ROLLBACK');
			throw error;
		}
	}
} finally {
	client.release();
	await pool.end();
}
