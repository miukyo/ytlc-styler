# YTLC Styler

Web-based Svelte overlay editor for YouTube live chat overlays.

## Stack

- SvelteKit + TypeScript
- modern-monaco editor
- Custom runtime for HTML + JavaScript + CSS overlays
- Svelte-like template syntax support (`{#each ...}` and `{expr}`)
- Supabase Postgres + Kysely for overlay persistence
- `@miukyo/ytlc` bridge for live chat and dummy messages

## Routes

- `/editor`: Monaco-based overlay editor with live preview iframe
- `/overlay/:id`: OBS-ready renderer for exported overlays
- `/api/compile`: server validation endpoint for overlay source format
- `/api/format`: server-side Svelte formatter endpoint
- `/api/overlays`: create exported overlay
- `/api/overlays/:id`: fetch persisted overlay
- `/api/chat/events`: SSE stream for chat events (frontend subscription)
- `/api/chat/start`: start backend ytlc session
- `/api/chat/stop`: stop backend ytlc session
- `/api/chat/dummy`: emit dummy message via backend ytlc

## Run

```sh
npm install
npm run dev
```

Open:

- `http://localhost:5173/editor`

## Build and Check

```sh
npm run check
npm run build
```

## Storage

Set one of these environment variables before running the app:

- `DATABASE_URL`
- `SUPABASE_DB_URL`

Run database setup:

```sh
npm run db:migrate
```

Expected schema:

- `public.overlays(id text primary key, name text null, code text not null, compiled_js text not null, created_at text not null, updated_at text not null)`

Generate Supabase types (recommended) and map them through `kysely-supabase`:

```sh
npx supabase gen types typescript --linked > src/lib/server/supabase.generated.ts
```

Then replace the inline schema in `src/lib/server/db.types.ts` with an import from your generated file.
