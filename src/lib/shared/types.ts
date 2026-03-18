export interface OverlayRecord {
	id: string;
	name: string | null;
	code: string;
	compiledHtml: string;
	createdAt: string;
	updatedAt: string;
}

export interface OverlayExportResponse {
	id: string;
	url: string;
}

export interface CompileResponse {
	compiledHtml: string;
	warnings: string[];
}
