import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { chatManager } from '$lib/server/chat-manager';

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as { sessionId?: string };
	if (!body.sessionId) {
		throw error(400, 'sessionId is required');
	}

	chatManager.stop(body.sessionId);
	return json({ ok: true });
};
