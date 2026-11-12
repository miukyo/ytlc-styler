import type { ChatItem } from '@miukyo/ytlc';

const DEFAULT_CURRENCY = 'USD';
const SYMBOL_TO_CODE: Record<string, string> = {
	$: 'USD',
	A$: 'AUD',
	CA$: 'CAD',
	HK$: 'HKD',
	MX$: 'MXN',
	NZ$: 'NZD',
	R$: 'BRL',
	'£': 'GBP',
	'¥': 'JPY',
	'₩': 'KRW',
	'₪': 'ILS',
	'₫': 'VND',
	'€': 'EUR',
	'₱': 'PHP',
	'₹': 'INR',
	US$: 'USD',
	S$: 'SGD',
	NT$: 'TWD',
	'CN¥': 'CNY'
};

const NUMBER_EXTRACTOR = /[+-]?(?:\d{1,3}(?:[\s,]\d{3})+|\d+)(?:[.,]\d+)?/;
const ISO_CODE = /[A-Z]{3}/;

const normalizeSpaces = (value: string) => value.replace(/\u00A0|\u202F/g, ' ').trim();

const normalizeAmountToken = (value: string) => {
	const compact = normalizeSpaces(value).replace(/\s/g, '');
	const hasComma = compact.includes(',');
	const hasDot = compact.includes('.');
	if (hasComma && hasDot) {
		return compact.lastIndexOf(',') > compact.lastIndexOf('.')
			? compact.replace(/\./g, '').replace(/,/g, '.')
			: compact.replace(/,/g, '');
	}
	if (hasComma && !hasDot) {
		const parts = compact.split(',');
		return parts.at(-1)?.length === 3 ? parts.join('') : parts.join('.');
	}
	return compact;
};

const resolveCurrencyCode = (symbolPart: string, fullInput: string) => {
	const compactSymbol = normalizeSpaces(symbolPart).replace(/\s/g, '');
	if (compactSymbol in SYMBOL_TO_CODE) {
		const code = SYMBOL_TO_CODE[compactSymbol];
		if (code) {
			return code;
		}
	}
	if (compactSymbol.length === 3 && /^[A-Za-z]{3}$/.test(compactSymbol)) {
		return compactSymbol.toUpperCase();
	}
	const embedded = compactSymbol.toUpperCase().match(ISO_CODE)?.[0];
	if (embedded) {
		return embedded;
	}
	const embeddedFromRaw = fullInput.toUpperCase().match(ISO_CODE)?.[0];
	if (embeddedFromRaw) {
		return embeddedFromRaw;
	}
	if (compactSymbol.includes('¥')) {
		return 'JPY';
	}
	return DEFAULT_CURRENCY;
};

export const parseCurrency = (rawInput?: string) => {
	if (!rawInput || !rawInput.trim()) {
		return { amountValue: 0, currency: DEFAULT_CURRENCY };
	}
	const normalized = normalizeSpaces(rawInput);
	const numberMatch = normalized.match(NUMBER_EXTRACTOR)?.[0];
	if (!numberMatch) {
		return { amountValue: 0, currency: resolveCurrencyCode(normalized, normalized) };
	}
	const idx = normalized.indexOf(numberMatch);
	const before = normalized.slice(0, idx);
	const after = normalized.slice(idx + numberMatch.length);
	const amountValue = Number.parseFloat(normalizeAmountToken(numberMatch));
	return {
		amountValue: Number.isFinite(amountValue) ? amountValue : 0,
		currency: resolveCurrencyCode(`${before}${after}`, normalized)
	};
};

const toText = (node: any): string | undefined => {
	if (!node || typeof node !== 'object') {
		return undefined;
	}
	if (node.simpleText) {
		return node.simpleText;
	}
	if (!Array.isArray(node.runs)) {
		return undefined;
	}
	const text = node.runs
		.map((entry: any) => entry.text ?? '')
		.join('')
		.trim();
	return text.length > 0 ? text : undefined;
};

