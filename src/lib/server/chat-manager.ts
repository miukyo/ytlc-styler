import { YTLiveChat, type SendDummyOptions, type StartOptions } from '@miukyo/ytlc';

interface ChatEventEnvelope {
	type: 'chat:item' | 'chat:error' | 'chat:stopped' | 'chat:started';
	payload: unknown;
}

type ChatSink = (event: ChatEventEnvelope) => void;

class ChatSession {
	private readonly chat: YTLiveChat;
	private readonly sinks = new Set<ChatSink>();
	private readonly sessionId: string;
	private lastActivityAt = Date.now();

	constructor(sessionId: string) {
		this.sessionId = sessionId;
		this.chat = new YTLiveChat({
			debugLogReceivedJsonItems: false
		});

		this.chat.on('chatReceived', ({ chatItem }) => {
			this.emit({ type: 'chat:item', payload: chatItem });
		});

		this.chat.on('errorOccurred', ({ error }) => {
			this.emit({ type: 'chat:error', payload: { message: error.message } });
		});

		this.chat.on('chatStopped', ({ reason }) => {
			this.emit({ type: 'chat:stopped', payload: { reason } });
		});
	}

	subscribe(sink: ChatSink): () => void {
		this.touch();
		this.sinks.add(sink);
		return () => {
			this.sinks.delete(sink);
		};
	}

	private emit(event: ChatEventEnvelope): void {
		this.touch();
		for (const sink of this.sinks) {
			sink(event);
		}
	}

	async start(options: StartOptions): Promise<void> {
		this.touch();
		await this.chat.start({ ...options, overwrite: true });
		this.emit({ type: 'chat:started', payload: { ...options, sessionId: this.sessionId } });
	}

	stop(reason = 'Stopped from API.'): void {
		this.touch();
		this.chat.stop(reason);
	}

	sendDummy(options?: SendDummyOptions): void {
		this.touch();
		this.chat.sendDummy(options);
	}

	isExpired(now = Date.now(), ttlMs = 20 * 60 * 1000): boolean {
		return this.sinks.size === 0 && now - this.lastActivityAt > ttlMs;
	}

	private touch(): void {
		this.lastActivityAt = Date.now();
	}

	dispose(): void {
		this.chat.stop('Session disposed.');
		this.sinks.clear();
	}
}

class ChatManager {
	private readonly sessions = new Map<string, ChatSession>();

	private getOrCreate(sessionId: string): ChatSession {
		const existing = this.sessions.get(sessionId);
		if (existing) {
			return existing;
		}

		const session = new ChatSession(sessionId);
		this.sessions.set(sessionId, session);
		this.compact();
		return session;
	}

	subscribe(sessionId: string, sink: ChatSink): () => void {
		return this.getOrCreate(sessionId).subscribe(sink);
	}

	async start(sessionId: string, options: StartOptions): Promise<void> {
		await this.getOrCreate(sessionId).start(options);
	}

	stop(sessionId: string, reason = 'Stopped from API.'): void {
		const session = this.sessions.get(sessionId);
		if (!session) {
			return;
		}
		session.stop(reason);
	}

	sendDummy(sessionId: string, options?: SendDummyOptions): void {
		this.getOrCreate(sessionId).sendDummy(options);
	}

	private compact(): void {
		const now = Date.now();
		for (const [sessionId, session] of this.sessions) {
			if (!session.isExpired(now)) {
				continue;
			}
			session.dispose();
			this.sessions.delete(sessionId);
		}
	}
}

export const chatManager = new ChatManager();
