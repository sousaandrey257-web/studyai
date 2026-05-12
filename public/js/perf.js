/* ============================================================
   StudyAI — Performance & Stability Core  v1
   Loaded first on every page. Zero dependencies.
   ============================================================ */
(function (win, doc) {
  'use strict';

  /* ── 1. Global Error Boundary ─────────────────────────────
     Prevents white-screen-of-death from uncaught errors.
     In production: silently catches. In debug mode: logs.     */
  win.__studyDebug = win.__studyDebug ||
    (typeof location !== 'undefined' &&
      (location.hostname === 'localhost' || location.hostname === '127.0.0.1'));

  win.onerror = function (msg, src, line, col, err) {
    if (win.__studyDebug) {
      console.error('[StudyAI]', msg, '\n  at', src + ':' + line + ':' + col);
    }
    return false; // do not suppress — let browser devtools still show it
  };

  win.addEventListener('unhandledrejection', function (e) {
    if (win.__studyDebug) {
      console.warn('[StudyAI] UnhandledPromise:', e.reason);
    }
  });

  /* ── 2. Safe localStorage ─────────────────────────────────
     Gracefully handles private browsing / quota exceeded.      */
  win.safeStore = {
    get: function (key, fallback) {
      if (fallback === undefined) fallback = null;
      try {
        var v = localStorage.getItem(key);
        if (v === null) return fallback;
        try { return JSON.parse(v); } catch { return v; }
      } catch { return fallback; }
    },
    set: function (key, val) {
      try {
        localStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val));
        return true;
      } catch { return false; }
    },
    remove: function (key) {
      try { localStorage.removeItem(key); } catch {}
    },
    clear: function () {
      try { localStorage.clear(); } catch {}
    }
  };

  /* ── 3. Debounce ──────────────────────────────────────────
     Returns a function that delays fn until after `ms` ms
     have elapsed since the last invocation.                    */
  win.debounce = function (fn, ms) {
    var t;
    return function () {
      var a = arguments, ctx = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, a); }, ms || 150);
    };
  };

  /* ── 4. Throttle ──────────────────────────────────────────
     Ensures fn is called at most once per `ms` ms.             */
  win.throttle = function (fn, ms) {
    var last = 0, t;
    return function () {
      var now = Date.now(), a = arguments, ctx = this;
      var remaining = (ms || 100) - (now - last);
      if (remaining <= 0) {
        clearTimeout(t);
        last = now;
        fn.apply(ctx, a);
      } else {
        clearTimeout(t);
        t = setTimeout(function () { last = Date.now(); fn.apply(ctx, a); }, remaining);
      }
    };
  };

  /* ── 5. RAF Batcher ───────────────────────────────────────
     Coalesces multiple calls into a single animation frame.    */
  win.rafBatch = function (fn) {
    var pending = false;
    return function () {
      var a = arguments, ctx = this;
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () {
        pending = false;
        fn.apply(ctx, a);
      });
    };
  };

  /* ── 6. Fetch with Retry ──────────────────────────────────
     Wraps fetch() with exponential-backoff retry logic.
     Only retries network errors (not 4xx/5xx responses).       */
  win.fetchRetry = function (url, opts, retries) {
    retries = (retries === undefined) ? 2 : retries;
    var delay = 600;
    function attempt(n) {
      return fetch(url, opts).catch(function (err) {
        if (n <= 0) throw err;
        return new Promise(function (res) {
          setTimeout(function () { res(attempt(n - 1)); }, delay * (retries - n + 1));
        });
      });
    }
    return attempt(retries);
  };

  /* ── 7. Passive Listener Helper ───────────────────────────
     Adds event listener with passive:true where supported.     */
  var _passiveSupported = false;
  try {
    var opts = Object.defineProperty({}, 'passive', {
      get: function () { _passiveSupported = true; }
    });
    win.addEventListener('test', null, opts);
    win.removeEventListener('test', null, opts);
  } catch {}

  win.addPassive = function (el, type, fn) {
    el.addEventListener(type, fn, _passiveSupported ? { passive: true } : false);
  };

  /* ── 8. Cleanup Registry ──────────────────────────────────
     Register teardown functions to run before page unloads.    */
  var _cleanup = [];
  win.registerCleanup = function (fn) {
    if (typeof fn === 'function') _cleanup.push(fn);
  };
  win.addEventListener('pagehide', function () {
    _cleanup.forEach(function (fn) { try { fn(); } catch {} });
  });

  /* ── 9. Device Quality Detection ─────────────────────────
     Detects slow devices to reduce animation cost.             */
  win.__slowDevice = !!(
    (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2) ||
    (navigator.deviceMemory !== undefined && navigator.deviceMemory <= 1) ||
    win.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  /* ── 10. Network Quality ──────────────────────────────────
     Down-grade experience on 2G or slow connections.           */
  win.__slowNetwork = false;
  try {
    var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn) {
      win.__slowNetwork = conn.saveData ||
        conn.effectiveType === '2g' ||
        conn.effectiveType === 'slow-2g';
    }
  } catch {}

  /* ── 11. Touch Latency Fix ────────────────────────────────
     Adding touch-action:manipulation via JS on common buttons
     halves tap delay on older iOS without modifying CSS.       */
  function fixTouchLatency() {
    var sel = 'button, [role="button"], a, .quiz-option, .tab, .bottom-nav-item, .app-bnav-item, .app-nav-item';
    doc.querySelectorAll(sel).forEach(function (el) {
      if (!el.style.touchAction) el.style.touchAction = 'manipulation';
    });
  }
  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', fixTouchLatency);
  } else {
    setTimeout(fixTouchLatency, 0);
  }

  /* ── 12. Performance Marks ───────────────────────────────
     Non-blocking breadcrumbs for Lighthouse / DevTools.        */
  if (win.performance && win.performance.mark) {
    win.performance.mark('studyai:init');
    doc.addEventListener('DOMContentLoaded', function () {
      win.performance.mark('studyai:dom-ready');
    });
  }

  /* ── 13. Asset Error Detection ────────────────────────────
     Catches failed script/style loads (network errors).        */
  win.addEventListener('error', function (e) {
    var el = e.target;
    if (el && (el.tagName === 'SCRIPT' || el.tagName === 'LINK' || el.tagName === 'IMG')) {
      if (win.__studyDebug) {
        console.warn('[StudyAI] Asset failed to load:', el.src || el.href);
      }
    }
  }, true /* capture phase */);

  /* ── 14. Viewport-Jump Prevention ────────────────────────
     Locks scroll position when modal opens / closes.           */
  var _scrollY = 0;
  win.lockBodyScroll = function () {
    _scrollY = win.scrollY || win.pageYOffset;
    doc.body.style.top = '-' + _scrollY + 'px';
    doc.body.style.position = 'fixed';
    doc.body.style.width = '100%';
  };
  win.unlockBodyScroll = function () {
    doc.body.style.position = '';
    doc.body.style.top = '';
    doc.body.style.width = '';
    win.scrollTo(0, _scrollY);
  };

  /* ── 15. Instant Nav Feedback ────────────────────────────
     Adds a micro CSS class to links 50ms before navigation
     for perceived instant response.                            */
  doc.addEventListener('mousedown', function (e) {
    var a = e.target.closest('a[href]:not([data-nav])');
    if (a && a.href && !a.href.startsWith('#') &&
        a.origin === win.location.origin) {
      a.classList.add('nav-activating');
    }
  });

}(window, document));
