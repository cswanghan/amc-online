interface Env { DB: D1Database; JWT_SECRET: string; GITHUB_TOKEN: string; }

const TYPE_LABELS: Record<string, string> = {
  suggestion: '建议',
  praise: '表扬',
  bug: '问题',
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const user = (context.data as any).user;
  const body = await context.request.json() as { type: string; content: string };

  if (!body.content?.trim()) {
    return new Response(JSON.stringify({ error: '请输入内容' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const type = ['suggestion', 'praise', 'bug'].includes(body.type) ? body.type : 'suggestion';
  const content = body.content.trim().slice(0, 2000);
  const now = new Date().toISOString();

  // Save to D1
  await context.env.DB.prepare(
    'INSERT INTO feedback (user_id, username, type, content, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(user.id, user.username, type, content, now).run();

  // Create GitHub Issue (non-blocking)
  if (context.env.GITHUB_TOKEN) {
    const label = TYPE_LABELS[type] || type;
    const title = `[${label}] ${content.slice(0, 60)}${content.length > 60 ? '...' : ''}`;
    const issueBody = [
      `**类型**: ${label}`,
      `**用户**: ${user.username}`,
      `**时间**: ${now.slice(0, 16).replace('T', ' ')}`,
      '',
      '---',
      '',
      content,
    ].join('\n');

    try {
      await fetch('https://api.github.com/repos/cswanghan/kangaroo-levelb/issues', {
        method: 'POST',
        headers: {
          'Authorization': `token ${context.env.GITHUB_TOKEN}`,
          'Content-Type': 'application/json',
          'User-Agent': 'kangaroo-feedback',
        },
        body: JSON.stringify({
          title,
          body: issueBody,
          labels: ['feedback'],
        }),
      });
    } catch {
      // GitHub issue creation is best-effort, don't fail the request
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
