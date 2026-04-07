interface Env { DB: D1Database; JWT_SECRET: string; }

interface AccessBody {
  category?: string;
  resourceType?: string;
  level?: string;
  year?: number;
}

const LIMIT = 5;
const CATEGORY_LABEL: Record<string, string> = {
  download: '下载',
  practice: '练习',
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const user = (context as any).user || context.data?.user;
    if (!user?.userId) {
      return json({ error: '未登录' }, 401);
    }

    const body = await context.request.json<AccessBody>();
    const category = body.category?.trim();
    const resourceType = body.resourceType?.trim();
    const level = body.level?.trim().toLowerCase() || null;
    const year = Number.isFinite(Number(body.year)) ? Number(body.year) : null;

    if (!category || !resourceType || !CATEGORY_LABEL[category]) {
      return json({ error: '参数错误' }, 400);
    }

    if (user.role === 'admin') {
      await context.env.DB.prepare(
        'INSERT INTO resource_access_logs (user_id, category, resource_type, level, year) VALUES (?, ?, ?, ?, ?)'
      ).bind(user.userId, category, resourceType, level, year).run();

      return json({ ok: true, limit: null, used: null, remaining: null });
    }

    const countResult = await context.env.DB.prepare(
      'SELECT COUNT(*) as count FROM resource_access_logs WHERE user_id = ? AND category = ?'
    ).bind(user.userId, category).first<{ count: number | string }>();

    const used = Number(countResult?.count || 0);
    if (used >= LIMIT) {
      return json({
        error: `普通用户最多只能${CATEGORY_LABEL[category]} ${LIMIT} 次`,
        limit: LIMIT,
        used,
        remaining: 0,
      }, 403);
    }

    await context.env.DB.prepare(
      'INSERT INTO resource_access_logs (user_id, category, resource_type, level, year) VALUES (?, ?, ?, ?, ?)'
    ).bind(user.userId, category, resourceType, level, year).run();

    return json({
      ok: true,
      limit: LIMIT,
      used: used + 1,
      remaining: LIMIT - used - 1,
    });
  } catch (e: any) {
    return json({ error: e.message || 'Internal error' }, 500);
  }
};

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
