import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { getPreview } from '$lib/server/preview-store';

export const GET: RequestHandler = async ({ params }) => {
	const html = getPreview(params.id);
	if (!html) {
		throw error(404, 'Preview not found or expired');
	}

	return new Response(html, {
		headers: {
			'Content-Type': 'text/html; charset=utf-8',
			'Cache-Control': 'no-store'
		}
	});
};
