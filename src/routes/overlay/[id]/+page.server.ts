import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

import { getOverlayById } from '$lib/server/overlay-repository';

export const load: PageServerLoad = async ({ params }) => {
	const overlay = await getOverlayById(params.id);

	if (!overlay) {
		throw error(404, 'Overlay not found');
	}

	return {
		overlay
	};
};