const toImagePart = (thumbnailNode: any, alt?: string) => {
	if (!thumbnailNode || typeof thumbnailNode !== 'object') {
		return undefined;
	}
	const thumbnails = thumbnailNode.thumbnails;
	const url = thumbnails?.at(-1)?.url;
	if (!url) {
		return undefined;
	}
	return {
		type: 'image' as const,
		url,
		alt
	};
};

const toMessageParts = (runs: any) => {
	if (!Array.isArray(runs)) {
		return [];
	}
	const parts: any[] = [];
	for (const run of runs) {
		if (!run || typeof run !== 'object') {
			continue;
		}
		if (typeof run.text === 'string') {
			parts.push({ type: 'text', text: run.text });
			continue;
		}
		if (run.emoji) {
			const emoji = run.emoji;
			const url = emoji.image?.thumbnails?.at(-1)?.url;
			const alt = emoji.shortcuts?.[0] ?? emoji.searchTerms?.[0];
			parts.push({
				type: 'emoji',
				url: url ?? '',
				alt,
				emojiText: emoji.isCustomEmoji
					? alt ?? `[:${emoji.emojiId ?? 'unknown'}:]`
					: emoji.emojiId ?? alt ?? '',
				isCustomEmoji: Boolean(emoji.isCustomEmoji)
			});
		}
	}
	return parts;
};

const parseBadges = (renderer: any) => {
	const badges = renderer.authorBadges;
	if (!Array.isArray(badges)) {
		return {
			isMembership: false,
			isOwner: false,
			isVerified: false,
			isModerator: false
		};
	}
	let isMembership = false;
	let isOwner = false;
	let isVerified = false;
	let isModerator = false;
	let badgeLabel: string | undefined;
	let badgeThumbnail: any;
	for (const item of badges) {
		if (!item || typeof item !== 'object') {
			continue;
		}
		const badgeRenderer = item.liveChatAuthorBadgeRenderer;
		if (!badgeRenderer) {
			continue;
		}
		const customThumbnail = badgeRenderer.customThumbnail;
		if (customThumbnail) {
			isMembership = true;
			badgeLabel = badgeRenderer.tooltip ?? badgeLabel ?? 'Member';
			badgeThumbnail = toImagePart(customThumbnail, badgeLabel) ?? badgeThumbnail;
			continue;
		}
		const iconType = badgeRenderer.icon?.iconType;
		if (iconType === 'OWNER') isOwner = true;
		if (iconType === 'VERIFIED') isVerified = true;
		if (iconType === 'MODERATOR') isModerator = true;
	}
	return {
		isMembership,
		isOwner,
		isVerified,
		isModerator,
		badgeLabel,
		badgeThumbnail
	};
};

const parseMembershipDetails = (rendererType: string, renderer: any, authorName: string) => {
	const headerPrimaryText = toText(renderer.headerPrimaryText);
	const headerSubtext = toText(renderer.headerSubtext);
	if (rendererType === 'liveChatMembershipItemRenderer') {
		const milestoneMonthsText = headerPrimaryText?.match(/(\d+)\s+months?/i)?.[1];
		return {
			eventType: milestoneMonthsText ? ('Milestone' as const) : ('New' as const),
			levelName: 'Member',
			membershipBadgeLabel: headerSubtext,
			headerPrimaryText,
			headerSubtext,
			milestoneMonths: milestoneMonthsText ? Number.parseInt(milestoneMonthsText, 10) : undefined
		};
	}
	if (rendererType === 'liveChatSponsorshipsGiftPurchaseAnnouncementRenderer') {
		const giftCountText = headerPrimaryText?.match(/gifted\s+(\d+)/i)?.[1];
		return {
			eventType: 'GiftPurchase' as const,
			levelName: 'Member',
			headerPrimaryText,
			headerSubtext,
			gifterUsername: authorName,
			giftCount: giftCountText ? Number.parseInt(giftCountText, 10) : 1
		};
	}
	if (rendererType === 'liveChatSponsorshipsGiftRedemptionAnnouncementRenderer') {
		return {
			eventType: 'GiftRedemption' as const,
			levelName: 'Member',
			headerPrimaryText,
			headerSubtext,
			recipientUsername: authorName
		};
	}
	return undefined;
};

