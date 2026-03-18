import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { chatManager } from '$lib/server/chat-manager';

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as {
		sessionId?: string;
		mode?: 'random' | 'text' | 'membership' | 'superchat' | 'sticker';
		text?: string;
		authorName?: string;
		amount?: number;
		currency?: string;
	};

	if (!body.sessionId) {
		return json({ error: 'sessionId is required' }, { status: 400 });
	}

	chatManager.sendDummy(body.sessionId, {
		mode: body.mode,
		text: body.text,
		authorName: body.authorName,
		amount: body.amount,
		currency: body.currency
	});
	return json({ ok: true });
};
