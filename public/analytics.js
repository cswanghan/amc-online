// AMC Online Analytics SDK
(function() {
  'use strict';

  var SESSION_KEY = 'ka_sid';
  var queue = [];
  var flushTimer = null;
  var pageEnterTime = Date.now();
  var interactions = 0;

  // Session ID
  function getSessionId() {
    var sid = sessionStorage.getItem(SESSION_KEY);
    if (!sid || !/^[a-zA-Z0-9_-]{8,80}$/.test(sid)) {
      sid = 'sess_' + rand(8) + '_' + Date.now().toString(36);
      sessionStorage.setItem(SESSION_KEY, sid);
    }
    return sid;
  }

  function rand(n) {
    var c = 'abcdefghijklmnopqrstuvwxyz0123456789';
    var s = '';
    var bytes = crypto.getRandomValues(new Uint8Array(n));
    for (var i = 0; i < n; i++) s += c[bytes[i] % c.length];
    return s;
  }

  // Device type
  function deviceType() {
    var w = window.innerWidth || 800;
    if (w < 768) return 'mobile';
    if (w < 1024) return 'tablet';
    return 'desktop';
  }

  // Get user token
  function getToken() {
    try { return localStorage.getItem('token') || ''; } catch(e) { return ''; }
  }

  // Track event
  function track(eventName, opts) {
    opts = opts || {};
    var evt = {
      pagePath: location.pathname,
      eventName: String(eventName).slice(0, 80),
      eventGroup: opts.group || 'behavior',
      label: opts.label ? String(opts.label).slice(0, 120) : null,
      value: typeof opts.value === 'number' ? Math.round(opts.value) : null,
      deviceType: deviceType(),
      meta: sanitizeMeta(opts.meta || {})
    };
    queue.push(evt);
    if (opts.keepalive || queue.length >= 10) {
      flush(!!opts.keepalive);
    } else if (!flushTimer) {
      flushTimer = setTimeout(function() { flushTimer = null; flush(false); }, 5000);
    }
  }

  function sanitizeMeta(m) {
    var out = {};
    var keys = Object.keys(m).slice(0, 20);
    for (var i = 0; i < keys.length; i++) {
      var v = m[keys[i]];
      if (v == null) continue;
      if (typeof v === 'string') out[keys[i]] = v.slice(0, 300);
      else if (typeof v === 'number' || typeof v === 'boolean') out[keys[i]] = v;
    }
    return out;
  }

  function flush(keepalive) {
    if (!queue.length) return;
    var batch = queue.splice(0, 50);
    var headers = { 'Content-Type': 'application/json', 'X-Analytics-Session': getSessionId() };
    var token = getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    try {
      fetch('/api/analytics/track', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ events: batch }),
        keepalive: !!keepalive
      }).catch(function() {});
    } catch(e) {}
  }

  // Auto-track: page_view
  track('page_view', {
    group: 'performance',
    meta: {
      referrer: document.referrer || '',
      title: document.title,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight
    }
  });

  // Auto-track: page_load performance
  window.addEventListener('load', function() {
    setTimeout(function() {
      var p = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
      var loadTime = p ? Math.round(p.loadEventEnd) : 0;
      if (loadTime > 0) {
        track('page_load', { group: 'performance', value: loadTime });
        if (loadTime >= 4000) {
          track('page_load_slow', { group: 'friction', value: loadTime, label: location.pathname });
        }
      }
    }, 100);
  });

  // Auto-track: page_leave with duration
  function onLeave() {
    var duration = Math.round((Date.now() - pageEnterTime) / 1000);
    track('page_leave', {
      value: duration,
      keepalive: true,
      meta: { interactions: interactions, hidden: document.hidden }
    });
    if (duration < 15 && interactions <= 1) {
      track('low_engagement_bounce', {
        group: 'friction',
        value: duration,
        keepalive: true,
        label: location.pathname
      });
    }
  }
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'hidden') onLeave();
  });
  window.addEventListener('pagehide', onLeave);

  // Count interactions
  document.addEventListener('click', function() { interactions++; }, true);
  document.addEventListener('keydown', function() { interactions++; }, true);

  // Auto-track: JS errors
  window.addEventListener('error', function(e) {
    track('js_error', {
      group: 'error',
      label: (e.message || '').slice(0, 120),
      meta: { filename: e.filename, line: e.lineno, col: e.colno }
    });
  });
  window.addEventListener('unhandledrejection', function(e) {
    track('promise_rejection', {
      group: 'error',
      label: String(e.reason || '').slice(0, 120)
    });
  });

  // Public API
  var analyticsApi = {
    track: track,
    flush: function() { flush(false); },
    getSessionId: getSessionId
  };

  window.AMCAnalytics = analyticsApi;
  window.KangarooAnalytics = analyticsApi;
})();
