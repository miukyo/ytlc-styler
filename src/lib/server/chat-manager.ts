import { YTLiveChat, type SendDummyOptions, type StartOptions } from '@miukyo/ytlc';

export interface ChatEventEnvelope {
	type: 'chat:item' | 'chat:error' | 'chat:stopped' | 'chat:started';
	payload: unknown;
}

export interface StoredChatEvent extends ChatEventEnvelope {
	id: number;
	timestamp: number;
}

type ChatSink = (event: ChatEventEnvelope) => void;

class ChatSession {
	private readonly chat: YTLiveChat;
	private readonly sinks = new Set<ChatSink>();
	private readonly sessionId: string;
	private lastActivityAt = Date.now();
	private events: StoredChatEvent[] = [];
	private nextEventId = 0;
	private readonly maxEvents = 1000;

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
		const stored: StoredChatEvent = {
			id: ++this.nextEventId,
			type: event.type,
			payload: event.payload,
			timestamp: Date.now()
		};
		this.events.push(stored);
		if (this.events.length > this.maxEvents) {
			this.events.splice(0, this.events.length - this.maxEvents);
		}
		for (const sink of this.sinks) {
			sink(event);
		}
	}

	poll(cursor: number): { cursor: number; events: StoredChatEvent[] } {
		this.touch();
		if (cursor < 0) {
			cursor = 0;
		}

		if (cursor === 0 && this.events.length > 50) {
			return {
				cursor: this.nextEventId,
				events: this.events.slice(-50)
			};
		}

		const events = this.events.filter((item) => item.id > cursor);
		return {
			cursor: this.nextEventId,
			events
		};
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
		this.events = [];
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

	poll(sessionId: string, cursor: number): { cursor: number; events: StoredChatEvent[] } {
		return this.getOrCreate(sessionId).poll(cursor);
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
