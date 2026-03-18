interface PreviewEntry {
	html: string;
	expiresAt: number;
}

const PREVIEW_TTL_MS = 10 * 60 * 1000;
const previews = new Map<string, PreviewEntry>();

const purgeExpired = (): void => {
	const now = Date.now();
	for (const [id, entry] of previews.entries()) {
		if (entry.expiresAt > now) {
			continue;
		}
		previews.delete(id);
	}
};

export const savePreview = (id: string, html: string): void => {
	purgeExpired();
	previews.set(id, {
		html,
		expiresAt: Date.now() + PREVIEW_TTL_MS
	});
};

export const getPreview = (id: string): string | null => {
	purgeExpired();
	const entry = previews.get(id);
	if (!entry) {
		return null;
	}
	entry.expiresAt = Date.now() + PREVIEW_TTL_MS;
	return entry.html;
};
