import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { compileOverlay } from '$lib/server/compile';
import { savePreview } from '$lib/server/preview-store';
import { v4 as uuidv4 } from 'uuid';

export const POST: RequestHandler = async ({ request, url }) => {
	const body = (await request.json()) as { code?: string };

	if (typeof body.code !== 'string' || body.code.trim().length === 0) {
		return json({ error: 'code is required' }, { status: 400 });
	}

	if (body.code.length > 100_000) {
		return json({ error: 'code exceeds size limit' }, { status: 400 });
	}

	try {
		const result = await compileOverlay(body.code);
		const previewId = uuidv4();
		savePreview(previewId, result.compiledHtml);

		return json({
			previewUrl: `${url.origin}/api/preview/${previewId}`
		});
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'Compile failed' },
			{ status: 400 }
		);
	}
};
