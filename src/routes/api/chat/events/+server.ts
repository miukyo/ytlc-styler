import type { RequestHandler } from './$types';

import { chatManager } from '$lib/server/chat-manager';

export const GET: RequestHandler = async ({ request }) => {
	const sessionId = new URL(request.url).searchParams.get('sessionId') ?? '';
	if (!sessionId) {
		return new Response('sessionId is required', { status: 400 });
	}

	const encoder = new TextEncoder();
	const heartbeatMs = 15_000;

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			let closed = false;

			const send = (event: unknown) => {
				if (closed) {
					return;
				}
				controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
			};

			const sendHeartbeat = () => {
				if (closed) {
					return;
				}
				// SSE comment frame keeps intermediaries and browsers from timing out idle streams.
				controller.enqueue(encoder.encode(`: keepalive\n\n`));
			};

			send({ type: 'chat:started', payload: { connected: true, sessionId } });

			const unsubscribe = chatManager.subscribe(sessionId, (event) => {
				send(event);
			});

			const heartbeat = setInterval(sendHeartbeat, heartbeatMs);

			const closeStream = () => {
				if (closed) {
					return;
				}

				closed = true;
				clearInterval(heartbeat);
				unsubscribe();

				try {
					controller.close();
				} catch {
					// Stream may already be closed.
				}
			};

			request.signal.addEventListener('abort', () => {
				closeStream();
			});
		},
		cancel() {
			// No-op: request.abort handles cleanup in start().
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
