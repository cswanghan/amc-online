export const ACCESS_LIMIT = 5;

const CATEGORY_LABEL: Record<string, string> = {
  download: '下载',
  practice: '练习',
};

interface AccessEnv {
  DB: D1Database;
}

interface AccessUser {
  userId: number;
  role?: string;
}

export class AccessLimitError extends Error {
  status: number;
  payload: Record<string, unknown>;

  constructor(status: number, payload: Record<string, unknown>) {
    super(String(payload.error || 'Access denied'));
    this.status = status;
    this.payload = payload;
  }
}

export async function enforceAccessLimit(
  env: AccessEnv,
  user: AccessUser | null | undefined,
  category: string,
  resourceType: string,
  level?: string | null,
  year?: number | null,
) {
  if (!user?.userId) {
    throw new AccessLimitError(401, { error: '未登录' });
  }

  if (!CATEGORY_LABEL[category]) {
    throw new AccessLimitError(400, { error: '参数错误' });
  }

  const normalizedLevel = level?.trim().toLowerCase() || null;
  const normalizedYear = Number.isFinite(Number(year)) ? Number(year) : null;

  if (user.role === 'admin') {
    await env.DB.prepare(
      'INSERT INTO resource_access_logs (user_id, category, resource_type, level, year) VALUES (?, ?, ?, ?, ?)'
    ).bind(user.userId, category, resourceType, normalizedLevel, normalizedYear).run();

    return { ok: true, limit: null, used: null, remaining: null };
  }

  const countResult = await env.DB.prepare(
    'SELECT COUNT(*) as count FROM resource_access_logs WHERE user_id = ? AND category = ?'
  ).bind(user.userId, category).first<{ count: number | string }>();

  const used = Number(countResult?.count || 0);
  if (used >= ACCESS_LIMIT) {
    throw new AccessLimitError(403, {
      error: `普通用户最多只能${CATEGORY_LABEL[category]} ${ACCESS_LIMIT} 次`,
      limit: ACCESS_LIMIT,
      used,
      remaining: 0,
    });
  }

  await env.DB.prepare(
    'INSERT INTO resource_access_logs (user_id, category, resource_type, level, year) VALUES (?, ?, ?, ?, ?)'
  ).bind(user.userId, category, resourceType, normalizedLevel, normalizedYear).run();

  return {
    ok: true,
    limit: ACCESS_LIMIT,
    used: used + 1,
    remaining: ACCESS_LIMIT - used - 1,
  };
}
