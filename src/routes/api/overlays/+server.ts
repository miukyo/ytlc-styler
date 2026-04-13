import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { compileOverlay } from '$lib/server/compile';
import { upsertOverlay } from '$lib/server/overlay-repository';

export const POST: RequestHandler = async ({ request, url }) => {
	const body = (await request.json()) as {
		id?: string;
		code?: string;
		compiledHtml?: string;
		name?: string;
		handle?: string;
		channelId?: string;
		liveId?: string;
	};

	if (typeof body.code !== 'string' || body.code.trim().length === 0) {
		return json({ error: 'code is required' }, { status: 400 });
	}

	if (body.code.length > 100_000) {
		return json({ error: 'code exceeds size limit' }, { status: 400 });
	}

	const handle = typeof body.handle === 'string' && body.handle.trim().length > 0
		? body.handle.trim()
		: undefined;
	const channelId = typeof body.channelId === 'string' && body.channelId.trim().length > 0
		? body.channelId.trim()
		: undefined;
	const liveId = typeof body.liveId === 'string' && body.liveId.trim().length > 0
		? body.liveId.trim()
		: undefined;

	if (!handle && !channelId && !liveId) {
		return json({ error: 'handle, channelId, or liveId is required for export' }, { status: 400 });
	}

	let compiledHtml =
		typeof body.compiledHtml === 'string' && body.compiledHtml.trim().length > 0
			? body.compiledHtml
			: '';

	if (compiledHtml.length > 300_000) {
		return json({ error: 'compiledHtml exceeds size limit' }, { status: 400 });
	}

	if (!compiledHtml) {
		try {
			compiledHtml = (await compileOverlay(body.code)).compiledHtml;
		} catch (error) {
			return json(
				{
					error: error instanceof Error ? error.message : 'Compile failed'
				},
				{ status: 400 }
			);
		}
	}

	const requestedId = typeof body.id === 'string' && body.id.trim().length > 0 ? body.id.trim() : 'draft';
	let savedOverlay;

	try {
		savedOverlay = await upsertOverlay({
			id: requestedId,
			name: typeof body.name === 'string' ? body.name : null,
			code: body.code,
			compiledHtml
		});
	} catch (error) {
		return json(
			{
				error: error instanceof Error ? error.message : 'GitHub Gist upload failed'
			},
			{ status: 502 }
		);
	}

	const id = savedOverlay.id;

	const exportUrl = new URL(`/overlay/${id}`, url.origin);
	if (handle) {
		exportUrl.searchParams.set('handle', handle);
	}
	if (channelId) {
		exportUrl.searchParams.set('channelId', channelId);
	}
	if (liveId) {
		exportUrl.searchParams.set('liveId', liveId);
	}

	return json({
		id,
		url: exportUrl.toString()
	});
};
