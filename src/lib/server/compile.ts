const countMatches = (value: string, pattern: RegExp): number => {
	const matches = value.match(pattern);
	return matches ? matches.length : 0;
};

const parseSource = (source: string) => {
	const scriptMatch = source.match(/<script[\s\S]*?>([\s\S]*?)<\/script>/i);
	const styleMatch = source.match(/<style[\s\S]*?>([\s\S]*?)<\/style>/i);

	const script = scriptMatch ? scriptMatch[1].trim() : '';
	const style = styleMatch ? styleMatch[1].trim() : '';
	const markup = source
		.replace(/<script[\s\S]*?<\/script>/gi, '')
		.replace(/<style[\s\S]*?<\/style>/gi, '')
		.trim();

	return { script, style, markup };
};

const composeSource = ({ script, style, markup }: { script: string; style: string; markup: string }) => {
	const chunks: string[] = [];

	if (script.length > 0) {
		chunks.push(`<script>\n${script}\n</script>`);
	}

	if (markup.length > 0) {
		chunks.push(markup);
	}

	if (style.length > 0) {
		chunks.push(`<style>\n${style}\n</style>`);
	}

	return `${chunks.join('\n\n')}\n`;
};

const ensureNodeGlobals = () => {
	if (typeof (globalThis as any).__filename === 'undefined') {
		Object.defineProperty(globalThis, '__filename', {
			value: '',
			configurable: true,
			writable: true
		});
	}
	if (typeof (globalThis as any).__dirname === 'undefined') {
		Object.defineProperty(globalThis, '__dirname', {
			value: '',
			configurable: true,
			writable: true
		});
	}
};

const transpileScript = async (script: string): Promise<string> => {
	if (!script.trim()) {
		return '';
	}

	try {
		ensureNodeGlobals();
		const ts = await import('typescript');
		const transpile = ts.default?.transpileModule ?? ts.transpileModule;
		const ScriptTarget = ts.default?.ScriptTarget ?? ts.ScriptTarget;
		const ModuleKind = ts.default?.ModuleKind ?? ts.ModuleKind;

		const result = transpile(script, {
			compilerOptions: {
				target: ScriptTarget.ES2020,
				module: ModuleKind.ESNext
			}
		});

		return result.outputText.trim();
	} catch (error) {
		throw new Error(`TypeScript compile failed: ${error instanceof Error ? error.message : String(error)}`);
	}
};

const encodeBase64Utf8 = (value: string): string => {
	if (typeof Buffer !== 'undefined') {
		return Buffer.from(value, 'utf-8').toString('base64');
	}
	const bytes = new TextEncoder().encode(value);
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
};

const toCompiledHtml = (source: string): string => {
	const encodedSource = encodeBase64Utf8(source);

	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<style>
			html,
			body,
			#app {
				margin: 0;
				width: 100%;
				height: 100%;
				background: transparent;
				overflow: hidden;
			}
		</style>
	</head>
	<body>
		<div id="app"></div>
		<script>
			window.__OVERLAY_SOURCE_B64 = ${JSON.stringify(encodedSource)};
		</script>
		<script src="/overlay-runtime.js"></script>
	</body>
</html>`;
};

export const compileOverlay = async (source: string): Promise<{ compiledHtml: string; warnings: string[] }> => {
	const scriptCount = countMatches(source, /<script[\s>]/gi);
	const styleCount = countMatches(source, /<style[\s>]/gi);

	if (scriptCount > 1) {
		throw new Error('Only one <script> block is supported.');
	}

	if (styleCount > 1) {
		throw new Error('Only one <style> block is supported.');
	}

	const parts = parseSource(source);
	const templateWithoutBlocks = parts.markup;

	if (templateWithoutBlocks.length === 0) {
		throw new Error('Markup is required outside <script> and <style> blocks.');
	}

	const transpiledScript = await transpileScript(parts.script);
	const runtimeSource = composeSource({
		script: transpiledScript,
		style: parts.style,
		markup: parts.markup
	});

	return {
		compiledHtml: toCompiledHtml(runtimeSource),
		warnings: []
	};
};
