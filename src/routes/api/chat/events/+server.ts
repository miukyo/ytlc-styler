import type { RequestHandler } from './$types';

import { chatManager } from '$lib/server/chat-manager';

export const GET: RequestHandler = async ({ request }) => {
	const sessionId = new URL(request.url).searchParams.get('sessionId') ?? '';
	if (!sessionId) {
		return new Response('sessionId is required', { status: 400 });
	}

	const encoder = new TextEncoder();

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const send = (event: unknown) => {
				controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
			};

			send({ type: 'chat:started', payload: { connected: true, sessionId } });

			const unsubscribe = chatManager.subscribe(sessionId, (event) => {
				send(event);
			});

			request.signal.addEventListener('abort', () => {
				unsubscribe();
				try {
					controller.close();
				} catch {
					// Stream may already be closed.
				}
			});
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive'
		}
	});
};
