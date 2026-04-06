interface Env { DB: D1Database; JWT_SECRET: string; }

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const user = (context as any).user || context.data?.user;
    if (!user?.userId) {
      return new Response(JSON.stringify({ error: '未登录' }), {
        status: 401, headers: { 'Content-Type': 'application/json' },
      });
    }

    const codes = await context.env.DB.prepare(
      'SELECT code, max_uses, used_count, expires_at, created_at FROM invite_codes WHERE creator_id = ? ORDER BY created_at DESC'
    ).bind(user.userId).all();

    return new Response(JSON.stringify({ codes: codes.results }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || 'Internal error' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};
