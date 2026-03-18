import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as { code?: string; parser?: string };

	if (typeof body.code !== 'string' || body.code.trim().length === 0) {
		return json({ error: 'code is required' }, { status: 400 });
	}

	if (body.code.length > 100_000) {
		return json({ error: 'code exceeds size limit' }, { status: 400 });
	}

	const parser =
		body.parser === 'html' || body.parser === 'css' || body.parser === 'typescript'
			? body.parser
			: 'html';

	try {
		const prettier = await import('prettier');
		const formattedCode = await prettier.format(body.code, {
			parser,
			singleQuote: true,
			printWidth: 100
		});

		return json({ formattedCode });
	} catch (error) {
		return json(
			{
				error: error instanceof Error ? error.message : 'Format failed'
			},
			{ status: 400 }
		);
	}
};
