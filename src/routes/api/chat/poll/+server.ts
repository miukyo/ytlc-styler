import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { chatManager } from '$lib/server/chat-manager';

export const GET: RequestHandler = async ({ url }) => {
	const sessionId = url.searchParams.get('sessionId') ?? '';
	if (!sessionId) {
		return json({ error: 'sessionId is required' }, { status: 400 });
	}

	const rawCursor = url.searchParams.get('cursor');
	const cursor = rawCursor !== null ? Math.max(0, parseInt(rawCursor, 10) || 0) : 0;

	const result = chatManager.poll(sessionId, cursor);

	return json(
		{
			ok: true,
			cursor: result.cursor,
			events: result.events
		},
		{
			headers: {
				'Cache-Control': 'private, no-cache, no-store, max-age=0, must-revalidate, no-transform',
				'CDN-Cache-Control': 'no-store',
				'Cloudflare-CDN-Cache-Control': 'no-store',
				Pragma: 'no-cache',
				Expires: '0'
			}
		}
	);
};

