type ChatCallback = (chatItem: unknown) => void;

interface BridgeStartOptions {
	handle?: string;
	channelId?: string;
	liveId?: string;
	overwrite?: boolean;
}

type DummyMode = 'random' | 'text' | 'membership' | 'superchat' | 'sticker';

interface DummyOptions {
	mode?: DummyMode;
	text?: string;
	authorName?: string;
	amount?: number;
	currency?: string;
}

const DUMMY_NAMES = [
	'@CoffeeNeko',
	'@OrbitPilot',
	'@AquaByte',
	'@PixelMango',
	'@LunarFork',
	'@ThreadSniper',
	'@NeonDiver'
];

const DUMMY_MESSAGES = [
	'This stream is so good lol',
	'Can you explain that part again pls',
	'Glad everything is still working haha',
	'This update looks really nice tbh',
	'Can we add emojis soon?',
	'Big shoutout to the dev fr',
	'Can I use this at work too btw'
];

const DUMMY_EMOJIS = [':rocket:', ':wave:', ':sparkles:', ':fire:', ':heart:'];

const DUMMY_COLORS = ['4278190335', '4282664004', '4291521144', '4294967295', '4289449455'];

const CURRENCY_SYMBOLS: Record<string, string> = {
	USD: '$',
	EUR: 'EUR ',
	GBP: 'GBP ',
	JPY: 'JPY '
};

export class ChatBridge {
	private readonly sessionId: string;
	private readonly listeners = new Set<ChatCallback>();
	private initialized = false;
	private cursor = 0;
	private isPolling = false;
	private pollTimer: number | null = null;
	private pollAbortController: AbortController | null = null;
	private pollConsecutiveErrors = 0;
	private readonly pollIntervalMs = 1000;
	private backendRestartTimer: number | null = null;
	private backendRestartAttempts = 0;
	private lastStartOptions: BridgeStartOptions | null = null;
	private shouldKeepChatRunning = false;
	private lifecycleHooksBound = false;
	private dummySequence = 0;

	constructor(sessionId?: string) {
		const fallback = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
		this.sessionId = sessionId ?? globalThis.crypto?.randomUUID?.() ?? fallback;
	}

	private emit(chatItem: unknown): void {
		for (const listener of this.listeners) {
			listener(chatItem);
		}
	}

	private clearPollTimer(): void {
		if (this.pollTimer === null) {
			return;
		}

		window.clearTimeout(this.pollTimer);
		this.pollTimer = null;
	}

	private clearBackendRestartTimer(): void {
		if (this.backendRestartTimer === null) {
			return;
		}

		window.clearTimeout(this.backendRestartTimer);
		this.backendRestartTimer = null;
	}

	private getReconnectDelayMs(): number {
		const baseDelay = 1_000;
		const maxDelay = 15_000;
		const delay = Math.min(maxDelay, baseDelay * 2 ** this.backendRestartAttempts);
		return delay + Math.floor(Math.random() * 250);
	}

	private getPollDelayMs(): number {
		if (this.pollConsecutiveErrors === 0) {
			return this.pollIntervalMs;
		}
		const baseDelay = 1_000;
		const maxDelay = 15_000;
		const delay = Math.min(maxDelay, baseDelay * 2 ** Math.min(this.pollConsecutiveErrors, 4));
		return delay + Math.floor(Math.random() * 250);
	}

	private scheduleNextPoll(delayMs = this.getPollDelayMs()): void {
		if (!this.isPolling || !this.listeners.size) {
			this.isPolling = false;
			return;
		}

		this.clearPollTimer();
		this.pollTimer = window.setTimeout(() => {
			this.pollTimer = null;
			void this.poll();
		}, delayMs);
	}

	private startPolling(): void {
		if (this.isPolling) {
			return;
		}
		this.isPolling = true;
		this.clearPollTimer();
		void this.poll();
	}

