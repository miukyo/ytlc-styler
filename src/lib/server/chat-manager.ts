import { YTLiveChat, YTHttpClient, type SendDummyOptions, type StartOptions } from '@miukyo/ytlc';
import {
	parseActionToChatItem,
	parseLiveChatResponse,
	parseLivePage,
	type ParsedLivePage
} from './yt-parser';

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
	private readonly httpClient: YTHttpClient;
	private readonly sinks = new Set<ChatSink>();
	private readonly sessionId: string;
	private lastActivityAt = Date.now();
	private events: StoredChatEvent[] = [];
	private nextEventId = 0;
	private readonly maxEvents = 1000;
	private fetchOptions?: ParsedLivePage;
	private isFetching = false;

	constructor(sessionId: string) {
		this.sessionId = sessionId;
		this.httpClient = new YTHttpClient({
			fetchImplementation: (url, init) => fetch(url, init)
		});
		this.chat = new YTLiveChat(
			{
				debugLogReceivedJsonItems: false
			},
			this.httpClient
		);

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

	serializeState(): string | undefined {
		if (!this.fetchOptions) {
			return undefined;
		}
		try {
			return btoa(JSON.stringify(this.fetchOptions));
		} catch {
			return undefined;
		}
	}

	restoreState(state: string): void {
		try {
			const decoded = JSON.parse(atob(state));
			if (decoded && decoded.apiKey && decoded.continuation) {
				this.fetchOptions = decoded;
			}
		} catch {
			// Ignore invalid state
		}
	}

	async poll(
		cursor: number,
		state?: string
	): Promise<{ cursor: number; events: StoredChatEvent[]; state?: string }> {
		this.touch();

		if (state && !this.fetchOptions) {
			this.restoreState(state);
		}

		if (this.fetchOptions && !this.isFetching) {
			this.isFetching = true;
			try {
				const response = await this.httpClient.fetchLiveChatData(this.fetchOptions);
				const parsed = parseLiveChatResponse(response);
				if (parsed.continuation) {
					this.fetchOptions.continuation = parsed.continuation;
				}
				if (Array.isArray(parsed.actions)) {
					for (const action of parsed.actions) {
						const chatItem = parseActionToChatItem(action);
						if (chatItem) {
							this.emit({ type: 'chat:item', payload: chatItem });
						}
					}
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				this.emit({ type: 'chat:error', payload: { message } });
			} finally {
				this.isFetching = false;
			}
		}

		if (cursor < 0) {
			cursor = 0;
		}

		if (cursor === 0 && this.events.length > 50) {
			return {
				cursor: this.nextEventId,
				events: this.events.slice(-50),
				state: this.serializeState()
			};
		}

		const events = this.events.filter((item) => item.id > cursor);
		return {
			cursor: this.nextEventId,
			events,
			state: this.serializeState()
		};
	}

	async start(options: StartOptions): Promise<string | undefined> {
		this.touch();
		try {
			const rawPage = await this.httpClient.fetchLivePage(options);
			this.fetchOptions = parseLivePage(rawPage);
			this.emit({
				type: 'chat:started',
				payload: { ...options, sessionId: this.sessionId, liveId: this.fetchOptions.liveId }
			});
			return this.serializeState();
		} catch (error) {
			const wrapped = error instanceof Error ? error : new Error(String(error));
			this.emit({ type: 'chat:error', payload: { message: wrapped.message } });
			throw wrapped;
		}
	}

	stop(reason = 'Stopped from API.'): void {
		this.touch();
		this.fetchOptions = undefined;
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
		this.fetchOptions = undefined;
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

	async poll(
		sessionId: string,
		cursor: number,
		state?: string
	): Promise<{ cursor: number; events: StoredChatEvent[]; state?: string }> {
		return this.getOrCreate(sessionId).poll(cursor, state);
	}

	async start(sessionId: string, options: StartOptions): Promise<string | undefined> {
		return this.getOrCreate(sessionId).start(options);
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
