import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { getOverlayById } from '$lib/server/overlay-repository';

export const GET: RequestHandler = async ({ params }) => {
	const overlay = await getOverlayById(params.id);

	if (!overlay) {
		return json({ error: 'overlay not found' }, { status: 404 });
	}

	return json(overlay);
};
