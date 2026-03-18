import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { chatManager } from '$lib/server/chat-manager';

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as {
		sessionId?: string;
		handle?: string;
		channelId?: string;
		liveId?: string;
	};

	if (!body.sessionId) {
		return json({ error: 'sessionId is required' }, { status: 400 });
	}

	if (!body.handle && !body.channelId && !body.liveId) {
		return json({ error: 'handle, channelId, or liveId is required' }, { status: 400 });
	}

	try {
		await chatManager.start(body.sessionId, {
			handle: body.handle,
			channelId: body.channelId,
			liveId: body.liveId,
			overwrite: true
		});
		return json({ ok: true });
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'Unable to start chat' },
			{ status: 400 }
		);
	}
};
