import { env } from '$env/dynamic/private';
import type { OverlayRecord } from '$lib/shared/types';

interface StoredOverlay {
	version: 1;
	id: string;
	name: string | null;
	code: string;
	compiledHtml: string;
	createdAt: string;
	updatedAt: string;
}

const GITHUB_GIST_API_URL = 'https://api.github.com/gists';
const GITHUB_GIST_MAX_BYTES = 1_000_000;
const GIST_FILE_NAME = 'overlay.json';

const isLikelyGistId = (value: string): boolean => /^[a-f0-9]{8,}$/i.test(value.trim());

const requireToken = (): string => {
	const token = env.GITHUB_GIST_TOKEN;
	if (!token || token.trim().length === 0) {
		throw new Error('Missing GITHUB_GIST_TOKEN.');
	}

	return token.trim();
};

const toOverlayRecord = (value: StoredOverlay): OverlayRecord => ({
	id: value.id,
	name: value.name,
	code: value.code,
	compiledHtml: value.compiledHtml,
	createdAt: value.createdAt,
	updatedAt: value.updatedAt
});

const buildGistHeaders = (token: string): Record<string, string> => ({
	Accept: 'application/vnd.github+json',
	Authorization: `Bearer ${token}`,
	'X-GitHub-Api-Version': '2022-11-28',
	'User-Agent': 'ytlc-styler',
	'Content-Type': 'application/json'
});

const parseStoredOverlay = (source: string): StoredOverlay | null => {
	let decoded: unknown;

	try {
		decoded = JSON.parse(source);
	} catch {
		return null;
	}

	if (!decoded || typeof decoded !== 'object') {
		return null;
	}

	const record = decoded as Partial<StoredOverlay>;
	if (
		record.version !== 1 ||
		typeof record.id !== 'string' ||
		(record.name !== null && typeof record.name !== 'string') ||
		typeof record.code !== 'string' ||
		typeof record.compiledHtml !== 'string' ||
		typeof record.createdAt !== 'string' ||
		typeof record.updatedAt !== 'string'
	) {
		return null;
	}

	return {
		version: 1,
		id: record.id,
		name: record.name,
		code: record.code,
		compiledHtml: record.compiledHtml,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt
	};
};

export const upsertOverlay = async (overlay: {
	id: string;
	name: string | null;
	code: string;
	compiledHtml: string;
}): Promise<OverlayRecord> => {
	const token = requireToken();
	const now = new Date().toISOString();

	const payload: StoredOverlay = {
		version: 1,
		id: overlay.id,
		name: overlay.name,
		code: overlay.code,
		compiledHtml: overlay.compiledHtml,
		createdAt: now,
		updatedAt: now
	};

	const payloadJson = JSON.stringify(payload);
	const payloadBytes = Buffer.byteLength(payloadJson, 'utf-8');
	if (payloadBytes > GITHUB_GIST_MAX_BYTES) {
		throw new Error(
			`Gist payload too large (${payloadBytes} bytes). Maximum supported size is ${GITHUB_GIST_MAX_BYTES} bytes.`
		);
	}

	const gistRequestBody = JSON.stringify({
		description: overlay.name?.trim() || `ytlc-overlay-${now}`,
		public: false,
		files: {
			[GIST_FILE_NAME]: {
				content: payloadJson
			}
		}
	});

	if (isLikelyGistId(overlay.id)) {
		const updateResponse = await fetch(`${GITHUB_GIST_API_URL}/${encodeURIComponent(overlay.id)}`, {
			method: 'PATCH',
			headers: buildGistHeaders(token),
			body: gistRequestBody
		});

		if (updateResponse.ok) {
			return {
				...toOverlayRecord(payload),
				id: overlay.id
			};
		}

		if (updateResponse.status !== 404 && updateResponse.status !== 422) {
			const errorBody = await updateResponse.text();
			throw new Error(
				`Gist update failed (${updateResponse.status}): ${errorBody || updateResponse.statusText}`
			);
		}
	}

	const response = await fetch(GITHUB_GIST_API_URL, {
		method: 'POST',
		headers: buildGistHeaders(token),
		body: gistRequestBody
	});

	if (!response.ok) {
		const errorBody = await response.text();
		throw new Error(`Gist save failed (${response.status}): ${errorBody || response.statusText}`);
	}

	const gist = (await response.json()) as { id?: string };
	if (!gist.id || typeof gist.id !== 'string') {
		throw new Error('Gist save failed: missing gist id in response.');
	}

	return {
		...toOverlayRecord(payload),
		id: gist.id
	};
};

export const getOverlayById = async (id: string): Promise<OverlayRecord | null> => {
	const response = await fetch(`${GITHUB_GIST_API_URL}/${encodeURIComponent(id)}`, {
		headers: {
			Accept: 'application/vnd.github+json',
			'X-GitHub-Api-Version': '2022-11-28',
			'User-Agent': 'ytlc-styler'
		}
	});
	if (response.status === 404) {
		return null;
	}

	if (!response.ok) {
		throw new Error(`Gist read failed (${response.status})`);
	}

	const gist = (await response.json()) as {
		files?: Record<string, { content?: string; truncated?: boolean }>;
	};

	const files = gist.files;
	if (!files || typeof files !== 'object') {
		return null;
	}

	const preferred = files[GIST_FILE_NAME];
	const fallback = Object.values(files)[0];
	const file = preferred ?? fallback;
	if (!file || typeof file.content !== 'string') {
		return null;
	}

	if (file.truncated) {
		throw new Error('Gist content is truncated and cannot be read fully.');
	}

	const source = file.content;
	const stored = parseStoredOverlay(source);
	if (!stored) {
		return null;
	}

	return {
		...toOverlayRecord(stored),
		id
	};
};
