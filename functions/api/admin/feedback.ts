interface Env { DB: D1Database; JWT_SECRET: string; }

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const url = new URL(context.request.url);
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = 20;
    const offset = (page - 1) * limit;

    const [rows, countRow] = await Promise.all([
      context.env.DB.prepare(
        'SELECT * FROM feedback ORDER BY created_at DESC LIMIT ? OFFSET ?'
      ).bind(limit, offset).all(),
      context.env.DB.prepare('SELECT COUNT(*) as total FROM feedback').first<{ total: number }>(),
    ]);

    return new Response(JSON.stringify({
      feedback: rows.results,
      total: countRow?.total || 0,
      page,
      pages: Math.ceil((countRow?.total || 0) / limit),
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || 'Internal error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
