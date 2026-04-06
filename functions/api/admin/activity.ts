interface Env { DB: D1Database; JWT_SECRET: string; }

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    // Per-user aggregate stats
    const users = await context.env.DB.prepare(`
      SELECT
        u.id,
        u.username,
        u.email,
        u.role,
        u.status,
        u.created_at AS registered_at,
        COUNT(qs.id) AS total_quizzes,
        ROUND(AVG(qs.score), 1) AS avg_score,
        MAX(qs.score) AS best_score,
        SUM(qs.correct) AS total_correct,
        SUM(qs.total) AS total_questions,
        COUNT(DISTINCT qs.level) AS levels_practiced,
        MAX(qs.created_at) AS last_quiz_at
      FROM users u
      LEFT JOIN quiz_sessions qs ON qs.user_id = u.id
      GROUP BY u.id
      ORDER BY last_quiz_at DESC NULLS LAST, u.created_at DESC
    `).all();

    // Global summary
    const summary = await context.env.DB.prepare(`
      SELECT
        COUNT(DISTINCT user_id) AS active_users,
        COUNT(*) AS total_sessions,
        ROUND(AVG(score), 1) AS platform_avg_score,
        SUM(correct) AS platform_correct,
        SUM(total) AS platform_total
      FROM quiz_sessions
    `).first<any>();

    // Recent 7-day daily activity
    const daily = await context.env.DB.prepare(`
      SELECT
        DATE(created_at) AS date,
        COUNT(*) AS sessions,
        COUNT(DISTINCT user_id) AS users,
        ROUND(AVG(score), 1) AS avg_score
      FROM quiz_sessions
      WHERE created_at >= datetime('now', '-7 days')
      GROUP BY 1
      ORDER BY 1 DESC
    `).all();

    return new Response(JSON.stringify({
      users: users.results,
      summary: {
        totalUsers: users.results?.length || 0,
        activeUsers: summary?.active_users || 0,
        totalSessions: summary?.total_sessions || 0,
        platformAvgScore: summary?.platform_avg_score || 0,
        platformAccuracy: summary?.platform_total > 0
          ? Math.round((summary.platform_correct / summary.platform_total) * 10000) / 100
          : 0,
      },
      daily: daily.results || [],
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
