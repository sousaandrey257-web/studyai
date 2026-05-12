// ============================================================
//  StudyAI — UI Enhancements  v1
//  Purely additive. No API calls, no auth, no breaking changes.
//  Loaded AFTER app.js / dashboard.js.
// ============================================================
(function () {
  'use strict';

  var prefersReducedMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ============================================================
  //  SCROLL REVEAL — IntersectionObserver
  // ============================================================
  function initScrollReveal() {
    var els = document.querySelectorAll('.reveal');
    if (!els.length) return;

    if (prefersReducedMotion || window.__slowDevice || !window.IntersectionObserver) {
      els.forEach(function (el) { el.classList.add('visible'); });
      return;
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -32px 0px' });

    els.forEach(function (el) { io.observe(el); });
  }

  // ============================================================
  //  RIPPLE CLICK EFFECTS
  // ============================================================
  function initRipples() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest(
        '.btn-primary:not(:disabled), .btn-secondary:not(:disabled), .btn-checkout:not(:disabled)'
      );
      if (!btn) return;

      var rect   = btn.getBoundingClientRect();
      var size   = Math.max(rect.width, rect.height) * 2;
      var ripple = document.createElement('span');
      ripple.className  = 'ripple';
      ripple.style.width  = ripple.style.height = size + 'px';
      ripple.style.left   = (e.clientX - rect.left - size / 2) + 'px';
      ripple.style.top    = (e.clientY - rect.top  - size / 2) + 'px';
      btn.appendChild(ripple);
      ripple.addEventListener('animationend', function () { ripple.remove(); });
    });
  }

  // ============================================================
  //  FAQ ACCORDION
  // ============================================================
  function initFAQ() {
    var items = document.querySelectorAll('.faq-item');
    if (!items.length) return;

    items.forEach(function (item) {
      var btn = item.querySelector('.faq-question');
      if (!btn) return;

      btn.addEventListener('click', function () {
        var wasOpen = item.classList.contains('open');
        // Close all
        items.forEach(function (i) { i.classList.remove('open'); });
        // Toggle current
        if (!wasOpen) item.classList.add('open');
      });
    });
  }

  // ============================================================
  //  BOTTOM NAV ACTIVE STATE
  // ============================================================
  function initBottomNav() {
    var path  = window.location.pathname.replace(/\/$/, '') || '/';
    var items = document.querySelectorAll('.bottom-nav-item[data-page]');
    items.forEach(function (item) {
      var page = item.dataset.page.replace(/\/$/, '') || '/';
      if (page === path || (page === '/' && path === '')) {
        item.classList.add('active');
      }
    });
  }

  // ============================================================
  //  TOUCH FEEDBACK — quiz options scale on touch
  // ============================================================
  function initTouchFeedback() {
    if (!('ontouchstart' in window)) return;

    document.addEventListener('touchstart', function (e) {
      var opt = e.target.closest('.quiz-option:not(:disabled)');
      if (opt) opt.style.transition = 'transform 0.08s';
    }, { passive: true });

    document.addEventListener('touchend', function (e) {
      var opt = e.target.closest('.quiz-option');
      if (opt) {
        opt.style.transition = '';
      }
    }, { passive: true });
  }

  // ============================================================
  //  COUNTER ANIMATION — counts up numbers in stat elements
  // ============================================================
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

  function countUp(el, from, to, duration) {
    if (prefersReducedMotion || to === 0) { el.textContent = to; return; }
    var startTime = null;

    function step(ts) {
      if (!startTime) startTime = ts;
      var pct = Math.min((ts - startTime) / duration, 1);
      el.textContent = Math.floor(from + (to - from) * easeOut(pct));
      if (pct < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function initCounters() {
    var io = window.IntersectionObserver
      ? new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            io.unobserve(entry.target);
            var el  = entry.target;
            var raw = parseFloat(el.textContent);
            if (!isNaN(raw) && raw > 0 && raw < 100000) {
              countUp(el, 0, raw, 800);
            }
          });
        }, { threshold: 0.5 })
      : null;

    document.querySelectorAll('.dash-stat-value').forEach(function (el) {
      var raw = parseFloat(el.textContent);
      if (!isNaN(raw) && raw > 0) {
        if (io) io.observe(el);
        else countUp(el, 0, raw, 800);
      }
    });
  }

  // ============================================================
  //  STAT STRIP — animated counters on scroll
  // ============================================================
  function initStatStrip() {
    var items = document.querySelectorAll('.stat-item .stat-value');
    if (!items.length || !window.IntersectionObserver) return;

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        io.unobserve(entry.target);
        // Strip values are not purely numeric so we just do a pop
        if (!prefersReducedMotion && !window.__slowDevice) {
          entry.target.style.animation = 'none';
          entry.target.offsetHeight; // intentional reflow to reset animation
          entry.target.style.animation = 'fadeUp 0.4s ease both';
        }
      });
    }, { threshold: 0.5 });

    items.forEach(function (el) { io.observe(el); });
  }

  // ============================================================
  //  CONFETTI — launched on level-up or achievement unlock
  // ============================================================
  function launchConfetti(originEl) {
    if (prefersReducedMotion) return;
    var colors = ['#7c3aed', '#a78bfa', '#06b6d4', '#10b981', '#fbbf24', '#f59e0b'];
    var rect   = originEl
      ? originEl.getBoundingClientRect()
      : { left: window.innerWidth / 2 - 20, top: window.innerHeight / 2, width: 40, height: 0 };

    var originX = rect.left + rect.width / 2;
    var originY = rect.top + rect.height / 2 + window.scrollY;

    for (var i = 0; i < 36; i++) {
      (function (i) {
        setTimeout(function () {
          var p = document.createElement('div');
          p.className = 'confetti-particle';
          var size = 4 + Math.random() * 6;
          var dx   = (Math.random() - 0.5) * 260;
          var dy   = -(80 + Math.random() * 160);
          var rot  = Math.random() * 720 - 360;
          var dur  = 0.7 + Math.random() * 0.7;

          p.style.cssText = [
            'width:' + size + 'px',
            'height:' + (Math.random() > 0.5 ? size : size * 0.4) + 'px',
            'background:' + colors[Math.floor(Math.random() * colors.length)],
            'border-radius:' + (Math.random() > 0.5 ? '50%' : '2px'),
            'left:' + (originX + (Math.random() * 40 - 20)) + 'px',
            'top:' + originY + 'px',
            '--dx:' + dx + 'px',
            '--dy:' + dy + 'px',
            '--rot:' + rot + 'deg',
            '--dur:' + dur + 's',
          ].join(';');

          document.body.appendChild(p);
          setTimeout(function () { p.remove(); }, (dur + 0.1) * 1000);
        }, i * 28);
      })(i);
    }
  }

  // Expose for app.js level-up hook
  window._ui_launchConfetti = launchConfetti;

  // ============================================================
  //  ENHANCED LEVEL-UP — hook into existing gamification
  // ============================================================
  function patchLevelUp() {
    // Watch for level-up overlay and attach confetti
    var mo = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        m.addedNodes.forEach(function (node) {
          if (node.nodeType === 1 && node.classList && node.classList.contains('level-up-overlay')) {
            var num = node.querySelector('.level-up-num');
            if (num) launchConfetti(num);
          }
        });
      });
    });
    mo.observe(document.body, { childList: true });
  }

  // ============================================================
  //  SMOOTH SCROLL — anchor links
  // ============================================================
  function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        var id = this.getAttribute('href').slice(1);
        var target = document.getElementById(id);
        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });
  }

  // ============================================================
  //  KEYBOARD NAVIGATION — quiz options with arrow keys
  // ============================================================
  function initKeyboardQuiz() {
    document.addEventListener('keydown', function (e) {
      if (!['1','2','3','4','ArrowDown','ArrowUp'].includes(e.key)) return;
      var opts = Array.from(document.querySelectorAll('.quiz-option:not(:disabled)'));
      if (!opts.length) return;

      if (e.key >= '1' && e.key <= '4') {
        var idx = parseInt(e.key) - 1;
        if (opts[idx]) opts[idx].click();
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        var current = document.activeElement;
        var ci = opts.indexOf(current);
        if (ci === -1) { opts[0].focus(); return; }
        var next = e.key === 'ArrowDown' ? opts[ci + 1] : opts[ci - 1];
        if (next) { e.preventDefault(); next.focus(); }
      }
    });
  }

  // ============================================================
  //  HAPTIC FEEDBACK — subtle vibration on mobile (correct answer)
  // ============================================================
  function addHapticToQuiz() {
    if (!navigator.vibrate) return;

    document.addEventListener('click', function (e) {
      var opt = e.target.closest('.quiz-option:not(:disabled)');
      if (!opt) return;
      navigator.vibrate(8);
    });

    // Body-level observer with attributeFilter catches dynamically-injected quiz options
    var mo = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        if (m.type !== 'attributes' || m.attributeName !== 'class') return;
        var el = m.target;
        if (!el.classList || !el.classList.contains('quiz-option')) return;
        if (el.classList.contains('correct'))    navigator.vibrate([10, 30, 60]);
        if (el.classList.contains('incorrect'))  navigator.vibrate([80, 20, 80]);
      });
    });
    mo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
    window.registerCleanup && window.registerCleanup(function () { mo.disconnect(); });
  }

  // ============================================================
  //  COOKIE BANNER — GDPR minimal
  // ============================================================
  function initCookieBanner() {
    var STORAGE_KEY = 'studyai_cookie_ok';
    var _store = window.safeStore || {
      get: function (k, fb) { try { var v = localStorage.getItem(k); return v === null ? fb : v; } catch { return fb; } },
      set: function (k, v) { try { localStorage.setItem(k, v); } catch {} }
    };
    if (_store.get(STORAGE_KEY, null)) return;

    var banner = document.createElement('div');
    banner.id  = 'cookie-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Cookies');
    banner.innerHTML = [
      '<div class="cookie-inner">',
      '<p class="cookie-text">',
      '🍪 Nous utilisons uniquement des cookies fonctionnels essentiels.',
      ' <a href="/privacy" class="cookie-link">En savoir plus</a>',
      '</p>',
      '<div class="cookie-actions">',
      '<button class="cookie-btn cookie-accept" id="cookie-accept">Accepter</button>',
      '<a href="/privacy" class="cookie-btn cookie-more">Politique</a>',
      '</div>',
      '</div>',
    ].join('');
    document.body.appendChild(banner);

    setTimeout(function () { banner.classList.add('cookie-visible'); }, 800);

    document.getElementById('cookie-accept').addEventListener('click', function () {
      _store.set(STORAGE_KEY, '1');
      banner.classList.remove('cookie-visible');
      setTimeout(function () { banner.remove(); }, 400);
    });
  }

  // ============================================================
  //  INIT
  // ============================================================
  function init() {
    initScrollReveal();
    initRipples();
    initFAQ();
    initBottomNav();
    initTouchFeedback();
    initSmoothScroll();
    initKeyboardQuiz();
    patchLevelUp();
    initCookieBanner();

    // Delayed inits (wait for dashboard data to render)
    setTimeout(initCounters, 600);
    setTimeout(initStatStrip, 200);
    setTimeout(addHapticToQuiz, 400);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
