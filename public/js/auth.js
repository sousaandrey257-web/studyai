// ============================================================
//  StudyAI — Auth & Historique
// ============================================================

(function () {
  const TOKEN_KEY = 'studyai_auth_token';
  const USER_KEY  = 'studyai_user';

  // ---- État global ----
  window.auth = {
    token: localStorage.getItem(TOKEN_KEY) || null,
    user:  JSON.parse(localStorage.getItem(USER_KEY) || 'null'),
    isLoggedIn() { return !!this.token; },
    headers()    { return this.token ? { 'x-auth-token': this.token } : {}; },
  };

  // ---- Mise à jour UI header ----
  function updateUI() {
    const btnLogin  = document.getElementById('btn-login');
    const userZone  = document.getElementById('user-zone');
    const emailLbl  = document.getElementById('user-email-label');
    if (!btnLogin || !userZone) return;

    if (auth.isLoggedIn()) {
      btnLogin.classList.add('hidden');
      userZone.classList.remove('hidden');
      if (emailLbl) emailLbl.textContent = auth.user?.email || '';
    } else {
      btnLogin.classList.remove('hidden');
      userZone.classList.add('hidden');
    }
  }

  // ---- Modal Auth ----
  window.showAuthModal = function () {
    document.getElementById('modal-auth')?.classList.remove('hidden');
    clearAuthError();
  };
  window.hideAuthModal = function () {
    document.getElementById('modal-auth')?.classList.add('hidden');
  };
  window.closeAuthModal = function (e) {
    if (e.target === document.getElementById('modal-auth')) hideAuthModal();
  };
  window.switchAuthTab = function (tab) {
    document.querySelectorAll('.auth-tab').forEach(function (b) {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    document.getElementById('form-login')   ?.classList.toggle('hidden', tab !== 'login');
    document.getElementById('form-register')?.classList.toggle('hidden', tab !== 'register');
    clearAuthError();
  };

  function clearAuthError() {
    const el = document.getElementById('auth-error');
    if (el) { el.textContent = ''; el.classList.add('hidden'); }
  }
  function showAuthError(msg) {
    const el = document.getElementById('auth-error');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  // ── Client hints — device fingerprint + PoW + browser signals ───────────────
  function _clientHints() {
    try {
      const base = {
        'x-client-tz':     Intl.DateTimeFormat().resolvedOptions().timeZone || '',
        'x-client-screen': window.screen ? window.screen.width + 'x' + window.screen.height : '',
      };
      // PoW solution (pre-solved by pow.js in background)
      if (window.getPowHeader) Object.assign(base, window.getPowHeader());
      // Browser fingerprint signals (collected by fingerprint.js)
      if (window._fpSignals) Object.assign(base, window._fpSignals);
      // Mouse entropy (collected after first interaction)
      if (window._getMouseEntropy) {
        const entropy = window._getMouseEntropy();
        if (entropy) base['x-mouse-entropy'] = entropy;
      }
      return base;
    } catch { return {}; }
  }

  // ---- Connexion ----
  window.doLogin = async function () {
    const email    = document.getElementById('login-email')?.value.trim();
    const password = document.getElementById('login-password')?.value;
    if (!email || !password) return showAuthError('Remplis tous les champs.');
    try {
      const res  = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ..._clientHints() },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) return showAuthError(data.error || 'Erreur de connexion.');
      persistAuth(data.token, data.user);
      hideAuthModal();
      if (window.showToast) showToast('✓ Connexion réussie !', 'success');
    } catch { showAuthError('Impossible de contacter le serveur.'); }
  };

  // ---- Inscription ----
  window.doRegister = async function () {
    const email    = document.getElementById('register-email')?.value.trim();
    const password = document.getElementById('register-password')?.value;
    if (!email || !password) return showAuthError('Remplis tous les champs.');
    if (password.length < 6) return showAuthError('Mot de passe trop court (6 caractères minimum).');
    try {
      const res  = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ..._clientHints() },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) return showAuthError(data.error || 'Erreur lors de la création du compte.');
      persistAuth(data.token, data.user);
      hideAuthModal();
      if (window.showToast) showToast('🎉 Compte créé — bienvenue !', 'success');
      // Claim referral si un code était en attente
      try {
        const refCode = sessionStorage.getItem('studyai_ref');
        if (refCode && data.token) {
          fetch('/api/referral/claim', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-auth-token': data.token },
            body: JSON.stringify({ code: refCode }),
          }).then(function (r) { return r.json(); }).then(function (rd) {
            if (rd.ok && window.showToast) showToast('🎁 +' + rd.xpBonus + ' XP bonus — code de parrainage appliqué !', 'success');
            sessionStorage.removeItem('studyai_ref');
          }).catch(function () {});
        }
      } catch {}
    } catch { showAuthError('Impossible de contacter le serveur.'); }
  };

  // ---- Déconnexion ----
  window.doLogout = function () {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    auth.token = null;
    auth.user  = null;
    updateUI();
    if (window.showToast) showToast('Tu es déconnecté.', 'success');
  };

  function persistAuth(token, user) {
    auth.token = token;
    auth.user  = user;
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    updateUI();
  }

  // ---- Modal Historique ----
  window.showHistoryModal = async function () {
    document.getElementById('modal-history')?.classList.remove('hidden');
    await renderHistory();
  };
  window.hideHistoryModal = function () {
    document.getElementById('modal-history')?.classList.add('hidden');
  };
  window.closeHistoryModal = function (e) {
    if (e.target === document.getElementById('modal-history')) hideHistoryModal();
  };

  async function renderHistory() {
    const list  = document.getElementById('history-list');
    const empty = document.getElementById('history-empty');
    if (!list) return;
    list.innerHTML = '<p class="history-placeholder">Chargement…</p>';
    if (empty) empty.classList.add('hidden');

    // Stats + historique en parallèle
    const [histRes, statsRes] = await Promise.allSettled([
      fetch('/api/history', { headers: auth.headers() }),
      fetch('/api/stats',   { headers: auth.headers() }),
    ]);

    try {
      list.innerHTML = '';

      // Bloc stats
      if (statsRes.status === 'fulfilled') {
        const stats = await statsRes.value.json();
        if (stats && stats.completedQuizzes > 0) {
          const statsEl = document.createElement('div');
          statsEl.className = 'history-stats';
          statsEl.innerHTML =
            `<div class="history-stat">` +
              `<span class="history-stat-value">${stats.totalSessions}</span>` +
              `<span class="history-stat-label">Sessions</span>` +
            `</div>` +
            `<div class="history-stat">` +
              `<span class="history-stat-value">${stats.completedQuizzes}</span>` +
              `<span class="history-stat-label">Quiz faits</span>` +
            `</div>` +
            `<div class="history-stat">` +
              `<span class="history-stat-value">${stats.averageScore ?? '—'}%</span>` +
              `<span class="history-stat-label">Moyenne</span>` +
            `</div>`;
          list.appendChild(statsEl);

          if (stats.weakAreas && stats.weakAreas.length > 0) {
            const weakEl = document.createElement('div');
            weakEl.className = 'history-weak-areas';
            weakEl.innerHTML = `<strong>⚠ Points à revoir</strong>${esc(stats.weakAreas.slice(0, 3).join(' · '))}`;
            list.appendChild(weakEl);
          }
        }
      }

      if (histRes.status !== 'fulfilled') throw new Error('Erreur réseau');
      const data  = await histRes.value.json();
      const items = data.history || [];
      if (items.length === 0) {
        if (empty) empty.classList.remove('hidden');
        return;
      }
      items.forEach(function (item) { list.appendChild(buildCard(item)); });
    } catch {
      list.innerHTML = '<p class="history-placeholder">Erreur de chargement.</p>';
    }
  }

  function buildCard(item) {
    const d         = new Date(item.createdAt);
    const dateStr   = d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
    const modeLabel = { quiz: '🎯 Quiz', summary: '📝 Résumé', full: '📚 Complet' }[item.mode] || '📚';
    const scoreHtml = item.quizResult
      ? `<span class="history-score">${item.quizResult.score}/${item.quizResult.total}</span>`
      : '';

    const card = document.createElement('div');
    card.className = 'history-card';
    card.innerHTML =
      `<div class="history-card-top">` +
        `<span class="history-date">${dateStr}</span>` +
        `<span class="history-mode">${modeLabel}</span>` +
        scoreHtml +
      `</div>` +
      `<p class="history-topic">${esc(item.topic)}</p>` +
      `<button class="btn-secondary history-load-btn">Revoir →</button>`;

    card.querySelector('.history-load-btn').addEventListener('click', function () {
      hideHistoryModal();
      if (window.loadFromHistory) window.loadFromHistory(item);
    });
    return card;
  }

  function esc(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ---- Init ----
  document.addEventListener('DOMContentLoaded', function () {
    updateUI();

    // Touche Entrée dans les formulaires
    document.getElementById('login-password')?.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); doLogin(); }
    });
    document.getElementById('register-password')?.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); doRegister(); }
    });

    // ?login=1 → ouvre la modale de connexion automatiquement (ex: redirection depuis /dashboard)
    const params = new URLSearchParams(window.location.search);
    if (params.get('login') === '1' && !auth.isLoggedIn()) {
      window.history.replaceState({}, '', '/');
      setTimeout(function () { window.showAuthModal && window.showAuthModal(); }, 200);
    }
    if (params.get('login') === '1' && auth.isLoggedIn()) {
      window.history.replaceState({}, '', '/');
    }

    // ── Buttons wired via addEventListener (CSP blocks inline onclick) ──
    var _q = function (id) { return document.getElementById(id); };

    // Nav header
    var btnLogin = _q('btn-login');
    if (btnLogin) btnLogin.addEventListener('click', function () { showAuthModal(); });
    var btnHistory = _q('btn-history');
    if (btnHistory) btnHistory.addEventListener('click', function () { showHistoryModal(); });
    var btnLogout = _q('btn-logout');
    if (btnLogout) btnLogout.addEventListener('click', function () { doLogout(); });

    // Auth modal — overlay, close, tabs, submit buttons
    var modalAuth = _q('modal-auth');
    if (modalAuth) {
      modalAuth.addEventListener('click', function (e) {
        if (e.target === modalAuth) hideAuthModal();
      });
    }
    var authClose = _q('auth-modal-close');
    if (authClose) authClose.addEventListener('click', function () { hideAuthModal(); });

    document.querySelectorAll('.auth-tab').forEach(function (tab) {
      tab.addEventListener('click', function () { switchAuthTab(tab.dataset.tab); });
    });

    var btnDoLogin = _q('btn-do-login');
    if (btnDoLogin) btnDoLogin.addEventListener('click', function () { doLogin(); });
    var btnDoRegister = _q('btn-do-register');
    if (btnDoRegister) btnDoRegister.addEventListener('click', function () { doRegister(); });

    // History modal — overlay, close
    var modalHistory = _q('modal-history');
    if (modalHistory) {
      modalHistory.addEventListener('click', function (e) {
        if (e.target === modalHistory) hideHistoryModal();
      });
    }
    var historyClose = _q('history-modal-close');
    if (historyClose) historyClose.addEventListener('click', function () { hideHistoryModal(); });

    // Escape key closes whichever modal is open
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (modalAuth && !modalAuth.classList.contains('hidden')) hideAuthModal();
      if (modalHistory && !modalHistory.classList.contains('hidden')) hideHistoryModal();
    });
  });
})();
