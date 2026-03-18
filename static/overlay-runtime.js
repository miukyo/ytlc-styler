(() => {
	const root = document.getElementById('app');
	let styleTag = null;
	const listeners = new Set();

	window.chat = {
		subscribe(callback) {
			listeners.add(callback);
			return () => listeners.delete(callback);
		},
		start(options) {
			parent.postMessage({ type: 'chat:start', payload: options ?? {} }, '*');
		},
		stop() {
			parent.postMessage({ type: 'chat:stop' }, '*');
		},
		sendDummy(options) {
			parent.postMessage({ type: 'chat:dummy', payload: options ?? {} }, '*');
		}
	};

	const emitChat = (item) => {
		for (const listener of listeners) {
			try {
				listener(item);
			} catch {
				// Ignore user callback errors.
			}
		}
	};

	const parseSource = (source) => {
		const scriptMatch = source.match(/<script[\s\S]*?>([\s\S]*?)<\/script>/i);
		const styleMatch = source.match(/<style[\s\S]*?>([\s\S]*?)<\/style>/i);

		const script = scriptMatch ? scriptMatch[1] : '';
		const style = styleMatch ? styleMatch[1] : '';

		const markup = source
			.replace(/<script[\s\S]*?<\/script>/gi, '')
			.replace(/<style[\s\S]*?<\/style>/gi, '')
			.trim();

		return { script, style, markup };
	};

	const applyStyle = (styleText) => {
		if (styleTag) {
			styleTag.remove();
			styleTag = null;
		}

		if (typeof styleText !== 'string' || styleText.length === 0) {
			return;
		}

		styleTag = document.createElement('style');
		styleTag.textContent = styleText;
		document.head.appendChild(styleTag);
	};

	const mountSource = (source) => {
		const parts = parseSource(source);

		if (!parts.markup) {
			root.innerHTML = '';
			return;
		}

		applyStyle(parts.style);

		root.innerHTML = parts.markup;

		const state = new Proxy({}, {
			set(target, key, value) {
				target[key] = value;
				return true;
			}
		});

		const setState = (patch) => {
			if (!patch || typeof patch !== 'object') {
				return;
			}
			Object.assign(state, patch);
		};

		if (parts.script.trim()) {
			const runScript = new Function('chat', 'state', 'root', 'setState', parts.script);
			runScript(window.chat, state, root, setState);
		}

		parent.postMessage({ type: 'overlay:mounted' }, '*');
	};

	window.addEventListener('message', (event) => {
		const data = event.data ?? {};

		if (data.type === 'overlay:mount' && typeof data.payload?.source === 'string') {
			try {
				mountSource(data.payload.source);
			} catch (error) {
				console.error('[overlay-runtime] mount failed', error);
				parent.postMessage(
					{
						type: 'overlay:error',
						payload: {
							message: error instanceof Error ? error.message : String(error)
						}
					},
					'*'
				);
			}
			return;
		}

		if (data.type === 'overlay:style') {
			applyStyle(typeof data.payload?.style === 'string' ? data.payload.style : '');
			return;
		}

		if (data.type === 'chat:item') {
			emitChat(data.payload);
		}
	});

	const decodeBase64Utf8 = (value) => {
		try {
			const binary = atob(value);
			const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
			return new TextDecoder().decode(bytes);
		} catch {
			return '';
		}
	};

	const initialSource =
		typeof window.__OVERLAY_SOURCE_B64 === 'string'
			? decodeBase64Utf8(window.__OVERLAY_SOURCE_B64)
			: typeof window.__OVERLAY_SOURCE === 'string'
				? window.__OVERLAY_SOURCE
				: '';

	if (initialSource.length > 0) {
		try {
			mountSource(initialSource);
		} catch (error) {
			console.error('[overlay-runtime] initial mount failed', error);
		}
	}

	parent.postMessage({ type: 'overlay:ready' }, '*');
})();
