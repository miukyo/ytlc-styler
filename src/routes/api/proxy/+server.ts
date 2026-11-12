import type { RequestHandler } from './$types';

const ALLOWED_PROTOCOLS = ['https:'];

function isSafeUrl(raw: string | null): boolean {
    if (!raw) return false;
    try {
        const u = new URL(raw);
        return ALLOWED_PROTOCOLS.includes(u.protocol);
    } catch {
        return false;
    }
}

export const GET: RequestHandler = async ({ url, request }) => {
    const target = url.searchParams.get('url');
    if (!isSafeUrl(target)) {
        return new Response('invalid or missing url query param', { status: 400 });
    }

    try {
        const headers = new Headers();
        // Forward some client headers that might be useful (e.g. accept)
        const incoming = request.headers;
        for (const name of ['accept', 'accept-encoding', 'user-agent']) {
            const v = incoming.get(name);
            if (v) headers.set(name, v);
        }

        const res = await fetch(target as string, { headers, redirect: 'follow' });

        const responseHeaders: Record<string, string> = {};
        res.headers.forEach((v, k) => (responseHeaders[k] = v));

        const body = await res.arrayBuffer();
        return new Response(body, {
            status: res.status,
            headers: responseHeaders
        });
    } catch (err) {
        return new Response(String(err instanceof Error ? err.message : 'proxy error'), { status: 502 });
    }
};

export const POST: RequestHandler = async ({ url, request }) => {
    const target = url.searchParams.get('url');
    if (!isSafeUrl(target)) {
        return new Response('invalid or missing url query param', { status: 400 });
    }

    try {
        const reqHeaders = new Headers();
        const incoming = request.headers;
        for (const [k, v] of incoming.entries()) {
            if (k.toLowerCase() === 'host') continue;
            reqHeaders.set(k, v as string);
        }

        const res = await fetch(target as string, {
            method: 'POST',
            headers: reqHeaders,
            body: await request.arrayBuffer(),
            redirect: 'follow'
        });

        const responseHeaders: Record<string, string> = {};
        res.headers.forEach((v, k) => (responseHeaders[k] = v));

        const body = await res.arrayBuffer();
        return new Response(body, { status: res.status, headers: responseHeaders });
    } catch (err) {
        return new Response(String(err instanceof Error ? err.message : 'proxy error'), { status: 502 });
    }
};

export const DELETE: RequestHandler = async ({ url }) => {
    const target = url.searchParams.get('url');
    if (!isSafeUrl(target)) {
        return new Response('invalid or missing url query param', { status: 400 });
    }

    try {
        const res = await fetch(target as string, { method: 'DELETE', redirect: 'follow' });
        const body = await res.arrayBuffer();
        const responseHeaders: Record<string, string> = {};
        res.headers.forEach((v, k) => (responseHeaders[k] = v));
        return new Response(body, { status: res.status, headers: responseHeaders });
    } catch (err) {
        return new Response(String(err instanceof Error ? err.message : 'proxy error'), { status: 502 });
    }
};
