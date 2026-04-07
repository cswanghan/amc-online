import { verifyJWT } from '../../../src/auth';

interface Env { DB: D1Database; JWT_SECRET: string; }

interface RawEvent {
  pagePath: string;
  eventName: string;
  eventGroup?: string;
  label?: string | null;
  value?: number | null;
  deviceType?: string;
  meta?: Record<string, unknown>;
}

const VALID_DEVICES = ['mobile', 'tablet', 'desktop'];

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const body = await context.request.json<{ events: RawEvent[] }>();
    const events = (body.events || []).slice(0, 50);
    if (!events.length) {
      return json({ saved: 0 });
    }

    const sessionId = context.request.headers.get('X-Analytics-Session') || 'unknown';

    // Optional user from JWT
    let userId: number | null = null;
    const auth = context.request.headers.get('Authorization');
    if (auth?.startsWith('Bearer ')) {
      const payload = await verifyJWT(auth.slice(7), context.env.JWT_SECRET);
      if (payload?.userId) userId = payload.userId;
    }

    const stmt = context.env.DB.prepare(
      'INSERT INTO ux_events (session_id, user_id, page_path, event_name, event_group, label, value, device_type, meta_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );

    const batch = events.map(e => {
      const device = VALID_DEVICES.includes(e.deviceType || '') ? e.deviceType! : 'desktop';
      const meta = e.meta ? sanitizeMeta(e.meta) : null;
      return stmt.bind(
        sessionId.slice(0, 80),
        userId,
        (e.pagePath || '/').slice(0, 120),
        (e.eventName || 'unknown').slice(0, 80),
        (e.eventGroup || 'behavior').slice(0, 40),
        e.label ? String(e.label).slice(0, 120) : null,
        typeof e.value === 'number' ? Math.round(e.value) : null,
        device,
        meta ? JSON.stringify(meta) : null
      );
    });

    await context.env.DB.batch(batch);
    return json({ saved: batch.length });
  } catch (e: any) {
    if (String(e?.message || '').includes('no such table: ux_events')) {
      return json({ saved: 0, skipped: true, reason: 'ux_events_missing' });
    }
    return json({ error: e.message || 'Internal error' }, 500);
  }
};

function sanitizeMeta(m: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const keys = Object.keys(m).slice(0, 20);
  for (const k of keys) {
    const v = m[k];
    if (v == null) continue;
    if (typeof v === 'string') out[k] = v.slice(0, 300);
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
  }
  return out;
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