	private async poll(): Promise<void> {
		if (!this.isPolling || !this.listeners.size) {
			this.isPolling = false;
			return;
		}

		try {
			this.pollAbortController = new AbortController();
			const response = await fetch(
				`/api/chat/poll?sessionId=${encodeURIComponent(this.sessionId)}&cursor=${this.cursor}`,
				{
					signal: this.pollAbortController.signal,
					headers: {
						Accept: 'application/json'
					}
				}
			);

			if (!response.ok) {
				throw new Error(`Poll failed with status ${response.status}`);
			}

			const data = (await response.json()) as {
				ok?: boolean;
				cursor?: number;
				events?: Array<{
					id: number;
					type: 'chat:item' | 'chat:error' | 'chat:stopped' | 'chat:started';
					payload: unknown;
				}>;
			};

			this.pollConsecutiveErrors = 0;

			if (typeof data.cursor === 'number') {
				this.cursor = Math.max(this.cursor, data.cursor);
			}

			if (Array.isArray(data.events)) {
				for (const event of data.events) {
					this.handleEvent(event);
				}
			}
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') {
				return;
			}
			this.pollConsecutiveErrors += 1;
		} finally {
			this.pollAbortController = null;
			if (this.isPolling && this.listeners.size > 0) {
				this.scheduleNextPoll();
			} else {
				this.isPolling = false;
			}
		}
	}

	private handleEvent(event: {
		type: 'chat:item' | 'chat:error' | 'chat:stopped' | 'chat:started';
		payload: unknown;
	}): void {
		if (event.type === 'chat:item') {
			this.emit(event.payload);
			return;
		}

		if (event.type === 'chat:started') {
			this.backendRestartAttempts = 0;
			this.clearBackendRestartTimer();
			return;
		}

		if (event.type === 'chat:error') {
			const payload = event.payload as { message?: string } | undefined;
			const message = payload?.message;
			if (/\b403\b/.test(message ?? '')) {
				this.scheduleBackendRestart(this.parseRestartDelayMs(message));
			}
			return;
		}

		if (event.type === 'chat:stopped') {
			const payload = event.payload as { reason?: string } | undefined;
			const reason = payload?.reason;
			if (!this.shouldKeepChatRunning) {
				return;
			}

			if (/stopped from api|session disposed/i.test(reason ?? '')) {
				return;
			}

			this.scheduleBackendRestart(this.parseRestartDelayMs(reason));
		}
	}

	private bindLifecycleHooks(): void {
		if (this.lifecycleHooksBound) {
			return;
		}

		const recover = () => {
			if (!this.listeners.size) {
				return;
			}

			if (!this.isPolling) {
				this.startPolling();
			} else {
				this.clearPollTimer();
				void this.poll();
			}
		};

		window.addEventListener('focus', recover);
		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'visible') {
				recover();
			}
		});

		this.lifecycleHooksBound = true;
	}

	private hasStartTarget(options: BridgeStartOptions | null): options is BridgeStartOptions {
		if (!options) {
			return false;
		}

		return Boolean(options.handle || options.channelId || options.liveId);
	}

	private parseRestartDelayMs(reason: string | undefined): number {
		if (!reason) {
			return 2_000;
		}

		const match = /reconnecting in\s+(\d+)ms/i.exec(reason);
		if (!match) {
			return 2_000;
		}

		const delay = Number(match[1]);
		if (!Number.isFinite(delay) || delay < 0) {
			return 2_000;
		}

		return delay;
	}

	private scheduleBackendRestart(delayMs = this.getReconnectDelayMs()): void {
		if (!this.shouldKeepChatRunning || !this.hasStartTarget(this.lastStartOptions)) {
			return;
		}

		if (this.backendRestartTimer !== null) {
			return;
		}

		this.backendRestartTimer = window.setTimeout(() => {
			this.backendRestartTimer = null;
			void this.restartBackendChat();
		}, delayMs);
	}

	private async restartBackendChat(): Promise<void> {
		if (!this.shouldKeepChatRunning || !this.hasStartTarget(this.lastStartOptions)) {
			return;
		}

		try {
			await this.start(this.lastStartOptions);
			this.backendRestartAttempts = 0;
		} catch {
			this.backendRestartAttempts += 1;
			const baseDelay = this.getReconnectDelayMs();
			const retryDelay = Math.min(30_000, baseDelay * 2 ** this.backendRestartAttempts);
			this.scheduleBackendRestart(retryDelay);
		}
	}

	private randomInt(min: number, max: number): number {
		return Math.floor(Math.random() * (max - min + 1)) + min;
	}

	private pick<T>(values: T[]): T {
		return values[this.randomInt(0, values.length - 1)];
	}

	private createAvatarDataUrl(name: string): string {
		const palette = ['#e63946', '#f4a261', '#2a9d8f', '#457b9d', '#6d597a'];
		const bg = this.pick(palette);
		const initial = (name.trim().charAt(0) || 'D').toUpperCase();
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="${bg}"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-family="Arial, sans-serif" font-size="42" fill="#ffffff">${initial}</text></svg>`;
		return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
	}

	private resolveDummyMode(mode?: DummyMode): Exclude<DummyMode, 'random'> {
		if (!mode || mode === 'random') {
			return this.pick(['text', 'superchat', 'membership', 'sticker']);
		}

		return mode;
	}

	private normalizeDummyAmount(value: number | undefined): number {
		if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
			return Number((Math.random() * 99 + 1).toFixed(2));
		}

		return Number(value.toFixed(2));
	}

	private normalizeDummyCurrency(value: string | undefined): string {
		if (!value || value.trim().length === 0) {
			return 'USD';
		}

		return value.trim().toUpperCase();
	}

	private toAmountString(amount: number, currency: string): string {
		const symbolOrPrefix = CURRENCY_SYMBOLS[currency] ?? `${currency} `;
		return `${symbolOrPrefix}${amount.toFixed(2)}`;
	}

	private buildDummyMessage(textOverride?: string): unknown[] {
		if (textOverride) {
			return [{ type: 'text', text: textOverride }];
		}

		if (Math.random() > 0.8) {
			const emoji = this.pick(DUMMY_EMOJIS);
			return [
				{ type: 'text', text: `${this.pick(DUMMY_MESSAGES)} ` },
				{
					type: 'emoji',
					emojiText: emoji,
					url: 'https://yt3.ggpht.com/cktIaPxFwnrPwn-alHvnvedHLUJwbHi8HCK3AgbHpphrMAW99qw0bDfxuZagSY5ieE9BBrA=w24-h24-c-k-nd',
					alt: emoji,
					isCustomEmoji: false
				},
				{ type: 'text', text: `${this.pick(DUMMY_MESSAGES)} ` }
			];
		}

		if (Math.random() > 0.6) {
			const emoji = this.pick(DUMMY_EMOJIS);
			return [
				{ type: 'text', text: `${this.pick(DUMMY_MESSAGES)} ` },
				{
					type: 'emoji',
					emojiText: emoji,
					url: 'https://yt3.ggpht.com/cktIaPxFwnrPwn-alHvnvedHLUJwbHi8HCK3AgbHpphrMAW99qw0bDfxuZagSY5ieE9BBrA=w24-h24-c-k-nd',
					alt: emoji,
					isCustomEmoji: false
				}
			];
		}

		return [{ type: 'text', text: this.pick(DUMMY_MESSAGES) }];
	}

	private buildDummyMembership(authorName: string): Record<string, unknown> {
		const eventType = this.pick(['New', 'Milestone', 'GiftPurchase', 'GiftRedemption'] as const);

		if (eventType === 'Milestone') {
			const months = this.randomInt(2, 37);
			return {
				eventType,
				levelName: 'Member',
				membershipBadgeLabel: `Member (${Math.floor(months / 12)} years)`,
				headerPrimaryText: `Member for ${months} months`,
				headerSubtext: 'The Fam',
				milestoneMonths: months
			};
		}

		if (eventType === 'GiftPurchase') {
			const gifts = this.randomInt(1, 10);
			return {
				eventType,
				levelName: 'Member',
				headerPrimaryText: `Gifted ${gifts} memberships`,
				gifterUsername: authorName,
				giftCount: gifts
			};
		}

		if (eventType === 'GiftRedemption') {
			return {
				eventType,
				levelName: 'Member',
				headerPrimaryText: 'Received a gifted membership',
				recipientUsername: authorName
			};
		}

		return {
			eventType,
			levelName: 'Member',
			membershipBadgeLabel: 'New member',
			headerSubtext: 'Welcome to the channel'
		};
	}

	private buildDummyChatItem(options?: DummyOptions): unknown {
		const mode = this.resolveDummyMode(options?.mode);
		const authorName = options?.authorName?.trim() || this.pick(DUMMY_NAMES);
		const amount = this.normalizeDummyAmount(options?.amount);
		const currency = this.normalizeDummyCurrency(options?.currency);
		const text = options?.text?.trim();

		const base = {
			id: `dummy_${Date.now()}_${this.dummySequence++}`,
			author: {
				name: authorName,
				channelId: `UC_${Math.random().toString(36).slice(2, 18)}`,
				thumbnail: {
					type: 'image',
					url: 'https://yt3.ggpht.com/MNP0hHFQGsrpYCSw42fprx-RsLPWaVlEsyAj-q6fzHbgccgQ95AFhoCpHSNgJbsqVHSuhBJgLQ=s108-c-k-c0x00ffffff-no-rj',
					alt: `${authorName} avatar`
				}
			},
			message: this.buildDummyMessage(text),
			isMembership: Math.random() > 0.6,
			isVerified: Math.random() > 0.9,
			isOwner: Math.random() > 0.98,
			isModerator: Math.random() > 0.92,
			timestamp: new Date(),
			viewerLeaderboardRank: Math.random() > 0.8 ? this.randomInt(1, 3) : undefined,
			isTicker: Math.random() > 0.85
		};

		if (mode === 'membership') {
			return {
				...base,
				isMembership: true,
				membershipDetails: this.buildDummyMembership(authorName)
			};
		}

		if (mode === 'superchat' || mode === 'sticker') {
			const amountString = this.toAmountString(amount, currency);
			return {
				...base,
				superchat: {
					amountString,
					amountValue: amount,
					currency,
					bodyBackgroundColor: this.pick(DUMMY_COLORS),
					headerBackgroundColor: this.pick(DUMMY_COLORS),
					headerTextColor: 'FFFFFFFF',
					bodyTextColor: 'FFFFFFFF',
					authorNameTextColor: 'FFFFFFFF',
					sticker:
						mode === 'sticker'
							? {
								type: 'image',
								url: 'https://1.bp.blogspot.com/-L5EEP6irqNo/Xb_AxRYPYVI/AAAAAAAACUE/KVwBuP1Nyg8n5YYBf7Kdsbx5b-7E5ELIwCLcBGAsYHQ/s1600/1hippo.gif',
								alt: 'Super Sticker'
							}
							: undefined
				}
			};
		}

		return base;
	}

	async init(): Promise<void> {
		if (this.initialized) {
			return;
		}

		this.bindLifecycleHooks();
		this.startPolling();
		this.initialized = true;
	}

	subscribe(callback: ChatCallback): () => void {
		this.listeners.add(callback);
		void this.init();
		if (!this.isPolling) {
			this.startPolling();
		}
		return () => {
			this.listeners.delete(callback);
			if (!this.listeners.size) {
				this.disconnect();
			}
		};
	}

	async start(options: BridgeStartOptions): Promise<void> {
		this.shouldKeepChatRunning = true;
		this.lastStartOptions = {
			handle: options.handle,
			channelId: options.channelId,
			liveId: options.liveId,
			overwrite: true
		};
		this.clearBackendRestartTimer();
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

		this.backendRestartAttempts = 0;
		this.clearPollTimer();
		void this.poll();
	}

	async stop(): Promise<void> {
		this.shouldKeepChatRunning = false;
		this.clearBackendRestartTimer();
		this.backendRestartAttempts = 0;
		await fetch('/api/chat/stop', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ sessionId: this.sessionId })
		});
	}

	async sendDummy(options?: DummyOptions): Promise<void> {
		this.emit(this.buildDummyChatItem(options));
	}

	disconnect(): void {
		this.clearPollTimer();
		this.clearBackendRestartTimer();
		this.shouldKeepChatRunning = false;
		this.isPolling = false;

		if (this.pollAbortController) {
			this.pollAbortController.abort();
			this.pollAbortController = null;
		}
		this.initialized = false;
	}
}
