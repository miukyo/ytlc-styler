import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { getOverlayById } from '$lib/server/overlay-repository';

export const GET: RequestHandler = async ({ params }) => {
	const overlay = await getOverlayById(params.id);
	if (!overlay) {
		throw error(404, 'Overlay not found');
	}

	return new Response(overlay.compiledHtml, {
		headers: {
			'Content-Type': 'text/html; charset=utf-8',
			'Cache-Control': 'public, max-age=60'
		}
	});
};
