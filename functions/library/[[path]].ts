import { verifyJWT } from '../../src/auth';
import { AccessLimitError, enforceAccessLimit } from '../../src/access';

interface Env {
  DB: D1Database;
  JWT_SECRET: string;
  ASSETS: Fetcher;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const pathname = new URL(context.request.url).pathname;
    const match = pathname.match(/^\/library\/([abc])\/(\d{4})\/([^/]+)$/i);
    if (!match) {
      return new Response('Not found', { status: 404 });
    }

    const [, level, yearText, filename] = match;
    const resourceType = filename.startsWith('paper')
      ? 'paper'
      : filename.startsWith('answer')
        ? 'answer'
        : 'asset';

    const authHeader = context.request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return json({ error: '未登录' }, 401);
    }

    const payload = await verifyJWT(authHeader.slice(7), context.env.JWT_SECRET);
    if (!payload) {
      return json({ error: '登录已过期' }, 401);
    }

    await enforceAccessLimit(context.env, payload as any, 'download', resourceType, level, Number(yearText));

    const response = await context.env.ASSETS.fetch(context.request);
    if (!response.ok) return response;

    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'private, max-age=0, no-store');
    headers.set('X-Robots-Tag', 'noindex');
    return new Response(response.body, { status: response.status, headers });
  } catch (e: any) {
    if (e instanceof AccessLimitError) {
      return json(e.payload, e.status);
    }
    return json({ error: e.message || 'Internal error' }, 500);
  }
};

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
