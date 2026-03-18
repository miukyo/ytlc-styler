import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { env } from '$env/dynamic/private';

import type { Database } from '$lib/server/db.types';

const connectionString = env.DATABASE_URL || env.SUPABASE_DB_URL;

if (!connectionString) {
	throw new Error('Missing DATABASE_URL or SUPABASE_DB_URL.');
}

const db = new Kysely<Database>({
	dialect: new PostgresDialect({
		pool: new Pool({
			connectionString
		})
	})
});

export { db };
