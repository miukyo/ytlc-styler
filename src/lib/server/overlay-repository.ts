import { db } from '$lib/server/db';
import type { OverlayRecord } from '$lib/shared/types';

const mapRecord = (row: {
	id: string;
	name: string | null;
	code: string;
	compiled_js: string;
	created_at: string;
	updated_at: string;
}): OverlayRecord => ({
	id: row.id,
	name: row.name,
	code: row.code,
	compiledHtml: row.compiled_js,
	createdAt: row.created_at,
	updatedAt: row.updated_at
});

export const upsertOverlay = async (overlay: {
	id: string;
	name: string | null;
	code: string;
	compiledHtml: string;
}) => {
	const now = new Date().toISOString();

	await db
		.insertInto('overlays')
		.values({
			id: overlay.id,
			name: overlay.name,
			code: overlay.code,
			compiled_js: overlay.compiledHtml,
			created_at: now,
			updated_at: now
		})
		.onConflict((oc) =>
			oc.column('id').doUpdateSet({
				name: overlay.name,
				code: overlay.code,
				compiled_js: overlay.compiledHtml,
				updated_at: now
			})
		)
		.executeTakeFirst();
};

export const getOverlayById = async (id: string): Promise<OverlayRecord | null> => {
	const row = await db
		.selectFrom('overlays')
		.select(['id', 'name', 'code', 'compiled_js', 'created_at', 'updated_at'])
		.where('id', '=', id)
		.executeTakeFirst();

	if (!row) {
		return null;
	}

	return mapRecord(row);
};
