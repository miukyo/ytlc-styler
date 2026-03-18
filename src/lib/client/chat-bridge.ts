type ChatCallback = (chatItem: unknown) => void;

interface BridgeStartOptions {
	handle?: string;
	channelId?: string;
	liveId?: string;
	overwrite?: boolean;
}

export class ChatBridge {
	private readonly sessionId: string;
	private eventSource: EventSource | null = null;
	private readonly listeners = new Set<ChatCallback>();
	private initialized = false;
	private readyPromise: Promise<void> | null = null;

	constructor(sessionId?: string) {
		const fallback = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
		this.sessionId = sessionId ?? globalThis.crypto?.randomUUID?.() ?? fallback;
	}

	private emit(chatItem: unknown): void {
		for (const listener of this.listeners) {
			listener(chatItem);
		}
	}

	async init(): Promise<void> {
		if (this.initialized) {
			if (this.readyPromise) {
				await this.readyPromise;
			}
			return;
		}

		this.eventSource = new EventSource(`/api/chat/events?sessionId=${encodeURIComponent(this.sessionId)}`);
		this.readyPromise = new Promise<void>((resolve) => {
			if (!this.eventSource) {
				resolve();
				return;
			}

			this.eventSource.onopen = () => {
				resolve();
			};

			this.eventSource.onerror = () => {
				// Keep bridge usable even if ready signal is delayed or unavailable.
				resolve();
			};
		});

		this.eventSource.onmessage = (event) => {
			const payload = JSON.parse(event.data) as {
				type?: 'chat:item' | 'chat:error' | 'chat:stopped' | 'chat:started';
				payload?: unknown;
			};

			if (payload.type === 'chat:item') {
				this.emit(payload.payload);
			}
		};

		this.initialized = true;
		await this.readyPromise;
	}

	subscribe(callback: ChatCallback): () => void {
		this.listeners.add(callback);
		void this.init();
		return () => this.listeners.delete(callback);
	}

	async start(options: BridgeStartOptions): Promise<void> {
		await this.init();
		const response = await fetch('/api/chat/start', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ ...options, sessionId: this.sessionId })
		});

		if (!response.ok) {
			const payload = (await response.json()) as { error?: string };
			throw new Error(payload.error ?? 'Unable to start chat');
		}
	}

	async stop(): Promise<void> {
		await fetch('/api/chat/stop', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ sessionId: this.sessionId })
		});
	}

	async sendDummy(options?: {
		mode?: 'random' | 'text' | 'membership' | 'superchat' | 'sticker';
		text?: string;
		authorName?: string;
		amount?: number;
		currency?: string;
	}): Promise<void> {
		await this.init();
		await fetch('/api/chat/dummy', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				sessionId: this.sessionId,
				...(options ?? { mode: 'text', text: 'test message', authorName: 'dev' })
			})
		});
	}

	disconnect(): void {
		if (!this.eventSource) {
			return;
		}
		this.eventSource.close();
		this.eventSource = null;
		this.initialized = false;
		this.readyPromise = null;
	}
}