const parseSuperchat = (rendererType: string, renderer: any) => {
	if (
		rendererType !== 'liveChatPaidMessageRenderer' &&
		rendererType !== 'liveChatPaidStickerRenderer'
	) {
		return undefined;
	}
	const amountString = toText(renderer.purchaseAmountText) ?? '';
	const { amountValue, currency } = parseCurrency(amountString);
	const sticker =
		rendererType === 'liveChatPaidStickerRenderer'
			? toImagePart(renderer.sticker ?? undefined)
			: undefined;
	return {
		amountString,
		amountValue,
		currency,
		bodyBackgroundColor: String(
			renderer.bodyBackgroundColor ?? renderer.backgroundColor ?? '000000'
		),
		headerBackgroundColor: renderer.headerBackgroundColor
			? String(renderer.headerBackgroundColor)
			: undefined,
		headerTextColor: renderer.headerTextColor ? String(renderer.headerTextColor) : undefined,
		bodyTextColor: renderer.bodyTextColor ? String(renderer.bodyTextColor) : undefined,
		authorNameTextColor: renderer.authorNameTextColor
			? String(renderer.authorNameTextColor)
			: undefined,
		sticker
	};
};

const findRenderer = (action: any) => {
	const addItem = action.addChatItemAction?.item;
	const directItem = addItem ?? {};
	const rendererTypes = [
		'liveChatTextMessageRenderer',
		'liveChatPaidMessageRenderer',
		'liveChatPaidStickerRenderer',
		'liveChatMembershipItemRenderer',
		'liveChatSponsorshipsGiftPurchaseAnnouncementRenderer',
		'liveChatSponsorshipsGiftRedemptionAnnouncementRenderer'
	];
	for (const type of rendererTypes) {
		const renderer = directItem[type];
		if (renderer && typeof renderer === 'object') {
			return { rendererType: type, renderer, isTicker: false };
		}
	}
	const tickerItem = action.addLiveChatTickerItemAction?.item ?? {};
	const tickerCandidates = [
		{
			type: 'liveChatPaidMessageRenderer',
			path: [
				'liveChatTickerPaidMessageItemRenderer',
				'showItemEndpoint',
				'showLiveChatItemEndpoint',
				'renderer',
				'liveChatPaidMessageRenderer'
			]
		},
		{
			type: 'liveChatMembershipItemRenderer',
			path: [
				'liveChatTickerSponsorItemRenderer',
				'showItemEndpoint',
				'showLiveChatItemEndpoint',
				'renderer',
				'liveChatMembershipItemRenderer'
			]
		},
		{
			type: 'liveChatSponsorshipsGiftPurchaseAnnouncementRenderer',
			path: [
				'liveChatTickerSponsorItemRenderer',
				'showItemEndpoint',
				'showLiveChatItemEndpoint',
				'renderer',
				'liveChatSponsorshipsGiftPurchaseAnnouncementRenderer'
			]
		},
		{
			type: 'liveChatPaidStickerRenderer',
			path: [
				'liveChatTickerPaidStickerItemRenderer',
				'showItemEndpoint',
				'showLiveChatItemEndpoint',
				'renderer',
				'liveChatPaidStickerRenderer'
			]
		}
	];
	for (const candidate of tickerCandidates) {
		let current = tickerItem;
		for (const segment of candidate.path) {
			if (!current || typeof current !== 'object') {
				current = undefined;
				break;
			}
			current = current[segment];
		}
		if (current && typeof current === 'object') {
			return {
				rendererType: candidate.type,
				renderer: current,
				isTicker: true
			};
		}
	}
	return undefined;
};

const resolveContinuation = (response: any): string | undefined => {
	const continuation = response.continuationContents?.liveChatContinuation;
	const continuations = continuation?.continuations;
	if (!Array.isArray(continuations) || continuations.length === 0) {
		return undefined;
	}
	const c = continuations[0];
	const candidates = [
		c.timedContinuationData?.continuation,
		c.invalidationContinuationData?.continuation,
		c.liveChatReplayContinuationData?.continuation,
		c.playerSeekContinuationData?.continuation
	];
	return candidates.find((value) => typeof value === 'string');
};

