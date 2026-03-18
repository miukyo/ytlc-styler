<svelte:options runes={false} />

<script lang="ts">
	import { browser } from "$app/environment";
	import { onMount } from "svelte";
	import {
		Button,
		TextField,
		Tabs,
		Card,
		TextFieldOutlined,
		Select,
		SelectOutlined,
		Dialog,
	} from "m3-svelte";

	import { ChatBridge } from "$lib/client/chat-bridge";
	import { DEFAULT_OVERLAY_SOURCE } from "$lib/shared/default-overlay";
	import type { OverlayExportResponse } from "$lib/shared/types";

	const DRAFTS_KEY = "ytlc-styler:drafts:v3";
	const ACTIVE_DRAFT_KEY = "ytlc-styler:active-draft:v3";
	const LEGACY_DRAFT_KEY = "ytlc-styler:draft:v2";

	const WINDOW_CHAT_D_TS = `
	
declare global {
	type MembershipEventType = 'Unknown' | 'New' | 'Milestone' | 'GiftPurchase' | 'GiftRedemption';

	interface ImagePart {
		type: 'image';
		url: string;
		alt?: string;
	}

	interface EmojiPart {
		type: 'emoji';
		url: string;
		alt?: string;
		emojiText: string;
		isCustomEmoji: boolean;
	}

	interface TextPart {
		type: 'text';
		text: string;
	}

	type MessagePart = TextPart | EmojiPart | ImagePart;

	interface Badge {
		label: string;
		thumbnail?: ImagePart;
	}

	interface Author {
		name: string;
		channelId: string;
		thumbnail?: ImagePart;
		badge?: Badge;
	}

	interface Superchat {
		amountString: string;
		amountValue: number;
		currency: string;
		bodyBackgroundColor: string;
		headerBackgroundColor?: string;
		headerTextColor?: string;
		bodyTextColor?: string;
		authorNameTextColor?: string;
		sticker?: ImagePart;
	}

	interface MembershipDetails {
		eventType: MembershipEventType;
		levelName: string;
		membershipBadgeLabel?: string;
		headerPrimaryText?: string;
		headerSubtext?: string;
		milestoneMonths?: number;
		gifterUsername?: string;
		giftCount?: number;
		recipientUsername?: string;
	}

	interface ChatItem {
		id: string;
		author: Author;
		message: MessagePart[];
		superchat?: Superchat;
		membershipDetails?: MembershipDetails;
		isMembership: boolean;
		isVerified: boolean;
		isOwner: boolean;
		isModerator: boolean;
		timestamp: Date;
		viewerLeaderboardRank?: number;
		isTicker: boolean;
	}

	interface ChatStartOptions {
		handle?: string;
		channelId?: string;
		liveId?: string;
		overwrite?: boolean;
	}

	interface ChatDummyOptions {
		mode?: 'random' | 'text' | 'membership' | 'superchat' | 'sticker';
		text?: string;
		authorName?: string;
		amount?: number;
		currency?: string;
	}

	interface WindowChat {
		subscribe(callback: (chatItem: ChatItem) => void): () => void;
		start(options?: ChatStartOptions): void;
		stop(): void;
		sendDummy(options?: ChatDummyOptions): void;
	}

	interface Window {
		chat: WindowChat;
	}
}

export {};
`.trim();

	const DEFAULT_HTML = (() => {
		const markup = DEFAULT_OVERLAY_SOURCE.replace(
			/<script[\s\S]*?<\/script>/gi,
			"",
		)
			.replace(/<style[\s\S]*?<\/style>/gi, "")
			.trim();
		return markup;
	})();

	const DEFAULT_CSS = (() => {
		const styleMatch = DEFAULT_OVERLAY_SOURCE.match(
			/<style[\s\S]*?>([\s\S]*?)<\/style>/i,
		);
		return styleMatch ? styleMatch[1].trim() : "";
	})();

	const DEFAULT_TS = (() => {
		const scriptMatch = DEFAULT_OVERLAY_SOURCE.match(
			/<script[\s\S]*?>([\s\S]*?)<\/script>/i,
		);
		return scriptMatch ? scriptMatch[1].trim() : "";
	})();

	type DraftEntry = {
		id: string;
		name: string;
		html: string;
		css: string;
		ts: string;
		updatedAt: string;
	};

	const createDraftId = () =>
		globalThis.crypto?.randomUUID?.() ??
		`${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

	const makeDraft = (partial?: Partial<DraftEntry>): DraftEntry => ({
		id: partial?.id ?? createDraftId(),
		name: partial?.name ?? "Untitled Draft",
		html: partial?.html ?? DEFAULT_HTML,
		css: partial?.css ?? DEFAULT_CSS,
		ts: partial?.ts ?? DEFAULT_TS,
		updatedAt: partial?.updatedAt ?? new Date().toISOString(),
	});

	let htmlCode = DEFAULT_HTML;
	let cssCode = DEFAULT_CSS;
	let tsCode = DEFAULT_TS;
	let drafts: DraftEntry[] = [];
	let activeDraftId = "";
	let activeDraftName = "";
	let importDraftId = "";
	let openImportDialog = false;
	let isImportingDraft = false;
	type EditorTab = "html" | "css" | "ts";
	const tabOrder: Record<EditorTab, number> = { html: 0, css: 1, ts: 2 };
	const editorTabs = [
		{ name: "HTML", value: "html" },
		{ name: "CSS", value: "css" },
		{ name: "TypeScript", value: "ts" },
	];
	let activeTab: EditorTab = "html";
	let compileError = "";
	let exportUrl = "";
	let isExporting = false;
	let isCompiling = false;
	let isConnected = false;
	let frameReady = false;
	let exportFailed = false;
	let previewStatus = "waiting for preview runtime";
	let previewUrl = "/overlay-frame.html";
	let handle = "";
	let channelId = "";
	let liveId = "";

	let htmlEditorRoot: HTMLElement | null = null;
	let cssEditorRoot: HTMLElement | null = null;
	let tsEditorRoot: HTMLElement | null = null;
	let previewFrame: HTMLIFrameElement | null = null;

	type EditorModel = {
		getValue: () => string;
		setValue: (value: string) => void;
		onDidChangeContent: (handler: () => void) => { dispose: () => void };
		dispose?: () => void;
	};

	type ModelSubscription = { dispose: () => void };

	let htmlModel: EditorModel | null = null;
	let cssModel: EditorModel | null = null;
	let tsModel: EditorModel | null = null;
	let modelSubscriptions: ModelSubscription[] = [];
	let editorInstances: Array<{ dispose: () => void; layout?: () => void }> = [];
	let compileTimer: ReturnType<typeof setTimeout> | undefined;

	const chatBridge = new ChatBridge();

	const composeSource = () => {
		const scriptCloseTag = "</scr" + "ipt>";
		return `<script>\n${tsCode}\n${scriptCloseTag}\n\n${htmlCode}\n\n<style>\n${cssCode}\n</style>\n`;
	};

	const splitSource = (source: string) => {
		const scriptMatch = source.match(/<script[\s\S]*?>([\s\S]*?)<\/script>/i);
		const styleMatch = source.match(/<style[\s\S]*?>([\s\S]*?)<\/style>/i);

		const script = scriptMatch ? scriptMatch[1].trim() : "";
		const style = styleMatch ? styleMatch[1].trim() : "";
		const markup = source
			.replace(/<script[\s\S]*?<\/script>/gi, "")
			.replace(/<style[\s\S]*?<\/style>/gi, "")
			.trim();

		return {
			html: markup,
			css: style,
			ts: script,
		};
	};

	const persistDrafts = () => {
		if (!browser) {
			return;
		}

		localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
		localStorage.setItem(ACTIVE_DRAFT_KEY, activeDraftId);
	};

	const saveCurrentDraft = () => {
		if (!activeDraftId) {
			return;
		}

		const next: DraftEntry = {
			id: activeDraftId,
			name:
				activeDraftName.trim().length > 0
					? activeDraftName.trim()
					: "Untitled Draft",
			html: htmlCode,
			css: cssCode,
			ts: tsCode,
			updatedAt: new Date().toISOString(),
		};

		const index = drafts.findIndex((draft) => draft.id === activeDraftId);
		if (index === -1) {
			drafts = [next, ...drafts];
		} else {
			drafts = drafts.map((draft, draftIndex) =>
				draftIndex === index ? next : draft,
			);
		}

		activeDraftName = next.name;
		persistDrafts();
	};

	const applyDraft = (draft: DraftEntry) => {
		activeDraftId = draft.id;
		activeDraftName = draft.name;
		// importDraftId = draft.id;
		htmlCode = draft.html;
		cssCode = draft.css;
		tsCode = draft.ts;

		htmlModel?.setValue(draft.html);
		cssModel?.setValue(draft.css);
		tsModel?.setValue(draft.ts);
	};

	const switchDraft = (id: string) => {
		syncSourceFromModels();
		saveCurrentDraft();

		const next = drafts.find((draft) => draft.id === id);
		if (!next) {
			return;
		}

		applyDraft(next);
		persistDrafts();
		scheduleCompile();
	};

	const createNewDraft = () => {
		syncSourceFromModels();
		saveCurrentDraft();

		const next = makeDraft({
			name: `Draft ${drafts.length + 1}`,
		});

		drafts = [next, ...drafts];
		applyDraft(next);
		persistDrafts();
		scheduleCompile();
	};

	const duplicateCurrentDraft = () => {
		syncSourceFromModels();
		saveCurrentDraft();

		const source = drafts.find((draft) => draft.id === activeDraftId);
		if (!source) {
			return;
		}

		const next = makeDraft({
			name: `${source.name} Copy`,
			html: source.html,
			css: source.css,
			ts: source.ts,
		});

		drafts = [next, ...drafts];
		applyDraft(next);
		persistDrafts();
		scheduleCompile();
	};

	const deleteCurrentDraft = () => {
		if (drafts.length <= 1 || !activeDraftId) {
			return;
		}

		const currentIndex = drafts.findIndex(
			(draft) => draft.id === activeDraftId,
		);
		if (currentIndex === -1) {
			return;
		}

		drafts = drafts.filter((draft) => draft.id !== activeDraftId);
		const fallback =
			drafts[currentIndex] ?? drafts[currentIndex - 1] ?? drafts[0];
		if (!fallback) {
			return;
		}

		applyDraft(fallback);
		persistDrafts();
		scheduleCompile();
	};

	const renameCurrentDraft = (value: string) => {
		activeDraftName = value;

		const index = drafts.findIndex((draft) => draft.id === activeDraftId);
		if (index === -1) {
			return;
		}

		drafts = drafts.map((draft, draftIndex) =>
			draftIndex === index
				? {
					...draft,
					name: value,
					updatedAt: new Date().toISOString(),
				}
				: draft,
		);
		persistDrafts();
	};

	const commitCurrentDraftName = () => {
		saveCurrentDraft();
	};

	const importDraftById = async (rawId?: string) => {
		const id = (rawId ?? importDraftId).trim();
		if (!id) {
			compileError = "draft uuid is required";
			return;
		}

		isImportingDraft = true;
		compileError = "";

		try {
			syncSourceFromModels();
			saveCurrentDraft();

			const response = await fetch(`/api/overlays/${encodeURIComponent(id)}`);
			const payload = (await response.json()) as {
				id?: string;
				name?: string | null;
				code?: string;
				error?: string;
			};

			if (
				!response.ok ||
				typeof payload.code !== "string" ||
				typeof payload.id !== "string"
			) {
				throw new Error(payload.error ?? "Unable to import draft");
			}

			const parsed = splitSource(payload.code);
			const imported = makeDraft({
				id: payload.id,
				name:
					payload.name && payload.name.trim().length > 0
						? payload.name
						: `Imported ${payload.id.slice(0, 8)}`,
				html: parsed.html || DEFAULT_HTML,
				css: parsed.css || DEFAULT_CSS,
				ts: parsed.ts || DEFAULT_TS,
				updatedAt: new Date().toISOString(),
			});

			const index = drafts.findIndex((draft) => draft.id === imported.id);
			if (index === -1) {
				drafts = [imported, ...drafts];
			} else {
				drafts = drafts.map((draft, draftIndex) =>
					draftIndex === index ? imported : draft,
				);
			}

			applyDraft(imported);
			persistDrafts();
			scheduleCompile();
		} catch (error) {
			compileError =
				error instanceof Error ? error.message : "Unable to import draft";
		} finally {
			isImportingDraft = false;
		}
	};

	const syncSourceFromModels = () => {
		htmlCode = htmlModel?.getValue() ?? htmlCode;
		cssCode = cssModel?.getValue() ?? cssCode;
		tsCode = tsModel?.getValue() ?? tsCode;
	};

	const postToPreview = (message: unknown) => {
		if (!previewFrame?.contentWindow || !frameReady) {
			previewStatus = "preview runtime not ready";
			return;
		}
		previewFrame.contentWindow.postMessage(message, "*");
	};

	const validateAndPreview = async () => {
		isCompiling = true;
		compileError = "";
		try {
			syncSourceFromModels();
			const source = composeSource();
			const response = await fetch("/api/preview", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ code: source }),
			});

			const payload = (await response.json()) as {
				previewUrl?: string;
				error?: string;
			};

			if (!response.ok || !payload.previewUrl) {
				throw new Error(payload.error ?? "Compile failed");
			}

			frameReady = false;
			previewStatus = "loading preview html";
			previewUrl = payload.previewUrl;
		} catch (error) {
			compileError = error instanceof Error ? error.message : "Compile failed";
		} finally {
			isCompiling = false;
		}
	};

	const scheduleCompile = () => {
		if (compileTimer) {
			clearTimeout(compileTimer);
		}
		compileTimer = setTimeout(() => {
			void validateAndPreview();
		}, 250);
	};

	const formatSource = async () => {
		try {
			syncSourceFromModels();

			const [htmlResponse, cssResponse, tsResponse] = await Promise.all([
				fetch("/api/format", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ code: htmlCode, parser: "html" }),
				}),
				fetch("/api/format", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ code: cssCode, parser: "css" }),
				}),
				fetch("/api/format", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ code: tsCode, parser: "typescript" }),
				}),
			]);

			if (!htmlResponse.ok || !cssResponse.ok || !tsResponse.ok) {
				return;
			}

			const [htmlPayload, cssPayload, tsPayload] = (await Promise.all([
				htmlResponse.json() as Promise<{ formattedCode: string }>,
				cssResponse.json() as Promise<{ formattedCode: string }>,
				tsResponse.json() as Promise<{ formattedCode: string }>,
			])) as [
				{ formattedCode: string },
				{ formattedCode: string },
				{ formattedCode: string },
			];

			htmlCode = htmlPayload.formattedCode;
			cssCode = cssPayload.formattedCode;
			tsCode = tsPayload.formattedCode;
			saveCurrentDraft();

			htmlModel?.setValue(htmlCode);
			cssModel?.setValue(cssCode);
			tsModel?.setValue(tsCode);
			scheduleCompile();
		} catch {
			// ignore
		}
	};

	const exportOverlay = async () => {
		isExporting = true;
		exportUrl = "";
		try {
			const handleValue = handle.trim();
			const channelIdValue = channelId.trim();
			const liveIdValue = liveId.trim();

			if (!handleValue && !channelIdValue && !liveIdValue) {
				throw new Error("Export requires handle, channelId, or liveId.");
			}

			syncSourceFromModels();
			const source = composeSource();
			const response = await fetch("/api/overlays", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					id: activeDraftId,
					name: activeDraftName,
					handle: handleValue || undefined,
					channelId: channelIdValue || undefined,
					liveId: liveIdValue || undefined,
					code: source,
				}),
			});

			const payload = (await response.json()) as OverlayExportResponse & {
				error?: string;
			};
			if (!response.ok) {
				throw new Error(payload.error ?? "Export failed");
			}

			if (response.ok) {
				exportFailed = false;
			}

			if (payload.id !== activeDraftId) {
				activeDraftId = payload.id;
			}
			saveCurrentDraft();
			exportUrl = payload.url;
		} catch (error) {
			compileError = error instanceof Error ? error.message : "Export failed";
			exportFailed = true;
		} finally {
			isExporting = false;
		}
	};

	const startChat = async () => {
		await chatBridge.start({
			handle: handle || undefined,
			channelId: channelId || undefined,
			liveId: liveId || undefined,
			overwrite: true,
		});
		isConnected = true;
	};

	const stopChat = async () => {
		await chatBridge.stop();
		isConnected = false;
	};

	$: {
		const index = tabOrder[activeTab];
		editorInstances[index]?.layout?.();
	}

	onMount(() => {
		if (!htmlEditorRoot || !cssEditorRoot || !tsEditorRoot) {
			return;
		}

		const init = async () => {
			if (browser) {
				const rawDrafts = localStorage.getItem(DRAFTS_KEY);
				if (rawDrafts) {
					try {
						const parsed = JSON.parse(rawDrafts) as unknown;
						if (Array.isArray(parsed)) {
							drafts = parsed
								.filter((item): item is DraftEntry => {
									if (!item || typeof item !== "object") {
										return false;
									}

									const maybe = item as Partial<DraftEntry>;
									return (
										typeof maybe.id === "string" &&
										typeof maybe.name === "string" &&
										typeof maybe.html === "string" &&
										typeof maybe.css === "string" &&
										typeof maybe.ts === "string"
									);
								})
								.map((item) => makeDraft(item));
						}
					} catch {
						// fall through to legacy migration
					}
				}

				if (drafts.length === 0) {
					const legacyDraft = localStorage.getItem(LEGACY_DRAFT_KEY);
					if (legacyDraft) {
						const legacy = splitSource(legacyDraft);
						drafts = [
							makeDraft({
								name: "Migrated Draft",
								html: legacy.html || DEFAULT_HTML,
								css: legacy.css || DEFAULT_CSS,
								ts: legacy.ts || DEFAULT_TS,
							}),
						];
					}
				}

				if (drafts.length === 0) {
					drafts = [makeDraft()];
				}

				const savedActiveId = localStorage.getItem(ACTIVE_DRAFT_KEY);
				const initialDraft =
					drafts.find((draft) => draft.id === savedActiveId) ?? drafts[0];
				if (initialDraft) {
					activeDraftId = initialDraft.id;
					activeDraftName = initialDraft.name;
					// importDraftId = initialDraft.id;
					htmlCode = initialDraft.html;
					cssCode = initialDraft.css;
					tsCode = initialDraft.ts;
				}

				persistDrafts();
			}

			const { init } = await import("modern-monaco");
			const monaco = await init({
				defaultTheme: "one-dark-pro",
				langs: ["html", "css", "typescript", "javascript", "json"],
			});
			monaco.editor.createModel(
				WINDOW_CHAT_D_TS,
				"typescript",
				monaco.Uri.file("/window-chat.d.ts"),
			);

			htmlModel = monaco.editor.createModel(
				htmlCode,
				"html",
				monaco.Uri.file("/overlay.html"),
			) as EditorModel;
			cssModel = monaco.editor.createModel(
				cssCode,
				"css",
				monaco.Uri.file("/overlay.css"),
			) as EditorModel;
			tsModel = monaco.editor.createModel(
				tsCode,
				"typescript",
				monaco.Uri.file("/overlay.ts"),
			) as EditorModel;

			editorInstances = [
				monaco.editor.create(htmlEditorRoot!, {
					model: htmlModel as unknown as never,
					automaticLayout: true,
					wordWrap: "on",
					fontSize: 14,
					theme: "one-dark-pro",
				}),
				monaco.editor.create(cssEditorRoot!, {
					model: cssModel as unknown as never,
					automaticLayout: true,
					wordWrap: "on",
					fontSize: 14,
					theme: "one-dark-pro",
				}),
				monaco.editor.create(tsEditorRoot!, {
					model: tsModel as unknown as never,
					automaticLayout: true,
					wordWrap: "on",
					fontSize: 14,
					theme: "one-dark-pro",
				}),
			] as Array<{ dispose: () => void; layout?: () => void }>;

			modelSubscriptions.push(
				htmlModel.onDidChangeContent(() => {
					htmlCode = htmlModel?.getValue() ?? "";
					saveCurrentDraft();
					scheduleCompile();
				}),
				cssModel.onDidChangeContent(() => {
					cssCode = cssModel?.getValue() ?? "";
					saveCurrentDraft();
					scheduleCompile();
				}),
				tsModel.onDidChangeContent(() => {
					tsCode = tsModel?.getValue() ?? "";
					saveCurrentDraft();
					scheduleCompile();
				}),
			);

			htmlCode = htmlModel.getValue();
			cssCode = cssModel.getValue();
			tsCode = tsModel.getValue();

			saveCurrentDraft();

			const unsubscribe = chatBridge.subscribe((chatItem) => {
				postToPreview({ type: "chat:item", payload: chatItem });
			});

			window.addEventListener("message", async (event) => {
				if (!previewFrame || event.source !== previewFrame.contentWindow) {
					return;
				}
				const payload = event.data ?? {};
				if (payload.type === "overlay:ready") {
					frameReady = true;
					previewStatus = "runtime ready";
					return;
				}
				if (payload.type === "overlay:error") {
					previewStatus = "runtime error";
					compileError =
						payload.payload?.message ??
						"Preview runtime failed to mount source.";
					return;
				}
				if (payload.type === "overlay:mounted") {
					previewStatus = "overlay mounted";
					if (!compileError) {
						compileError = "";
					}
					return;
				}
				if (payload.type === "chat:start") {
					await chatBridge.start(payload.payload ?? {});
					isConnected = true;
					return;
				}
				if (payload.type === "chat:stop") {
					await chatBridge.stop();
					isConnected = false;
					return;
				}
				if (payload.type === "chat:dummy") {
					await chatBridge.sendDummy(payload.payload);
				}
			});

			scheduleCompile();

			return () => {
				unsubscribe();
			};
		};

		const cleanupPromise = init();
		return () => {
			if (compileTimer) {
				clearTimeout(compileTimer);
			}
			for (const subscription of modelSubscriptions) {
				subscription.dispose();
			}
			for (const editor of editorInstances) {
				editor.dispose();
			}
			editorInstances = [];
			htmlModel?.dispose?.();
			cssModel?.dispose?.();
			tsModel?.dispose?.();
			modelSubscriptions = [];
			htmlModel = null;
			cssModel = null;
			tsModel = null;
			cleanupPromise.then((cleanup) => cleanup?.());
			void chatBridge.stop();
			chatBridge.disconnect();
		};
	});
</script>

<main class="editor-shell">
	<header>
		<Card variant="elevated">
			<div class="drafts-row">
				<div
					style="width: 100%; display: grid; gap: 0.5rem; grid-template-columns: 1fr 1fr;"
				>
					<SelectOutlined
						value={activeDraftId}
						onchange={(event) =>
							switchDraft((event.currentTarget as HTMLSelectElement).value)}
						label="Drafts"
						options={drafts.map((draft) => ({
							value: draft.id,
							text: draft.name,
						}))}
						style="width: 150px; white-space: nowrap;"
					></SelectOutlined>
					<TextFieldOutlined
						label="Draft Name"
						type="text"
						value={activeDraftName}
						oninput={(event) =>
							renameCurrentDraft(
								(event.currentTarget as HTMLInputElement).value,
							)}
						onchange={commitCurrentDraftName}
						onblur={commitCurrentDraftName}
						placeholder="Draft name"
					/>
				</div>
				<div
					style="display: grid; gap: 0.25rem; width: 100%; grid-template-columns: 1fr 1fr 1fr;"
				>
					<Button size="m" variant="tonal" onclick={createNewDraft}>New</Button>
					<!-- <Button size="m" variant="tonal" onclick={duplicateCurrentDraft}
						>Duplicate</Button
					> -->
					<Button
						size="m"
						variant="tonal"
						onclick={() => (openImportDialog = true)}
					>
						Import
					</Button>
					<Button
						size="m"
						variant="filled"
						disabled={drafts.length <= 1}
						onclick={deleteCurrentDraft}
					>
						Delete
					</Button>
				</div>

				<!-- <TextFieldOutlined label="Import UUID" bind:value={importDraftId} />
				<Button
					variant="outlined"
					disabled={isImportingDraft}
					onclick={() => importDraftById()}
				>
					{isImportingDraft ? "Importing..." : "Import"}
				</Button> -->
			</div>
		</Card>

		<Card variant="elevated">
			<div
				style="display: grid; gap: 0.5rem; grid-template-columns: 1fr 1fr 1fr;"
			>
				<TextFieldOutlined
					error={exportFailed}
					onkeydown={() => (exportFailed = false)}
					label="Handle"
					bind:value={handle}
				/>

				<TextFieldOutlined
					error={exportFailed}
					onkeydown={() => (exportFailed = false)}
					label="Channel ID"
					bind:value={channelId}
				/>

				<TextFieldOutlined
					error={exportFailed}
					onkeydown={() => (exportFailed = false)}
					label="Live ID"
					bind:value={liveId}
				/>
			</div>
			<div
				style="display: grid; gap: 0.25rem; margin-top: 0.5rem; grid-template-columns: 1fr 1fr 1fr;"
			>
				<Button
					size="m"
					variant="tonal"
					onclick={isConnected ? stopChat : startChat}
				>
					{isConnected ? "Stop Chat" : "Start Chat"}
				</Button>
				<Button
					size="m"
					variant="tonal"
					onclick={() =>
						chatBridge.sendDummy({
							mode: "text",
							text: "test message",
							authorName: "dev",
						})}
				>
					Send Dummy
				</Button>
				<!-- <Button size="m" variant="tonal" onclick={formatSource}>Auto Format</Button> -->
				<Button
					size="m"
					disabled={isExporting}
					variant="filled"
					onclick={exportOverlay}
				>
					{isExporting ? "Exporting..." : "Export Overlay"}
				</Button>
			</div>
		</Card>
	</header>

	<section class="workspace">
		<div class="editor-stack">
			<div class="tabs-wrap">
				<Tabs items={editorTabs} bind:tab={activeTab} />
			</div>
			<div class="editor-panels">
				<div class="editor-card tab-pane" class:active={activeTab === "html"}>
					<div class="editor-title">HTML</div>
					<div class="editor-panel" bind:this={htmlEditorRoot}></div>
				</div>
				<div class="editor-card tab-pane" class:active={activeTab === "css"}>
					<div class="editor-title">CSS</div>
					<div class="editor-panel" bind:this={cssEditorRoot}></div>
				</div>
				<div class="editor-card tab-pane" class:active={activeTab === "ts"}>
					<div class="editor-title">TypeScript</div>
					<div class="editor-panel" bind:this={tsEditorRoot}></div>
				</div>
			</div>
		</div>
		<div class="preview-panel">
			<iframe
				title="preview"
				bind:this={previewFrame}
				sandbox="allow-scripts"
				allowtransparency
				src={previewUrl}
			></iframe>
		</div>
	</section>

	<footer>
		<p>
			{isCompiling ? "Compiling..." : "Ready"} | {previewStatus}{isConnected
				? " | chat connected"
				: ""}
		</p>
		{#if compileError}
			<p class="error">{compileError}</p>
		{/if}
		<!-- {#if exportUrl} -->
		<!-- <p class="success">
				OBS URL: <a href={exportUrl} target="_blank" rel="noreferrer"
					>{exportUrl}</a
				>
			</p> -->

		<!-- {/if} -->
	</footer>
	<Dialog
		open={!!exportUrl}
		// onclose={() => (exportUrl = "")}
		headline="Export Successful!"
	>
		Copy the URL below to use the overlay in OBS or share with others:
		<a href={exportUrl} target="_blank" rel="noreferrer">{exportUrl}</a>

		{#snippet buttons()}
			<Button variant="filled">Close</Button>
		{/snippet}
	</Dialog>
	<Dialog
		open={openImportDialog}
		onclose={() => (openImportDialog = false)}
		headline="Import Draft"
	>
		<p>
			Enter the UUID of a previously exported draft to import it into the
			editor.
		</p>
		<div style="width: 100%; display: grid;">
			<TextFieldOutlined label="Import UUID" bind:value={importDraftId} />
		</div>

		{#snippet buttons()}
			<Button
				variant="filled"
				disabled={isImportingDraft}
				onclick={() => importDraftById()}>Import</Button
			>
		{/snippet}
	</Dialog>
</main>

<style>
	.editor-shell {
		display: grid;
		grid-template-rows: auto 1fr auto;
		gap: 0.8rem;
		height: 100vh;
		padding: 0.75rem;
		max-width: 1200px;
		margin: auto;
	}

	header {
		display: flex;
		gap: 0.8rem;
	}

	.controls,
	.actions,
	.drafts-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.workspace {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.8rem;
		min-height: 0;
	}

	.editor-stack {
		display: grid;
		grid-template-rows: auto 1fr;
		gap: 0.6rem;
		min-height: 0;
	}

	.editor-panels {
		position: relative;
		min-height: 0;
	}

	.tabs-wrap {
		background: var(--m3c-surface-container);
		border-radius: 1rem;
		overflow: hidden;
		border: 1px solid var(--m3c-outline-variant);
	}

	.editor-card {
		display: grid;
		grid-template-rows: auto 1fr;
		min-height: 0;
		border-radius: 0.85rem;
		overflow: hidden;
		/* background: var(--m3c-surface-container); */
		border: 1px solid var(--m3c-outline-variant);
	}

	.tab-pane {
		position: absolute;
		inset: 0;
		opacity: 0;
		transform: translateX(10px);
		pointer-events: none;
		transition:
			opacity 160ms ease,
			transform 180ms ease;
	}

	.tab-pane.active {
		opacity: 1;
		transform: translateX(0);
		pointer-events: auto;
		z-index: 1;
	}

	.editor-title {
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		padding: 0.4rem 0.6rem;
		color: var(--m3c-on-surface-variant);
	}

	.editor-panel,
	.preview-panel {
		min-height: 0;
		overflow: hidden;
	}

	.preview-panel {
		border-radius: 0.85rem;
		background-position:
			0px 0px,
			15px 15px;
		background-size: 30px 30px;
		background-repeat: repeat;
		background-image:
			linear-gradient(
				45deg,
				rgb(238, 238, 238) 25%,
				transparent 25%,
				transparent 75%,
				rgb(238, 238, 238) 75%,
				rgb(238, 238, 238) 100%
			),
			linear-gradient(
				45deg,
				rgb(238, 238, 238) 25%,
				rgb(255, 255, 255) 25%,
				rgb(255, 255, 255) 75%,
				rgb(238, 238, 238) 75%,
				rgb(238, 238, 238) 100%
			);
	}

	iframe {
		width: 100%;
		height: 100%;
		border: 0;
		background: rgba(0, 0, 0, 0.3);
		color-scheme: normal;
	}

	footer {
		display: flex;
		gap: 0.8rem;
		align-items: center;
		flex-wrap: wrap;
		p {
			margin: 0;
		}
	}

	.error {
		color: #b91c1c;
	}

	.success {
		color: #0f766e;
	}

	@media (max-width: 960px) {
		.workspace {
			grid-template-columns: 1fr;
			grid-template-rows: minmax(22rem, 2fr) minmax(16rem, 1fr);
		}
	}
</style>
