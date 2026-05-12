'use strict';
/* =====================================================
   StudyAI Workspace Shell — workspace.js v3
   Premium transitions · Swipe gestures · Micro-animations
   ===================================================== */

const Workspace = (() => {

  /* ── Config ─────────────────────────────────────── */
  const PANELS = [
    { id: 'home',   icon: '⚡', label: 'Accueil'       },
    { id: 'study',  icon: '📄', label: 'Auto Study'    },
    { id: 'brain',  icon: '🧠', label: 'Second Brain'  },
    { id: 'battle', icon: '⚔️', label: 'Study Duel'  },
  ];
  const PANEL_IDS = PANELS.map(p => p.id);

  /* ── State ──────────────────────────────────────── */
  let current    = 'home';
  let user       = null;
  let packs      = [];
  const inited   = new Set();   // panels already initialized
  let exitTimer  = null;        // cleanup timer for panel--exit class

  /* ── DOM helpers ────────────────────────────────── */
  const $  = s => document.querySelector(s);
  const $$ = s => document.querySelectorAll(s);
  const el = id => document.getElementById(id);
  const setTxt = (sel, v) => { const e = $(sel); if (e) e.textContent = v; };

  /* ── Safe storage ───────────────────────────────── */
  const _ss = window.safeStore || {
    get: (k, fb = null) => { try { const v = localStorage.getItem(k); return v === null ? fb : JSON.parse(v); } catch { return fb; } },
    set: (k, v)         => { try { localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); } catch {} },
  };

  /* ── Panel router ───────────────────────────────── */
  function navigate(panelId, opts = {}) {
    if (!PANEL_IDS.includes(panelId)) return;
    if (panelId === current && inited.has(panelId)) return;

    const prevId  = current;
    const prevEl  = el(`panel-${prevId}`);
    const nextEl  = el(`panel-${panelId}`);
    if (!nextEl) return;

    current = panelId;

    /* Determine direction for subtle enter animation */
    const prevIdx = PANEL_IDS.indexOf(prevId);
    const nextIdx = PANEL_IDS.indexOf(panelId);
    const forward = nextIdx >= prevIdx;

    /* Animate old panel out — clear any lingering transition states first */
    if (prevEl && prevId !== panelId) {
      prevEl.classList.remove('panel--active');
      prevEl.classList.add('panel--exit');
      clearTimeout(exitTimer);
      exitTimer = setTimeout(() => {
        prevEl.classList.remove('panel--exit');
      }, 220);
    }

    /* Reset any lingering pointer-events or transform from previous state */
    nextEl.style.setProperty('--enter-x', forward ? '14px' : '-14px');
    nextEl.style.removeProperty('transform');
    nextEl.style.removeProperty('pointer-events');

    nextEl.classList.add('panel--active');

    /* Sync ALL nav items (both sidebar and bottom nav) */
    $$('[data-nav]').forEach(e => e.classList.toggle('active', e.dataset.nav === panelId));

    /* Breadcrumb */
    const meta = PANELS.find(p => p.id === panelId) || PANELS[0];
    setTxt('#breadcrumb-icon', meta.icon);
    setTxt('#breadcrumb-section', meta.label);

    /* URL hash */
    if (!opts.silent) {
      try { history.pushState({ panel: panelId }, '', `#${panelId}`); } catch {}
    }

    /* Lazy init */
    try { lazyInit(panelId); } catch (err) { console.warn('[Workspace] lazyInit error:', err); }

    /* Mobile: close sidebar */
    closeSidebar();
  }

  /* ── Lazy initialization per panel ─────────────── */
  function lazyInit(panelId) {
    if (inited.has(panelId)) {
      /* Brain canvas needs resize when re-shown (dimensions may have changed) */
      if (panelId === 'brain') triggerBrainResize();
      return;
    }
    inited.add(panelId);

    switch (panelId) {
      case 'home':   initHome();   break;
      case 'brain':  initBrain();  break;
      case 'battle': initBattle(); break;
    }
  }

  /* ── Home panel ─────────────────────────────────── */
  function initHome() {
    renderDate();
    loadPacks();
    loadStats();
    syncStreak();
    animateHomeEntrance();
  }

  function renderDate() {
    setTxt('#home-date-str', new Date().toLocaleDateString('fr-FR', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    }));
  }

  function loadPacks() {
    packs = _ss.get('ws_packs', []);
    if (!Array.isArray(packs)) packs = [];

    /* Show skeletons while "loading" */
    const container = el('home-packs');
    if (!container) return;

    if (!packs.length) {
      container.innerHTML = `<div class="home-empty-state">
        <p>Aucun cours analysé encore — commence maintenant&nbsp;!</p>
        <button class="btn-primary" onclick="Workspace.navigate('study')">📄 Analyser mon premier cours</button>
      </div>`;
      return;
    }

    container.innerHTML = '';
    packs.slice(0, 5).forEach((pack, i) => {
      const item = document.createElement('div');
      item.className = 'home-pack-item stagger-enter';
      item.style.animationDelay = `${i * 55}ms`;
      item.innerHTML = `
        <div class="home-pack-icon">${subjectIcon(pack.subject)}</div>
        <div class="home-pack-info">
          <div class="home-pack-title">${esc(pack.title || 'Sans titre')}</div>
          <div class="home-pack-meta">${esc(pack.subject || '')} · ${fmtDate(pack.date)} · ${pack.cards || 0} flashcards</div>
        </div>
        <button class="home-pack-open">Ouvrir →</button>`;
      item.querySelector('.home-pack-open').addEventListener('click', e => {
        e.stopPropagation();
        navigate('study');
        setTimeout(() => window._uploadAPI?.restoreJob?.(pack.jobId), 120);
      });
      item.addEventListener('click', () => {
        navigate('study');
        setTimeout(() => window._uploadAPI?.restoreJob?.(pack.jobId), 120);
      });
      container.appendChild(item);
    });
  }

  async function loadStats() {
    const packsCount   = packs.length;
    const totalCards   = packs.reduce((s, p) => s + (p.cards || 0), 0);
    const totalConcepts = packs.reduce((s, p) => s + (p.concepts || 0), 0);

    /* Count-up animation */
    countUp('#hs-packs', packsCount, 600);
    countUp('#hs-cards', totalCards, 700);
    countUp('#hs-concepts', totalConcepts, 800);

    /* Brain stats (async — best-effort, skip on slow connections) */
    try {
      if (window.__slowNetwork) return;
      const token = _ss.get('studyai_auth_token', null) || _ss.get('token', null);
      if (!token) return;
      const r = await fetch('/api/ai/brain?limit=1', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) {
        const d = await r.json();
        const n = (d.nodes || []).length;
        setTxt('#hq-brain-stat', `${n} concept${n !== 1 ? 's' : ''} liés`);
      }
    } catch {}
  }

  function syncStreak() {
    const streak = parseInt(_ss.get('ws_streak', 0), 10) || 0;
    $$('.ws-streak-num').forEach(e => { e.textContent = streak; });
    setTxt('#hs-streak', '🔥 ' + streak);
  }

  function animateHomeEntrance() {
    if (window.__slowDevice) return;
    /* Stagger stat cards */
    $$('.home-stat').forEach((el, i) => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(10px)';
      requestAnimationFrame(() => {
        setTimeout(() => {
          el.style.transition = `opacity .3s ease ${i * 60}ms, transform .3s var(--ease-spring) ${i * 60}ms`;
          el.style.opacity = '1';
          el.style.transform = '';
        }, 40);
      });
    });

    /* Stagger quick-action cards */
    $$('.home-qa').forEach((el, i) => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(8px)';
      requestAnimationFrame(() => {
        setTimeout(() => {
          el.style.transition = `opacity .28s ease ${80 + i * 50}ms, transform .28s var(--ease-spring) ${80 + i * 50}ms`;
          el.style.opacity = '1';
          el.style.transform = '';
        }, 40);
      });
    });
  }

  /* ── Brain panel ─────────────────────────────────── */
  function initBrain() {
    triggerBrainResize();
    setTimeout(() => {
      if (window._brainAPI) window._brainAPI.loadGraph();
    }, 60);
  }

  function triggerBrainResize() {
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }

  /* ── Battle panel ────────────────────────────────── */
  function initBattle() {
    if (window._battleAPI) window._battleAPI.init();
    // Note: [data-nav] buttons are already wired globally in init() — no re-binding needed
  }

  /* ── User ────────────────────────────────────────── */
  async function loadUser() {
    try {
      const token = _ss.get('studyai_auth_token', null) || _ss.get('token', null);
      if (!token) return;
      const r = await fetch('/api/me', { headers: { 'x-auth-token': token } });
      if (!r.ok) return;
      user = (await r.json()).user;
      renderUser();
    } catch {}
  }

  function renderUser() {
    if (!user) return;
    const initial = (user.username || user.email || '?')[0].toUpperCase();
    const name    = user.username || user.email?.split('@')[0] || 'Utilisateur';

    const card = el('sidebar-user-card');
    if (card) {
      card.querySelector('.sidebar-user-avatar').textContent = initial;
      card.querySelector('.sidebar-user-name').textContent   = name;
      card.querySelector('.sidebar-user-plan').textContent   = user.premium ? '✨ Premium' : 'Gratuit';
    }
    const av = el('topbar-avatar');
    if (av) av.textContent = initial;

    const uname = el('home-uname');
    if (uname) {
      uname.textContent = '';
      typeText(uname, ' ' + name.split(' ')[0], 45);
    }
  }

  /* ── Pack persistence ────────────────────────────── */
  function savePack(pack) {
    let stored = _ss.get('ws_packs', []);
    if (!Array.isArray(stored)) stored = [];
    stored = stored.filter(p => p.jobId !== pack.jobId);
    stored.unshift({ ...pack, date: new Date().toISOString() });
    stored = stored.slice(0, 20);
    _ss.set('ws_packs', stored);
    packs = stored;
  }

  function bumpStreak() {
    const today     = new Date().toDateString();
    const last      = _ss.get('ws_streak_date', null);
    if (last === today) return;
    const cur       = parseInt(_ss.get('ws_streak', 0), 10) || 0;
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    const next      = last === yesterday ? cur + 1 : 1;
    _ss.set('ws_streak', String(next));
    _ss.set('ws_streak_date', today);
    $$('.ws-streak-num').forEach(e => { e.textContent = next; });
    setTxt('#hs-streak', '🔥 ' + next);
    if (!window.__slowDevice) {
      $$('.home-streak-badge .streak-num').forEach(e => {
        e.classList.remove('bump');
        void e.offsetWidth; // intentional reflow to restart CSS animation
        e.classList.add('bump');
      });
    }
  }

  /* ── Sidebar (mobile) ────────────────────────────── */
  function openSidebar() {
    $('.app-sidebar')?.classList.add('open');
    $('.app-overlay')?.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeSidebar() {
    $('.app-sidebar')?.classList.remove('open');
    $('.app-overlay')?.classList.remove('open');
    document.body.style.overflow = '';
  }

  /* ── Toast ───────────────────────────────────────── */
  function toast(msg, type = 'info', ms = 3500) {
    const wrap = $('.app-toast-wrap');
    if (!wrap) return;
    const icons = { success: '✓', error: '✗', info: '💡', warning: '⚠️' };
    const div = document.createElement('div');
    div.className = `app-toast ${type}`;
    div.innerHTML = `
      <span class="toast-icon">${icons[type] || '•'}</span>
      <span class="toast-msg">${esc(String(msg))}</span>
      <button class="toast-close" aria-label="Fermer">✕</button>`;
    div.querySelector('.toast-close').onclick = () => dismissToast(div);
    wrap.appendChild(div);
    setTimeout(() => dismissToast(div), ms);
  }
  function dismissToast(div) {
    div.classList.add('toast-out');
    setTimeout(() => div.remove(), 280);
  }

  /* ── Swipe gesture (mobile panels) ──────────────── */
  function initSwipe() {
    const container = $('.app-panels');
    if (!container) return;

    let startX = 0, startY = 0, startT = 0;
    let tracking = false;

    container.addEventListener('touchstart', e => {
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      startT = Date.now();
      tracking = true;
    }, { passive: true });

    container.addEventListener('touchmove', e => {
      if (!tracking || e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      /* Only handle horizontal swipes (ratio > 1.5:1) */
      if (Math.abs(dy) > Math.abs(dx) * 1.5) { tracking = false; }
    }, { passive: true });

    container.addEventListener('touchend', e => {
      if (!tracking) return;
      tracking = false;
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      const dt = Date.now() - startT;

      /* Swipe threshold: 60px in < 350ms, horizontal-dominant */
      if (Math.abs(dx) < 60 || dt > 350) return;
      if (Math.abs(dy) > Math.abs(dx) * 0.8) return;

      const idx = PANEL_IDS.indexOf(current);
      if (dx < 0 && idx < PANEL_IDS.length - 1) navigate(PANEL_IDS[idx + 1]);
      else if (dx > 0 && idx > 0)              navigate(PANEL_IDS[idx - 1]);
    }, { passive: true });
  }

  /* ── Animation helpers ───────────────────────────── */
  function countUp(sel, target, duration = 700) {
    const e = $(sel);
    if (!e || !target) return;
    const prefix = e.textContent.match(/^[^\d]*/)?.[0] || '';
    if (window.__slowDevice) { e.textContent = prefix + target; return; }
    let start = null;
    const step = ts => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / duration, 1);
      /* ease-out quad */
      const eased = 1 - (1 - p) * (1 - p);
      e.textContent = prefix + Math.round(eased * target);
      if (p < 1) requestAnimationFrame(step);
      else e.textContent = prefix + target;
    };
    requestAnimationFrame(step);
  }

  let _typeCancel = null;
  function typeText(el, text, speed = 40) {
    if (_typeCancel) { _typeCancel(); _typeCancel = null; }
    let i = 0;
    let cancelled = false;
    _typeCancel = () => { cancelled = true; };
    const tick = () => {
      if (cancelled) return;
      el.textContent += text[i++];
      if (i < text.length) setTimeout(tick, speed);
      else _typeCancel = null;
    };
    tick();
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function subjectIcon(s = '') {
    const map = { math:'📐', physique:'⚗️', chimie:'🧪', histoire:'📜',
                  bio:'🧬', info:'💻', langue:'🗣️', eco:'📈', geo:'🌍' };
    const k = s.toLowerCase();
    return Object.entries(map).find(([m]) => k.includes(m))?.[1] || '📄';
  }
  function fmtDate(iso) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }); }
    catch { return ''; }
  }

  /* ── Boot ─────────────────────────────────────────── */
  function init() {
    /* Event delegation for [data-nav] — catches statically-rendered AND
       dynamically-injected nav buttons (e.g. home empty-state CTA). */
    document.addEventListener('click', e => {
      const btn = e.target.closest('[data-nav]');
      if (!btn) return;
      const t = btn.dataset.nav;
      if (PANEL_IDS.includes(t)) {
        e.preventDefault();
        navigate(t);
      }
    });

    /* Topbar controls */
    el('btn-sidebar-toggle')?.addEventListener('click', openSidebar);
    $('.app-overlay')?.addEventListener('click', closeSidebar);
    el('btn-topbar-study')?.addEventListener('click', () => navigate('study'));

    /* Hash routing — back/forward browser support */
    window.addEventListener('popstate', e => {
      const panel = (e.state && e.state.panel) || location.hash.replace('#', '');
      navigate(PANEL_IDS.includes(panel) ? panel : 'home', { silent: true });
    });
    const initHash = location.hash.replace('#', '');
    navigate(PANEL_IDS.includes(initHash) ? initHash : 'home', { silent: true });

    /* Swipe gesture (mobile) */
    initSwipe();

    /* Listen for study pack ready event (dispatched by upload.js) */
    document.addEventListener('studypack:ready', e => {
      const { jobId, title, subject, cards, concepts } = e.detail || {};
      savePack({ jobId, title, subject, cards: cards || 0, concepts: concepts || 0 });
      bumpStreak();
      toast(`Pack prêt : ${title || 'Sans titre'} — ${cards || 0} flashcards`, 'success');
      if (current === 'home') { loadPacks(); loadStats(); }
    });

    /* Load user */
    loadUser();

    /* Register teardown for timers */
    window.registerCleanup && window.registerCleanup(() => {
      clearTimeout(exitTimer);
      if (_typeCancel) _typeCancel();
    });

    /* Expose globals — includes navigate so inline onclicks in dynamic HTML work */
    window.Workspace = { navigate, toast, savePack, bumpStreak };
  }

  return { init, navigate, toast, savePack, bumpStreak };
})();

document.addEventListener('DOMContentLoaded', Workspace.init);
