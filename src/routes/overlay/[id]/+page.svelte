<script lang="ts">
	import { onMount } from 'svelte';

	import { ChatBridge } from '$lib/client/chat-bridge';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let frame: HTMLIFrameElement | null = null;
	let ready = false;
	let autoStarted = false;

	const chatBridge = new ChatBridge();

	const parseStartOptions = (): { handle?: string; channelId?: string; liveId?: string } => {
		const query = new URLSearchParams(window.location.search);
		return {
			handle: query.get('handle') ?? undefined,
			channelId: query.get('channelId') ?? undefined,
			liveId: query.get('liveId') ?? undefined
		};
	};

	const startFromQueryOnce = async () => {
		if (autoStarted) {
			return;
		}

		const startOptions = parseStartOptions();
		if (!startOptions.liveId && !startOptions.handle && !startOptions.channelId) {
			return;
		}

		autoStarted = true;
		await chatBridge.start(startOptions);
	};

	onMount(() => {
		const onMessage = async (event: MessageEvent) => {
			if (!frame || event.source !== frame.contentWindow) {
				return;
			}

			const payload = event.data ?? {};

			if (payload.type === 'overlay:ready') {
				ready = true;
				await startFromQueryOnce();
				return;
			}

			if (payload.type === 'chat:start') {
				await chatBridge.start(payload.payload ?? {});
			}

			if (payload.type === 'chat:stop') {
				await chatBridge.stop();
			}

			if (payload.type === 'chat:dummy') {
				await chatBridge.sendDummy(payload.payload);
			}
		};

		const unsubscribe = chatBridge.subscribe((chatItem) => {
			if (!frame?.contentWindow || !ready) {
				return;
			}
			frame.contentWindow.postMessage({ type: 'chat:item', payload: chatItem }, '*');
		});

		window.addEventListener('message', onMessage);
		return () => {
			unsubscribe();
			window.removeEventListener('message', onMessage);
			void chatBridge.stop();
			chatBridge.disconnect();
		};
	});

	const onFrameLoad = async () => {
		// Fallback for cases where the first overlay:ready postMessage is missed.
		if (!ready) {
			ready = true;
		}

		await startFromQueryOnce();
	};
</script>

<iframe
	title="overlay-renderer"
	bind:this={frame}
	onload={onFrameLoad}
	src={`/api/overlays/${data.overlay.id}/html`}
	sandbox="allow-scripts allow-same-origin"
	class="overlay-frame"
></iframe>

<style>
	:global(html),
	:global(body) {
		background: transparent;
	}

	.overlay-frame {
		display: block;
		width: 100vw;
		height: 100vh;
		border: 0;
		background: transparent;
		color-scheme: normal;
	}
</style>