export interface ParsedLivePage {
	liveId: string;
	apiKey: string;
	clientVersion: string;
	continuation: string;
}

export const parseLivePage = (rawHtml: string): ParsedLivePage => {
	const replayRegex = /"isReplay"\s*:\s*true/;
	if (replayRegex.test(rawHtml)) {
		throw new Error('Target live stream is a replay and cannot be monitored as active chat.');
	}
	const liveId =
		rawHtml.match(/"videoId"\s*:\s*"([^"]+)"/)?.[1] ??
		rawHtml.match(/canonical"\s+href="https:\/\/www\.youtube\.com\/watch\?v=([^"]+)"/)?.[1];
	const apiKey = rawHtml.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/)?.[1];
	const clientVersion = rawHtml.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION"\s*:\s*"([^"]+)"/)?.[1];
	const continuation = rawHtml.match(/"continuation"\s*:\s*"([^"]+)"/)?.[1];
	if (!liveId) {
		throw new Error('Live stream id was not found in page payload.');
	}
	if (!apiKey) {
		throw new Error('INNERTUBE_API_KEY was not found in page payload.');
	}
	if (!clientVersion) {
		throw new Error('INNERTUBE_CONTEXT_CLIENT_VERSION was not found in page payload.');
	}
	if (!continuation) {
		throw new Error('Initial continuation token was not found in page payload.');
	}
	return {
		liveId,
		apiKey,
		clientVersion,
		continuation
	};
};

export const parseLiveChatResponse = (response: any) => {
	if (!response || typeof response !== 'object') {
		return { actions: [] as any[], continuation: undefined };
	}
	const root = response;
	const continuation = root.continuationContents?.liveChatContinuation;
	const actions = Array.isArray(continuation?.actions) ? continuation.actions : [];
	return {
		actions,
		continuation: resolveContinuation(root)
	};
};

export const parseActionToChatItem = (actionValue: any): ChatItem | undefined => {
	if (!actionValue || typeof actionValue !== 'object') {
		return undefined;
	}
	const action = actionValue;
	const resolved = findRenderer(action);
	if (!resolved) {
		return undefined;
	}
	const { rendererType, renderer, isTicker } = resolved;
	const authorName = toText(renderer.authorName) ?? 'Unknown Author';
	const badgeState = parseBadges(renderer);
	const author = {
		name: authorName,
		channelId: String(renderer.authorExternalChannelId ?? ''),
		thumbnail: toImagePart(renderer.authorPhoto, authorName),
		badge: badgeState.badgeLabel
			? {
					label: badgeState.badgeLabel,
					thumbnail: badgeState.badgeThumbnail
				}
			: undefined
	};
	const messageRuns = renderer.message?.runs ?? renderer.headerSubtext?.runs;
	const rankTitle = renderer.beforeContentButtons?.[0]?.buttonViewModel?.title ?? '';
	const viewerLeaderboardRank =
		rankTitle.startsWith('#') && Number.isFinite(Number.parseInt(rankTitle.slice(1), 10))
			? Number.parseInt(rankTitle.slice(1), 10)
			: undefined;
	const membershipDetails = parseMembershipDetails(rendererType, renderer, authorName);
	const timestampUsec = Number(renderer.timestampUsec ?? Date.now() * 1000);
	return {
		id: String(renderer.id ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`),
		author,
		message: toMessageParts(messageRuns),
		superchat: parseSuperchat(rendererType, renderer),
		membershipDetails,
		isMembership: badgeState.isMembership || Boolean(membershipDetails),
		isVerified: badgeState.isVerified,
		isOwner: badgeState.isOwner,
		isModerator: badgeState.isModerator,
		timestamp: new Date(Math.floor(timestampUsec / 1000)),
		viewerLeaderboardRank,
		isTicker
	};
};

