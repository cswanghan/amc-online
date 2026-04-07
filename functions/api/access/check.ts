import { AccessLimitError, enforceAccessLimit } from '../../../src/access';

interface Env { DB: D1Database; JWT_SECRET: string; }

interface AccessBody {
  category?: string;
  resourceType?: string;
  level?: string;
  year?: number;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const user = (context as any).user || context.data?.user;
    if (!user?.userId) {
      return json({ error: '未登录' }, 401);
    }

    const body = await context.request.json<AccessBody>();
    const category = body.category?.trim();
    const resourceType = body.resourceType?.trim();
    if (!category || !resourceType) {
      return json({ error: '参数错误' }, 400);
    }

    const result = await enforceAccessLimit(context.env, user, category, resourceType, body.level, body.year);
    return json(result);
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
