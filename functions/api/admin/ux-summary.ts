interface Env { DB: D1Database; JWT_SECRET: string; }

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const url = new URL(context.request.url);
    const days = Math.min(Math.max(parseInt(url.searchParams.get('days') || '7'), 1), 30);
    const since = new Date(Date.now() - days * 86400000).toISOString();

    const [overview, pages, friction, auth, quiz, quizFunnel] = await Promise.all([
      // 1. Overview
      context.env.DB.prepare(`
        SELECT
          COUNT(*) FILTER (WHERE event_name = 'page_view') AS pageViews,
          COUNT(DISTINCT session_id) FILTER (WHERE event_name = 'page_view') AS activeSessions,
          COUNT(*) FILTER (WHERE event_group = 'error') AS errors,
          COALESCE(AVG(value) FILTER (WHERE event_name = 'page_leave' AND value > 0), 0) AS avgDurationSeconds,
          COUNT(*) FILTER (WHERE event_name = 'low_engagement_bounce') AS bounces
        FROM ux_events WHERE created_at >= ?
      `).bind(since).first<any>(),

      // 2. Top pages
      context.env.DB.prepare(`
        SELECT
          page_path AS pagePath,
          COUNT(*) AS views,
          COALESCE(AVG(CASE WHEN event_name = 'page_leave' THEN value END), 0) AS avgDurationSeconds,
          COUNT(CASE WHEN event_name = 'low_engagement_bounce' THEN 1 END) AS bounceCount
        FROM ux_events
        WHERE created_at >= ? AND event_name IN ('page_view', 'page_leave', 'low_engagement_bounce')
        GROUP BY page_path
        ORDER BY views DESC LIMIT 8
      `).bind(since).all(),

      // 3. Friction events
      context.env.DB.prepare(`
        SELECT event_name AS eventName, COUNT(*) AS total
        FROM ux_events
        WHERE created_at >= ? AND event_name IN (
          'js_error', 'promise_rejection', 'page_load_slow',
          'auth_login_failure', 'auth_register_failure',
          'quiz_in_progress_leave', 'quiz_submit_failed',
          'low_engagement_bounce'
        )
        GROUP BY event_name ORDER BY total DESC
      `).bind(since).all(),

      // 4. Auth events
      context.env.DB.prepare(`
        SELECT
          COUNT(*) FILTER (WHERE event_name = 'auth_login_attempt') AS loginAttempts,
          COUNT(*) FILTER (WHERE event_name = 'auth_login_success') AS loginSuccess,
          COUNT(*) FILTER (WHERE event_name = 'auth_login_failure') AS loginFailure,
          COUNT(*) FILTER (WHERE event_name = 'auth_register_attempt') AS registerAttempts,
          COUNT(*) FILTER (WHERE event_name = 'auth_register_success') AS registerSuccess,
          COUNT(*) FILTER (WHERE event_name = 'auth_register_failure') AS registerFailure
        FROM ux_events WHERE created_at >= ?
      `).bind(since).first<any>(),

      // 5. Quiz events
      context.env.DB.prepare(`
        SELECT
          COUNT(*) FILTER (WHERE event_name = 'quiz_start') AS starts,
          COUNT(*) FILTER (WHERE event_name = 'quiz_submit_attempt') AS submitAttempts,
          COUNT(*) FILTER (WHERE event_name = 'quiz_submit_success') AS submitSuccess,
          COUNT(*) FILTER (WHERE event_name = 'quiz_save_history_success') AS saveHistorySuccess,
          COUNT(*) FILTER (WHERE event_name = 'quiz_submit_failed') AS submitFailed,
          COUNT(*) FILTER (WHERE event_name = 'quiz_in_progress_leave') AS inProgressLeave
        FROM ux_events WHERE created_at >= ?
      `).bind(since).first<any>(),

      // 6. Quiz funnel
      context.env.DB.prepare(`
        SELECT
          event_name AS key,
          COUNT(DISTINCT session_id) AS count
        FROM ux_events
        WHERE created_at >= ? AND event_name IN (
          'home_entry_click', 'quiz_selector_view', 'quiz_test_select',
          'quiz_start', 'quiz_progress_checkpoint',
          'quiz_submit_attempt', 'quiz_submit_success', 'quiz_save_history_success'
        )
        GROUP BY event_name
      `).bind(since).all(),
    ]);

    // Build funnel with labels
    const funnelOrder = [
      { key: 'home_entry_click', label: '首页点进练习' },
      { key: 'quiz_selector_view', label: '看到年份选择' },
      { key: 'quiz_test_select', label: '选择具体套卷' },
      { key: 'quiz_start', label: '开始作答' },
      { key: 'quiz_progress_checkpoint', label: '做到 50%' },
      { key: 'quiz_submit_attempt', label: '提交答卷' },
      { key: 'quiz_submit_success', label: '提交成功' },
      { key: 'quiz_save_history_success', label: '保存历史记录' },
    ];

    const funnelMap: Record<string, number> = {};
    for (const r of (quizFunnel.results || []) as any[]) {
      funnelMap[r.key] = r.count;
    }
    const quizFunnelData = funnelOrder.map(f => ({
      ...f,
      count: funnelMap[f.key] || 0,
    }));

    return json({
      days,
      since,
      overview: {
        pageViews: overview?.pageViews || 0,
        activeSessions: overview?.activeSessions || 0,
        errors: overview?.errors || 0,
        avgDurationSeconds: Math.round(overview?.avgDurationSeconds || 0),
        bounces: overview?.bounces || 0,
      },
      pages: pages.results || [],
      friction: friction.results || [],
      auth: {
        loginAttempts: auth?.loginAttempts || 0,
        loginSuccess: auth?.loginSuccess || 0,
        loginFailure: auth?.loginFailure || 0,
        registerAttempts: auth?.registerAttempts || 0,
        registerSuccess: auth?.registerSuccess || 0,
        registerFailure: auth?.registerFailure || 0,
      },
      quiz: {
        starts: quiz?.starts || 0,
        submitAttempts: quiz?.submitAttempts || 0,
        submitSuccess: quiz?.submitSuccess || 0,
        saveHistorySuccess: quiz?.saveHistorySuccess || 0,
        submitFailed: quiz?.submitFailed || 0,
        inProgressLeave: quiz?.inProgressLeave || 0,
      },
      quizFunnel: quizFunnelData,
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
