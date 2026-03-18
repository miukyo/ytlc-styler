import { splitOverlaySource } from "$lib/shared/overlay-source";

let typescriptModulePromise: Promise<typeof import("typescript")> | null = null;

const countMatches = (value: string, pattern: RegExp): number => {
	const matches = value.match(pattern);
	return matches ? matches.length : 0;
};

const composeRuntimeSource = ({
	script,
	style,
	markup,
}: {
	script: string;
	style: string;
	markup: string;
}) => {
	const chunks: string[] = [];
	const scriptCloseTag = "</scr" + "ipt>";

	if (script.length > 0) {
		chunks.push(`<script>\n${script}\n${scriptCloseTag}`);
	}

	if (markup.length > 0) {
		chunks.push(markup);
	}

	if (style.length > 0) {
		chunks.push(`<style>\n${style}\n</style>`);
	}

	return `${chunks.join("\n\n")}\n`;
};

const encodeBase64Utf8 = (value: string): string => {
	const bytes = new TextEncoder().encode(value);
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
};

const toCompiledHtml = (runtimeSource: string): string => {
	const encodedSource = encodeBase64Utf8(runtimeSource);
	const scriptCloseTag = "</scr" + "ipt>";

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
		${scriptCloseTag}
		<script src="/overlay-runtime.js">${scriptCloseTag}
	</body>
</html>`;
};

const getTypescriptModule = async () => {
	if (!typescriptModulePromise) {
		typescriptModulePromise = import("typescript");
	}

	return typescriptModulePromise;
};

const transpileScript = async (script: string): Promise<string> => {
	if (!script.trim()) {
		return "";
	}

	const ts = await getTypescriptModule();
	const result = ts.transpileModule(script, {
		compilerOptions: {
			target: ts.ScriptTarget.ES2020,
			module: ts.ModuleKind.ESNext,
		},
		reportDiagnostics: true,
	});

	if (result.diagnostics && result.diagnostics.length > 0) {
		const first = result.diagnostics[0];
		const message = ts.flattenDiagnosticMessageText(first.messageText, "\n");

		let location = "";
		if (first.file && typeof first.start === "number") {
			const position = first.file.getLineAndCharacterOfPosition(first.start);
			location = `line ${position.line + 1}:${position.character + 1} `;
		}

		throw new Error(`TypeScript compile failed: ${location}${message}`.trim());
	}

	return result.outputText.trim();
};

export const compileOverlayInBrowser = async (source: string) => {
	const scriptCount = countMatches(source, /<script[\s>]/gi);
	const styleCount = countMatches(source, /<style[\s>]/gi);

	if (scriptCount > 1) {
		throw new Error("Only one <script> block is supported.");
	}

	if (styleCount > 1) {
		throw new Error("Only one <style> block is supported.");
	}

	const parts = splitOverlaySource(source);
	if (parts.html.trim().length === 0) {
		throw new Error("Markup is required outside <script> and <style> blocks.");
	}

	const transpiledScript = await transpileScript(parts.ts);
	const runtimeSource = composeRuntimeSource({
		script: transpiledScript,
		style: parts.css,
		markup: parts.html,
	});

	return {
		runtimeSource,
		compiledHtml: toCompiledHtml(runtimeSource),
	};
};
