import fs from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';

interface OverlayTable {
	id: string;
	name: string | null;
	code: string;
	compiled_js: string;
	created_at: string;
	updated_at: string;
}

interface Db {
	overlays: OverlayTable;
}

const dataDir = path.resolve(process.cwd(), '.data');
const dbPath = path.join(dataDir, 'overlays.sqlite');

if (!fs.existsSync(dataDir)) {
	fs.mkdirSync(dataDir, { recursive: true });
}

const sqlite = new Database(dbPath);

sqlite.exec(`
	CREATE TABLE IF NOT EXISTS overlays (
		id TEXT PRIMARY KEY,
		name TEXT,
		code TEXT NOT NULL,
		compiled_js TEXT NOT NULL,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);
`);

const db = new Kysely<Db>({
	dialect: new SqliteDialect({
		database: sqlite
	})
});

export { db };
