CREATE TABLE IF NOT EXISTS public.overlays (
	id TEXT PRIMARY KEY,
	name TEXT,
	code TEXT NOT NULL,
	compiled_js TEXT NOT NULL,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);
