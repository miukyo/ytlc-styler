export type OverlayParts = {
	html: string;
	css: string;
	ts: string;
};

const SCRIPT_BLOCK_PATTERN = /<script[\s\S]*?>[\s\S]*?<\/script>/gi;
const STYLE_BLOCK_PATTERN = /<style[\s\S]*?>[\s\S]*?<\/style>/gi;

export const splitOverlaySource = (source: string): OverlayParts => {
	const scriptMatch = source.match(/<script[\s\S]*?>([\s\S]*?)<\/script>/i);
	const styleMatch = source.match(/<style[\s\S]*?>([\s\S]*?)<\/style>/i);

	const script = scriptMatch ? scriptMatch[1].trim() : "";
	const style = styleMatch ? styleMatch[1].trim() : "";
	const markup = source
		.replace(SCRIPT_BLOCK_PATTERN, "")
		.replace(STYLE_BLOCK_PATTERN, "")
		.trim();

	return {
		html: markup,
		css: style,
		ts: script,
	};
};

export const composeOverlaySource = (parts: OverlayParts): string => {
	const scriptCloseTag = "</scr" + "ipt>";
	return `<script>\n${parts.ts}\n${scriptCloseTag}\n\n${parts.html}\n\n<style>\n${parts.css}\n</style>\n`;
};

export const defaultsFromOverlaySource = (source: string): OverlayParts => {
	return splitOverlaySource(source);
};
