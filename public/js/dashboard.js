// ============================================================
//  StudyAI — Dashboard
// ============================================================
(function () {
  const TOKEN_KEY = 'studyai_auth_token';
  const USER_KEY  = 'studyai_user';

  const token = localStorage.getItem(TOKEN_KEY);
  const user  = JSON.parse(localStorage.getItem(USER_KEY) || 'null');

  // Redirige vers la page principale si non connecté
  if (!token) {
    window.location.href = '/?login=1';
    return;
  }

  // ============================================================
  //  INIT
  // ============================================================
  document.addEventListener('DOMContentLoaded', function () {
    const emailEl = document.getElementById('dash-email');
    if (emailEl) emailEl.textContent = user?.email || '';

    // Vérification paiement Stripe après redirection success_url
    const params    = new URLSearchParams(window.location.search);
    const sessionId = params.get('session_id');
    if (sessionId) {
      history.replaceState({}, '', '/dashboard'); // nettoie l'URL
      verifyPayment(sessionId);
    }

    loadDashboard();
  });

  // ============================================================
  //  VÉRIFICATION PAIEMENT STRIPE
  // ============================================================
  async function verifyPayment(sessionId) {
    try {
      const res  = await fetch('/api/verify-payment?session_id=' + encodeURIComponent(sessionId));
      const data = await res.json();
      if (data.success && data.token) {
        localStorage.setItem('studyai_premium_token', data.token);
        localStorage.setItem('studyai_premium_plan',  data.plan || 'premium');
        showPaymentBanner(data.plan);
      }
    } catch {
      // Silencieux — le webhook active le premium de toute façon
    }
  }

  function showPaymentBanner(plan) {
    const label   = plan === 'lifetime' ? 'à vie' : plan === 'yearly' ? 'annuel' : 'mensuel';
    const banner  = document.createElement('div');
    banner.className = 'dash-payment-banner';
    banner.innerHTML = '🎉 <strong>Paiement confirmé !</strong> Ton accès Premium ' + label + ' est activé.';
    const container = document.querySelector('.dash-container');
    if (container) container.insertBefore(banner, container.firstChild);
    setTimeout(function () { banner.remove(); }, 8000);
  }

  // ============================================================
  //  CHARGEMENT DES DONNÉES
  // ============================================================
  async function loadDashboard() {
    const headers = { 'x-auth-token': token };

    const [histRes, statsRes, gamiRes, lbRes, missionsRes, refRes] = await Promise.allSettled([
      fetch('/api/history',       { headers }),
      fetch('/api/stats',         { headers }),
      fetch('/api/gamification',  { headers }),
      fetch('/api/leaderboard',   { headers }),
      fetch('/api/daily-missions',{ headers }),
      fetch('/api/referral',      { headers }),
    ]);

    // Gamification header
    if (gamiRes.status === 'fulfilled' && gamiRes.value.ok) {
      try {
        const g = await gamiRes.value.json();
        renderGami(g);
        if (g.streakWarning && g.streak > 0) showStreakWarning(g.streak);
        // Toast positif "comeback" — une seule fois par session, streak ≥ 2
        if (g.streak >= 2 && !sessionStorage.getItem('studyai_comeback_shown')) {
          sessionStorage.setItem('studyai_comeback_shown', '1');
          setTimeout(function () { showStreakComeback(g.streak); }, 1200);
        }
      } catch {}
    }

    // Missions quotidiennes
    if (missionsRes.status === 'fulfilled' && missionsRes.value.ok) {
      try { renderDailyMissions(await missionsRes.value.json()); } catch {}
    }

    // Referral
    if (refRes.status === 'fulfilled' && refRes.value.ok) {
      try { renderReferral(await refRes.value.json()); } catch {}
    }

    // Stats
    if (statsRes.status === 'fulfilled' && statsRes.value.ok) {
      try { renderStats(await statsRes.value.json()); } catch {}
    }

    // Leaderboard
    if (lbRes.status === 'fulfilled' && lbRes.value.ok) {
      try { renderLeaderboard(await lbRes.value.json()); } catch {}
    }

    // Sessions
    if (histRes.status === 'fulfilled' && histRes.value.ok) {
      try {
        const data = await histRes.value.json();
        renderSessions(data.history || []);
      } catch {
        showError('Erreur lors du chargement de l\'historique.');
      }
    } else {
      showError('Impossible de charger les données. Vérifie ta connexion.');
    }
  }

  // ============================================================
  //  GAMIFICATION HEADER
  // ============================================================
  function renderGami(g) {
    const container = document.getElementById('dash-gami');
    if (!container) return;

    const pct = Math.min(g.progress?.pct || 0, 100);

    container.innerHTML =
      '<div class="dash-gami-header">' +
        '<div class="level-badge lg dash-gami-level">' + g.level + '</div>' +
        '<div class="dash-gami-body">' +
          '<div class="dash-gami-name">' +
            'Niveau ' + g.level +
            '<span class="level-tag">' + g.totalQuizzes + ' quiz</span>' +
          '</div>' +
          '<div class="dash-gami-xp-row">' +
            '<span class="dash-gami-xp-text">' + (g.progress?.current || 0) + ' / ' + (g.progress?.needed || 100) + ' XP</span>' +
            '<div class="xp-bar-wrap" style="flex:1"><div class="xp-bar-fill" id="dash-xp-fill" style="width:0%"></div></div>' +
          '</div>' +
        '</div>' +
        '<div class="streak-chip">' +
          '<span class="s-icon">🔥</span>' +
          '<span class="s-num">' + (g.streak || 0) + '</span>' +
          '<span class="s-label">jours</span>' +
          ((g.streakShields || 0) > 0
            ? '<span class="s-shields" title="Streak shields — protègent ton streak 1 jour">🛡️×' + g.streakShields + '</span>'
            : '') +
        '</div>' +
      '</div>';

    // Anime la barre XP après insertion
    setTimeout(function () {
      var fill = document.getElementById('dash-xp-fill');
      if (fill) fill.style.width = pct + '%';
    }, 200);

    // Graphe XP semaine
    if (g.xpByDay) renderWeeklyChart(g.xpByDay, container);

    // Badges
    if (Array.isArray(g.allBadges) && g.allBadges.length > 0) {
      renderBadges(g.allBadges, container);
    }
  }

  function renderWeeklyChart(xpByDay, container) {
    // Construit un tableau des 7 derniers jours
    var days = [];
    var labels = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
    for (var i = 6; i >= 0; i--) {
      var d = new Date(Date.now() - i * 86400000);
      var key = d.toISOString().split('T')[0];
      var dow = (d.getDay() + 6) % 7; // 0=Lun … 6=Dim
      days.push({ key: key, label: labels[dow], xp: xpByDay[key] || 0 });
    }

    var maxXP = Math.max(1, Math.max.apply(null, days.map(function (d) { return d.xp; })));

    var section = document.createElement('div');
    section.className = 'dash-week-section';
    section.innerHTML =
      '<div class="dash-week-title">📈 Ton évolution cette semaine</div>' +
      '<div class="dash-week-chart">' +
        days.map(function (d) {
          var pct = Math.round((d.xp / maxXP) * 100);
          var isToday = (d.key === new Date().toISOString().split('T')[0]);
          return '<div class="dash-week-col' + (isToday ? ' today' : '') + '">' +
            '<div class="dash-week-bar-wrap">' +
              '<div class="dash-week-bar" style="height:' + pct + '%"></div>' +
            '</div>' +
            '<div class="dash-week-xp">' + (d.xp > 0 ? d.xp : '') + '</div>' +
            '<div class="dash-week-day">' + d.label + '</div>' +
          '</div>';
        }).join('') +
      '</div>';

    container.appendChild(section);
  }

  function renderBadges(allBadges, container) {
    const earned = allBadges.filter(function (b) { return b.earned; }).length;
    const section = document.createElement('div');
    section.className = 'dash-badges-section';
    section.innerHTML =
      '<div class="dash-badges-title">Badges <span class="dash-badges-count">' + earned + ' / ' + allBadges.length + '</span></div>' +
      '<div class="dash-badges-grid">' +
        allBadges.map(function (b) {
          return '<div class="dash-badge-item ' + (b.earned ? 'earned' : 'locked') + '" title="' + esc(b.desc || '') + '">' +
            '<div class="dash-badge-icon">' + (b.icon || '🏅') + '</div>' +
            '<div class="dash-badge-name">' + esc(b.name || '') + '</div>' +
          '</div>';
        }).join('') +
      '</div>';
    container.appendChild(section);
  }

  // ============================================================
  //  MISSIONS QUOTIDIENNES
  // ============================================================
  function renderDailyMissions(data) {
    var container = document.getElementById('dash-missions');
    if (!container) return;

    var missions  = data.missions || [];
    var doneCount = data.doneCount || 0;
    var pct       = Math.round((doneCount / 3) * 100);
    var allDone   = data.allDone;
    var bonusClaimed = data.bonusClaimed;

    var streakLine = '';
    if (data.streakMultiplier && data.streakMultiplier > 1) {
      streakLine = '<div class="dash-missions-streak-boost">⚡ Boost streak actif : ×' +
        data.streakMultiplier.toFixed(1) + ' XP (streak ' + data.streak + ' jours)</div>';
    }

    var missionRows = missions.map(function (m) {
      var isDone = m.done;
      var barW   = m.target > 1 ? Math.round((m.progress / m.target) * 100) : (isDone ? 100 : 0);
      return '<div class="dash-mission-row' + (isDone ? ' done' : '') + '">' +
        '<div class="dash-mission-check">' + (isDone ? '✓' : '') + '</div>' +
        '<div class="dash-mission-body">' +
          '<div class="dash-mission-label">' + m.icon + ' ' + esc(m.label) + '</div>' +
          (m.target > 1
            ? '<div class="dash-mission-mini-bar"><div class="dash-mission-mini-fill" style="width:' + barW + '%"></div></div>'
            : '') +
        '</div>' +
        '<div class="dash-mission-xp">+' + m.xp + ' XP</div>' +
      '</div>';
    }).join('');

    var bonusRow = '<div class="dash-mission-bonus' + (allDone ? ' done' : '') + '">' +
      '<span class="dash-mission-bonus-icon">' + (bonusClaimed ? '🎯' : '🎯') + '</span>' +
      '<span class="dash-mission-bonus-label">Toutes les missions complètes</span>' +
      '<span class="dash-mission-bonus-xp">' + (bonusClaimed ? '✓ +50 XP réclamé' : '+50 XP bonus') + '</span>' +
    '</div>';

    container.innerHTML =
      '<div class="dash-missions-card">' +
        '<div class="dash-missions-head">' +
          '<span class="dash-missions-title">🎯 Missions du jour</span>' +
          '<span class="dash-missions-count">' + doneCount + ' / 3</span>' +
        '</div>' +
        '<div class="dash-missions-progress-bar"><div class="dash-missions-progress-fill" id="dm-fill" style="width:0%"></div></div>' +
        streakLine +
        '<div class="dash-missions-list">' + missionRows + '</div>' +
        bonusRow +
      '</div>';

    setTimeout(function () {
      var fill = document.getElementById('dm-fill');
      if (fill) fill.style.width = pct + '%';
    }, 150);
  }

  // ============================================================
  //  REFERRAL
  // ============================================================
  function renderReferral(data) {
    var container = document.getElementById('dash-referral');
    if (!container || !data.code) return;

    container.innerHTML =
      '<div class="dash-referral-card">' +
        '<div class="dash-referral-head">' +
          '<span class="dash-referral-title">🔗 Invite tes amis</span>' +
          '<span class="dash-referral-count">' + (data.referredCount || 0) + ' invité' + ((data.referredCount || 0) > 1 ? 's' : '') + '</span>' +
        '</div>' +
        '<p class="dash-referral-desc">Ton ami gagne <strong>+50 XP</strong> à l\'inscription · toi aussi 🎁</p>' +
        '<div class="dash-referral-link-row">' +
          '<input class="dash-referral-input" id="ref-link-input" readonly value="' + esc(data.shareUrl || '') + '" />' +
          '<button class="dash-referral-copy" onclick="copyReferralLink()">Copier</button>' +
        '</div>' +
        '<p class="dash-referral-hint">💡 Partage ce lien — ton ami atterrit sur une page dédiée avec ton prénom</p>' +
        (data.totalXPEarned > 0
          ? '<div class="dash-referral-earned">🏆 +' + data.totalXPEarned + ' XP gagnés via parrainage (' + (data.referredCount || 0) + ' ami' + ((data.referredCount || 0) > 1 ? 's' : '') + ')</div>'
          : '') +
      '</div>';
  }

  window.copyReferralLink = function () {
    var input = document.getElementById('ref-link-input');
    if (!input) return;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(input.value).then(function () {
        showCopyFeedback();
      }).catch(function () { legacyCopy(input); });
    } else {
      legacyCopy(input);
    }
  };

  function legacyCopy(input) {
    input.select();
    document.execCommand('copy');
    showCopyFeedback();
  }

  function showCopyFeedback() {
    var btn = document.querySelector('.dash-referral-copy');
    if (!btn) return;
    var orig = btn.textContent;
    btn.textContent = '✓ Copié !';
    setTimeout(function () { btn.textContent = orig; }, 2000);
  }

  function showStreakWarning(streak) {
    var existing = document.getElementById('streak-warning-banner');
    if (existing) return;
    var banner = document.createElement('div');
    banner.id = 'streak-warning-banner';
    banner.className = 'streak-warning-banner';
    banner.innerHTML =
      '⚠️ <strong>Ton streak de ' + streak + ' jours va se casser !</strong> ' +
      'Complète une mission aujourd\'hui pour le garder. ' +
      '<a href="/" class="streak-warning-cta">Générer une fiche →</a>';
    var container = document.querySelector('.dash-container');
    if (container) container.insertBefore(banner, container.firstChild);
  }

  // Toast positif "comeback" — slide depuis le haut, auto-disparaît
  function showStreakComeback(streak) {
    if (document.getElementById('streak-comeback-toast')) return;
    window.SFX && SFX.streak();
    var toast = document.createElement('div');
    toast.id = 'streak-comeback-toast';
    toast.className = 'streak-comeback-toast';
    toast.setAttribute('role', 'status');
    toast.innerHTML =
      '<span class="streak-comeback-icon">🔥</span>' +
      '<span>Bon retour ! Tu maintiens ton streak de <strong>' + streak + ' jour' +
      (streak > 1 ? 's' : '') + '</strong> !</span>';
    document.body.appendChild(toast);
    setTimeout(function () { if (toast.parentNode) toast.remove(); }, 3700);
  }

  // ============================================================
  //  CLASSEMENT
  // ============================================================
  function renderLeaderboard(lb) {
    const container = document.getElementById('dash-leaderboard');
    if (!container) return;
    container.classList.remove('hidden');
    const entries = lb.entries || [];

    if (entries.length === 0) {
      container.innerHTML =
        '<div class="dash-leader-head">🏆 Classement cette semaine</div>' +
        '<div class="dash-leader-empty">Complète un quiz pour apparaître ici !</div>';
      return;
    }

    const rankIcon = function (i) {
      if (i === 0) return '<span class="dash-leader-rank rank-1">🥇</span>';
      if (i === 1) return '<span class="dash-leader-rank rank-2">🥈</span>';
      if (i === 2) return '<span class="dash-leader-rank rank-3">🥉</span>';
      return '<span class="dash-leader-rank">' + (i + 1) + '</span>';
    };

    container.innerHTML =
      '<div class="dash-leader-head">🏆 Classement cette semaine <span class="dash-leader-week">Nv ' + (lb.week || '') + '</span></div>' +
      entries.map(function (e, i) {
        return '<div class="dash-leader-row' + (e.isMe ? ' me' : '') + '">' +
          rankIcon(i) +
          '<span class="dash-leader-label">' + esc(e.label) + (e.isMe ? ' (toi)' : '') + '</span>' +
          '<span class="dash-leader-xp">' + e.weeklyXP + ' XP</span>' +
          (e.streak > 0 ? '<span class="dash-leader-streak">🔥' + e.streak + '</span>' : '') +
        '</div>';
      }).join('');
  }

  // ============================================================
  //  STATISTIQUES
  // ============================================================
  function renderStats(stats) {
    const container = document.getElementById('dash-stats');
    if (!container) return;

    const weakCount = stats.weakAreas?.length || 0;

    container.innerHTML =
      statCard(stats.totalSessions,   'Session' + (stats.totalSessions !== 1 ? 's' : '')) +
      statCard(stats.completedQuizzes,'Quiz complété' + (stats.completedQuizzes !== 1 ? 's' : '')) +
      statCard(stats.averageScore !== null ? stats.averageScore + '%' : '—', 'Score moyen') +
      statCard(weakCount > 0 ? weakCount : '✓', weakCount > 0 ? 'Point' + (weakCount > 1 ? 's' : '') + ' à revoir' : 'Aucun point faible');

    // Zone points faibles
    const weakEl = document.getElementById('dash-weak');
    if (weakEl && stats.weakAreas?.length > 0) {
      weakEl.innerHTML =
        '<strong>⚠ Points à renforcer :</strong> ' +
        stats.weakAreas.map(esc).join(' · ');
      weakEl.classList.remove('hidden');
    }

    // Graphe de progression (trend = derniers scores en %)
    const trend = stats.trend || [];
    const chartWrap = document.getElementById('dash-progress-chart');
    const chartBars = document.getElementById('dash-chart-bars');
    const chartLabels = document.getElementById('dash-chart-labels');
    if (chartWrap && chartBars && trend.length >= 2) {
      chartWrap.classList.remove('hidden');
      const maxVal = Math.max(...trend, 1);
      const HEIGHT = 70;
      chartBars.innerHTML = trend.map(function(v, i) {
        const h    = Math.max(4, Math.round((v / 100) * HEIGHT));
        const col  = v >= 80 ? '#10b981' : v >= 60 ? '#f59e0b' : '#ef4444';
        return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px">
          <div style="font-size:.65rem;color:#64748b;font-weight:700">${v}%</div>
          <div style="width:100%;height:${h}px;background:${col};border-radius:4px 4px 0 0;opacity:.85;min-height:4px"></div>
        </div>`;
      }).join('');
      chartLabels.innerHTML = trend.map(function(_, i) {
        return `<div style="flex:1;text-align:center;font-size:.65rem;color:#475569">Quiz ${i + 1}</div>`;
      }).join('');
    }
  }

  function statCard(value, label) {
    return `<div class="dash-stat">
      <span class="dash-stat-value">${esc(String(value))}</span>
      <span class="dash-stat-label">${esc(label)}</span>
    </div>`;
  }

  // ============================================================
  //  LISTE DES SESSIONS
  // ============================================================
  function renderSessions(items) {
    const grid     = document.getElementById('dash-sessions');
    const countEl  = document.getElementById('dash-session-count');
    if (!grid) return;

    if (countEl) countEl.textContent = items.length + ' session' + (items.length !== 1 ? 's' : '');

    if (items.length === 0) {
      grid.innerHTML =
        '<div class="dash-empty">' +
          '<div class="dash-empty-icon">📭</div>' +
          '<p>Aucune session pour l\'instant.</p>' +
          '<a href="/" class="btn-primary" style="margin-top:16px;display:inline-block">Générer mon premier cours ⚡</a>' +
        '</div>';
      return;
    }

    grid.innerHTML = items.map(buildCard).join('');

    // Événements de clic
    grid.querySelectorAll('.dash-card').forEach(function (card) {
      card.addEventListener('click', function () {
        const idx  = parseInt(this.dataset.idx, 10);
        const item = items[idx];
        if (item) showDetail(item, items);
      });
    });
  }

  function buildCard(item, idx) {
    const d       = new Date(item.createdAt);
    const date    = d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
    const labels  = { quiz: '🎯 Quiz', summary: '📝 Résumé', full: '📚 Complet' };
    const mode    = labels[item.mode] || '📚';
    const score   = item.quizResult
      ? `<span class="dash-card-score ${scoreClass(item.quizResult)}">${item.quizResult.score}/${item.quizResult.total}</span>`
      : '';

    return `<div class="dash-card" data-idx="${idx}">
      <div class="dash-card-meta">
        <span class="dash-card-date">${date}</span>
        <span class="dash-card-mode">${mode}</span>
        ${score}
      </div>
      <p class="dash-card-topic">${esc(item.topic)}</p>
      <span class="dash-card-cta">Consulter →</span>
    </div>`;
  }

  function scoreClass(r) {
    const pct = r.score / r.total;
    if (pct >= 0.8) return 'score-good';
    if (pct >= 0.5) return 'score-mid';
    return 'score-low';
  }

  // ============================================================
  //  DÉTAIL D'UNE SESSION
  // ============================================================
  function showDetail(item, allItems) {
    const listSection = document.getElementById('dash-list-section');
    const detail      = document.getElementById('dash-detail');
    if (!detail) return;

    if (listSection) listSection.classList.add('hidden');
    detail.classList.remove('hidden');

    const d       = new Date(item.createdAt);
    const dateStr = d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
    const hasQuiz = Array.isArray(item.quiz) && item.quiz.length > 0;

    detail.innerHTML = `
      <div class="dash-detail-nav">
        <button class="dash-back-btn" id="dash-back">← Retour à mes sessions</button>
        <span class="dash-detail-date">${dateStr}</span>
      </div>

      <h2 class="dash-detail-title">${esc(item.topic)}</h2>

      ${item.quizResult ? renderScoreBanner(item.quizResult) : ''}

      <div class="dash-detail-tabs">
        <button class="dash-dtab active" data-tab="summary">📝 Résumé</button>
        <button class="dash-dtab" data-tab="flashcard">🗂️ Fiche</button>
        ${hasQuiz ? '<button class="dash-dtab" data-tab="quiz">🎯 Quiz</button>' : ''}
      </div>

      <div class="dash-dtab-content" id="dtab-summary">
        <div class="dash-summary-box">
          <p class="dash-summary-text">${esc(item.summary || '')}</p>
        </div>
      </div>

      <div class="dash-dtab-content hidden" id="dtab-flashcard">
        <ul class="dash-flash-list">
          ${(item.flashcard || []).map(f => `<li><span class="flash-dot"></span>${esc(f)}</li>`).join('')}
        </ul>
      </div>

      ${hasQuiz ? `
      <div class="dash-dtab-content hidden" id="dtab-quiz">
        ${item.quizResult ? renderQuizMissed(item) : '<p class="dash-quiz-note">Ce quiz n\'a pas encore été complété.</p>'}
        <div class="dash-quiz-review">
          ${item.quiz.map(renderQuizQuestion).join('')}
        </div>
      </div>` : ''}
    `;

    // Tabs
    detail.querySelectorAll('.dash-dtab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        detail.querySelectorAll('.dash-dtab').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        detail.querySelectorAll('.dash-dtab-content').forEach(c => c.classList.add('hidden'));
        const target = detail.querySelector('#dtab-' + this.dataset.tab);
        if (target) target.classList.remove('hidden');
      });
    });

    // Retour
    const backBtn = detail.querySelector('#dash-back');
    if (backBtn) backBtn.addEventListener('click', function () { hideDetail(allItems); });

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderScoreBanner(r) {
    const pct   = Math.round(r.score / r.total * 100);
    const emoji = pct === 100 ? '🏆' : pct >= 80 ? '🌟' : pct >= 60 ? '👍' : '📚';
    const cls   = pct >= 80 ? 'banner-good' : pct >= 60 ? 'banner-mid' : 'banner-low';
    return `<div class="dash-score-banner ${cls}">
      ${emoji} Score : <strong>${r.score} / ${r.total}</strong> — ${pct}%
    </div>`;
  }

  function renderQuizMissed(item) {
    const missed = item.quizResult?.wrongConcepts || [];
    if (missed.length === 0) return '';
    return `<div class="dash-missed-box">
      <strong>Points ratés :</strong>
      <ul>${missed.slice(0, 5).map(c => `<li>${esc(c)}</li>`).join('')}</ul>
    </div>`;
  }

  function renderQuizQuestion(q, i) {
    const diffLabel = { 1: 'Facile', 2: 'Moyen', 3: 'Difficile' }[q.difficulty] || '';
    const diffCls   = { 1: 'easy', 2: 'medium', 3: 'hard' }[q.difficulty] || '';

    const optionsHtml = q.type === 'mcq'
      ? `<ul class="dash-q-options">${(q.options || []).map((o, oi) =>
          `<li class="${oi === q.answer ? 'dash-q-correct' : ''}">${esc(o)}</li>`
        ).join('')}</ul>`
      : `<p class="dash-q-open-ans"><em>Réponse : ${esc(q.expectedAnswer || q.explanation || '')}</em></p>`;

    return `<div class="dash-qcard">
      <div class="dash-qcard-header">
        <span class="dash-qnum">Q${i + 1}</span>
        ${diffLabel ? `<span class="quiz-difficulty-badge ${diffCls}">${diffLabel}</span>` : ''}
        <span class="quiz-type-badge">${q.type === 'open' ? '✍ Rédigée' : '✦ QCM'}</span>
      </div>
      <p class="dash-q-text">${esc(q.question)}</p>
      ${optionsHtml}
      ${q.explanation ? `<p class="dash-q-expl">💡 ${esc(q.explanation)}</p>` : ''}
    </div>`;
  }

  function hideDetail(allItems) {
    const listSection = document.getElementById('dash-list-section');
    const detail      = document.getElementById('dash-detail');
    detail.innerHTML  = '';
    detail.classList.add('hidden');
    if (listSection) listSection.classList.remove('hidden');
  }

  function showError(msg) {
    const grid = document.getElementById('dash-sessions');
    if (grid) grid.innerHTML = `<div class="dash-error">${esc(msg)}</div>`;
  }

  // ============================================================
  //  UTILITAIRES
  // ============================================================
  function esc(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  window.dashLogout = function () {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    window.location.href = '/';
  };

  // Wire up logout buttons (removed inline onclick for CSP compliance)
  document.addEventListener('DOMContentLoaded', function() {
    var logoutBtns = [
      document.getElementById('btn-logout-header'),
      document.getElementById('btn-logout-bottom'),
    ];
    logoutBtns.forEach(function(btn) {
      if (btn) btn.addEventListener('click', window.dashLogout);
    });

    var surpriseBtn = document.getElementById('btn-surprise-quiz');
    if (surpriseBtn) surpriseBtn.addEventListener('click', window.startSurpriseQuiz);
  });

  // Surprise quiz — redirige vers la page principale et lance le quiz
  window.startSurpriseQuiz = async function() {
    var btn = document.getElementById('btn-surprise-quiz');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Chargement…'; }
    try {
      var res  = await fetch('/api/surprise-quiz', { headers: { 'x-auth-token': token } });
      var data = await res.json();
      if (!res.ok || !data.questions?.length) {
        alert(data.error || 'Génère d\'abord quelques cours pour alimenter l\'interro surprise !');
        if (btn) { btn.disabled = false; btn.textContent = '🎲 Interro surprise'; }
        return;
      }
      sessionStorage.setItem('studyai_surprise', JSON.stringify(data));
      window.location.href = '/?surprise=1';
    } catch(e) {
      alert('Erreur réseau');
      if (btn) { btn.disabled = false; btn.textContent = '🎲 Interro surprise'; }
    }
  };
})();
