// ============================================================
//  StudyAI — Frontend
// ============================================================

// Mode test admin — injecte x-admin-key dans tous les appels /api/
(function () {
  var _adminKey = localStorage.getItem('studyai_test_admin_key');
  if (!_adminKey) return;
  var _origFetch = window.fetch.bind(window);
  window.fetch = function (url, opts) {
    if (typeof url === 'string' && url.includes('/api/')) {
      opts = opts || {};
      opts.headers = Object.assign({}, opts.headers, { 'x-admin-key': _adminKey });
    }
    return _origFetch(url, opts);
  };
  // Bandeau visible
  var banner = document.createElement('div');
  banner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#7c3aed;color:#fff;text-align:center;font-size:13px;font-weight:700;padding:6px;z-index:99999;cursor:pointer';
  banner.textContent = '⚡ MODE TEST ADMIN ACTIF — cliquer pour désactiver';
  banner.onclick = function () { localStorage.removeItem('studyai_test_admin_key'); banner.remove(); location.reload(); };
  document.addEventListener('DOMContentLoaded', function () { document.body.prepend(banner); });
}());

// Traduction (i18n.js chargé avant ce fichier)
function t(key, vars) {
  if (!window.i18n) return key;
  return window.i18n.t(key, vars);
}

// Safe token read — uses safeStore if available (loaded by perf.js), else raw
const _safeGet = function (k) {
  return window.safeStore ? window.safeStore.get(k, null) : (function () {
    try { return localStorage.getItem(k); } catch { return null; }
  }());
};

// État global
const state = {
  quizQuestions:    [],
  currentQuestion:  0,
  score:            0,
  answered:         false,
  flashcardData:    [],
  premiumToken:     _safeGet('studyai_premium_token'),
  currentContentId: null,
  country: null,
  wrongQuestions:        [],
  currentTopic:          '',
  correctByDifficulty:   {},
  isPremium:             false,
  _generating:           false,
};

// ============================================================
//  MODAL PREMIUM — défini au niveau module pour survivre aux erreurs DOMContentLoaded
// ============================================================
(function () {
  var _open = false, _esc = null;
  function _el() { return document.getElementById('modal-premium'); }

  window.showPremiumModal = function () {
    var modal = _el();
    if (!modal) return;
    if (state.isPremium) {
      if (window.showToast) window.showToast('✨ ' + (t('premium_already') || 'Tu es déjà Premium'), 'success');
      return;
    }
    if (_open) {
      if (modal.classList.contains('hidden')) { _open = false; }
      else { return; }
    }
    _open = true;
    window.lockBodyScroll && window.lockBodyScroll();
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    if (window.i18n && window.i18n.applyTranslations) window.i18n.applyTranslations();
    modal.querySelectorAll('.btn-checkout').forEach(function (b) {
      if (!b.dataset.originalText) b.dataset.originalText = b.textContent.trim();
    });
    _esc = function (e) { if (e.key === 'Escape') window.hidePremiumModal(); };
    document.addEventListener('keydown', _esc);
    requestAnimationFrame(function () {
      var btn = modal.querySelector('.modal-close');
      if (btn) btn.focus();
    });
  };

  window.hidePremiumModal = function () {
    var modal = _el();
    if (!modal) return;
    _open = false;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    window.unlockBodyScroll && window.unlockBodyScroll();
    if (_esc) { document.removeEventListener('keydown', _esc); _esc = null; }
    modal.querySelectorAll('.btn-checkout').forEach(function (b) {
      b.disabled = false;
      if (b.dataset.originalText) b.textContent = b.dataset.originalText;
    });
  };

  // Compat legacy — appelé depuis les onclick inline restants
  window.closeModal = function (e) {
    if (e && e.target === _el()) window.hidePremiumModal();
  };
}());

// ── Waitlist modal (launch-mode) ──────────────────────────────
var _wlOpen = false;

window.showWaitlistModal = function () {
  var modal = document.getElementById('modal-waitlist');
  if (!modal) return;
  if (_wlOpen) { _wlOpen = false; }  // reset stuck flag
  _wlOpen = true;
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  var form = document.getElementById('wl-form');
  var msg  = document.getElementById('wl-message');
  if (form) { form.style.display = ''; form.reset(); }
  if (msg)  { msg.className = 'wl-message hidden'; msg.textContent = ''; }
  var btn = document.getElementById('wl-submit');
  if (btn) { btn.disabled = false; btn.textContent = t('wl_btn') || "M'inscrire à la liste"; }
  var inp = document.getElementById('wl-email');
  if (inp) { inp.placeholder = t('wl_email_ph') || 'ton@email.com'; setTimeout(function(){ inp.focus(); }, 60); }
  if (window.i18n && window.i18n.applyTranslations) window.i18n.applyTranslations();
};

window.hideWaitlistModal = function () {
  var modal = document.getElementById('modal-waitlist');
  if (!modal) return;
  _wlOpen = false;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
};

// startCheckout — auto-détecte si Stripe est configuré.
// Avec des clés live Stripe dans .env → redirige vers le paiement.
// Sans Stripe configuré → ouvre la waitlist (mode beta).
window.startCheckout = async function (plan) {
  if (!plan) return;
  var modal = document.getElementById('modal-premium');
  var btns  = modal ? Array.from(modal.querySelectorAll('.btn-checkout')) : [];

  // Si Stripe n'est pas chargé côté serveur → waitlist
  var stripeAvailable = !!(window._stripePublicKey);
  if (!stripeAvailable) {
    if (window.hidePremiumModal) window.hidePremiumModal();
    setTimeout(function () {
      if (window.showWaitlistModal) window.showWaitlistModal();
    }, 200);
    return;
  }

  btns.forEach(function (b) { b.disabled = true; b.textContent = t('premium_cta_wait') || 'Redirection…'; });
  try {
    var headers = { 'Content-Type': 'application/json' };
    if (window.auth && window.auth.isLoggedIn()) headers['x-auth-token'] = window.auth.token;
    var res  = await fetch('/api/create-checkout/' + plan, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ country: state.country || null }),
    });
    var data = await res.json();
    if (data.url) { window.location.href = data.url; return; }
    if (window.showToast) window.showToast('❌ ' + (data.error || t('toast_stripe_error')), 'error');
    else alert(data.error || t('toast_stripe_error'));
  } catch (_) {
    if (window.showToast) window.showToast('❌ ' + t('toast_conn_error'), 'error');
    else alert(t('toast_conn_error'));
  }
  btns.forEach(function (b) {
    b.disabled = false;
    if (b.dataset.originalText) b.textContent = b.dataset.originalText;
  });
};

// ============================================================
//  CAROUSEL ROTATIF — 24 éléments × 20 langues
// ============================================================
const ROTATING_GRID_ITEMS = [
  { icon: '⚖️',  key: 'subj_law' },
  { icon: '⚕️',  key: 'subj_medicine' },
  { icon: '🔬',  key: 'subj_science' },
  { icon: '📊',  key: 'subj_math' },
  { icon: '📜',  key: 'subj_history' },
  { icon: '🌍',  key: 'subj_geography' },
  { icon: '💻',  key: 'subj_cs' },
  { icon: '📖',  key: 'subj_literature' },
  { icon: '🇬🇧', key: 'subj_english' },
  { icon: '🧠',  key: 'subj_philosophy' },
  { icon: '💼',  key: 'subj_economics' },
  { icon: '🧬',  key: 'subj_biology' },
  { icon: '📝',  key: 'use_exam' },
  { icon: '🎙️', key: 'use_oral' },
  { icon: '✏️',  key: 'use_test' },
  { icon: '📚',  key: 'use_revision' },
  { icon: '📋',  key: 'feat_summary' },
  { icon: '🃏',  key: 'feat_flashcards' },
  { icon: '❓',  key: 'feat_quiz' },
  { icon: '🎮',  key: 'feat_battle' },
  { icon: '🚀',  key: 'tech_llama' },
  { icon: '🌐',  key: 'tech_languages' },
  { icon: '🎯',  key: 'tech_feynman' },
  { icon: '🇧🇪', key: 'tech_belgium' },
];

(function () {
  function rgText(key) {
    return (window.i18n && window.i18n.t) ? window.i18n.t(key) : key;
  }
  function rgShuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }
  function renderGrid() {
    var grid = document.getElementById('rotatingGrid');
    if (!grid) return;
    var items = rgShuffle(ROTATING_GRID_ITEMS).slice(0, 6);
    grid.innerHTML = items.map(function (item) {
      var label = rgText(item.key);
      return '<div class="grid-chip"><span class="chip-icon">' + item.icon +
             '</span><span class="chip-label">' + label + '</span></div>';
    }).join('');
  }
  window._rgRender = renderGrid;
  document.addEventListener('DOMContentLoaded', function () {
    if (!document.getElementById('rotatingGrid')) return;
    renderGrid();
    setInterval(renderGrid, 3000);
  });
  document.addEventListener('langchange', function () {
    if (window._rgRender) window._rgRender();
  });
}());

// ============================================================
//  DÉMARRAGE — s'exécute dès que la page est chargée
// ============================================================
document.addEventListener('DOMContentLoaded', function () {

  function esc(s) { return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // --- Éléments DOM ---
  const courseInput       = document.getElementById('course-input');
  const charCount         = document.getElementById('char-count');
  const btnGenerate       = document.getElementById('btn-generate');
  const sectionInput      = document.getElementById('section-input');
  const sectionLoading    = document.getElementById('section-loading');
  const sectionResults    = document.getElementById('section-results');
  const sectionQuiz       = document.getElementById('section-quiz');
  const loadingMsg        = document.getElementById('loading-msg');
  const summaryText       = document.getElementById('summary-text');
  const flashcardList     = document.getElementById('flashcard-list');
  const quizQCount        = document.getElementById('quiz-question-count');
  const btnStartQuiz      = document.getElementById('btn-start-quiz');
  const btnRestart        = document.getElementById('btn-restart');
  const quizFill          = document.getElementById('quiz-progress-fill');
  const quizCounter       = document.getElementById('quiz-counter');
  const quizQuestionText  = document.getElementById('quiz-question-text');
  const quizOptions       = document.getElementById('quiz-options');
  const quizExplanation   = document.getElementById('quiz-explanation');
  const quizExplText      = document.getElementById('quiz-explanation-text');
  const btnNext           = document.getElementById('btn-next-question');
  const quizScore         = document.getElementById('quiz-score');
  const scoreEmoji        = document.getElementById('score-emoji');
  const scoreValue        = document.getElementById('score-value');
  const scoreTotal        = document.getElementById('score-total');
  const scoreMessage      = document.getElementById('score-message');
  const btnRetry          = document.getElementById('btn-retry-quiz');
  const btnBack           = document.getElementById('btn-back-results');
  const usageBadge        = document.getElementById('usage-badge');
  const usageText         = document.getElementById('usage-text');
  const toast             = document.getElementById('toast');
  const modalPremium      = document.getElementById('modal-premium');
  const btnPremium        = document.getElementById('btn-premium-header');
  const langSelect        = document.getElementById('lang-select');
  const quizMeta           = document.getElementById('quiz-meta');
  const quizDiffBadge      = document.getElementById('quiz-difficulty-badge');
  const quizTypeBadge      = document.getElementById('quiz-type-badge');
  const quizOpenZone       = document.getElementById('quiz-open-zone');
  const quizOpenInput      = document.getElementById('quiz-open-input');
  const quizSelfAssess     = document.getElementById('quiz-self-assess');

  // --- i18n ---
  if (window.i18n) {
    if (langSelect) langSelect.value = window.i18n.currentLang;
    window.i18n.applyTranslations();
    document.addEventListener('langchange', function () {
      if (langSelect) langSelect.value = window.i18n.currentLang;
      refreshUsage();
    });
  }

  // --- Config Stripe + Tarification régionale ---
  fetch('/api/config')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (cfg) {
      if (cfg && cfg.stripePublicKey) window._stripePublicKey = cfg.stripePublicKey;
    }).catch(function () {});

  (window.fetchRetry || fetch)('/api/country', {}, 1)
    .then(function (r) { return r.json(); })
    .then(function (pricing) {
      state.country = pricing.country || null;
      document.querySelectorAll('[data-price-key]').forEach(function (el) {
        const val = pricing[el.dataset.priceKey];
        if (val) el.textContent = val;
      });
      if (pricing.currency && pricing.currency !== 'EUR') {
        const note = document.querySelector('.modal-free-note');
        if (note) note.textContent = (note.textContent || '') + ' · Facturation en EUR';
      }
    }).catch(function () {});

  // --- URL params ---
  const params    = new URLSearchParams(window.location.search);
  const sessionId = params.get('session_id');
  if (sessionId) {
    verifyPayment(sessionId).then(function () {
      window.history.replaceState({}, '', '/');
    });
  }

  // Referral code → stocké, utilisé après inscription
  const refCode = params.get('ref');
  if (refCode) {
    try { sessionStorage.setItem('studyai_ref', refCode); } catch {}
  }
  // Surprise quiz depuis le dashboard
  if (params.get('surprise') === '1') {
    window.history.replaceState({}, '', '/');
    try {
      var surpriseData = JSON.parse(sessionStorage.getItem('studyai_surprise') || 'null');
      sessionStorage.removeItem('studyai_surprise');
      if (surpriseData && surpriseData.questions?.length) {
        setTimeout(function() {
          state.quizQuestions       = surpriseData.questions;
          state.currentQuestion     = 0;
          state.score               = 0;
          state.wrongQuestions      = [];
          state.correctByDifficulty = {};
          state.currentContentId    = null;
          showSection('quiz');
          quizScore.classList.add('hidden');
          showQuestion(0);
          _startTimer();
          showToast('🎲 Interro surprise — ' + surpriseData.picked + ' questions !', 'success');
        }, 400);
      }
    } catch {}
  }

  // Topic pré-rempli depuis un lien partagé
  const topicParam = params.get('topic');
  if (topicParam && courseInput) {
    courseInput.value = decodeURIComponent(topicParam).slice(0, 20000);
    courseInput.dispatchEvent(new Event('input'));
  }
  if (refCode || topicParam) window.history.replaceState({}, '', '/');

  // --- Usage badge ---
  refreshUsage();

  // ============================================================
  //  EVENTS
  // ============================================================

  // Compteur de caractères — debounced pour éviter les reflows répétés
  const _updateCharCount = function () {
    const len = courseInput.value.length;
    const fmt = t('char_count_of') !== 'char_count_of'
      ? t('char_count_of').replace('{n}', len.toLocaleString())
      : len + ' / 20 000';
    charCount.textContent = fmt;
    charCount.style.color = len > 18000 ? 'var(--warning)' : 'var(--text-subtle)';
  };
  courseInput.addEventListener('input', window.debounce ? window.debounce(_updateCharCount, 80) : _updateCharCount);

  // Bouton Générer
  btnGenerate.addEventListener('click', generate);

  // Aussi sur Ctrl+Entrée dans la textarea
  courseInput.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') generate();
  });

  // Tabs
  document.querySelectorAll('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () { switchTab(tab.dataset.tab); });
  });

  if (btnRestart)    btnRestart.addEventListener('click', resetToInput);
  if (btnStartQuiz)  btnStartQuiz.addEventListener('click', startQuiz);
  if (btnNext)       btnNext.addEventListener('click', nextQuestion);
  if (btnRetry)      btnRetry.addEventListener('click', startQuiz);
  if (btnBack)       btnBack.addEventListener('click', function () { showSection('results'); switchTab('flashcard'); });
  if (btnPremium)    btnPremium.addEventListener('click', function() { window.showPremiumModal(); });

  // Example chips — event delegation (CSP script-src-attr 'none' blocks inline onclick)
  var exampleChipsContainer = document.querySelector('.example-chips');
  if (exampleChipsContainer) {
    exampleChipsContainer.addEventListener('click', function (e) {
      var chip = e.target.closest('.example-chip');
      if (chip) window.useExample(chip);
    });
  }

  // "Commencer gratuitement" button in premium modal
  var btnUseFree = document.getElementById('btn-use-free');
  if (btnUseFree) {
    btnUseFree.addEventListener('click', function () {
      if (window.hidePremiumModal) window.hidePremiumModal();
      setTimeout(function () {
        var el = document.getElementById('course-input');
        if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.focus(); }
      }, 250);
    });
  }

  // Footer "Tarifs" link
  var footerPricing = document.getElementById('footer-link-pricing');
  if (footerPricing) {
    footerPricing.addEventListener('click', function (e) {
      e.preventDefault();
      if (window.showPremiumModal) window.showPremiumModal();
    });
  }

  // ── Buttons wired via addEventListener (CSP blocks inline onclick) ──
  (function () {
    var _q = function (id) { return document.getElementById(id); };

    // "Essayer maintenant" CTA in compare section
    var btnCompareCta = _q('btn-compare-cta');
    if (btnCompareCta) btnCompareCta.addEventListener('click', function () {
      var el = document.getElementById('course-input');
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.focus(); }
    });

    // Guest nudge
    var guestNudgeCta = _q('guest-nudge-cta');
    if (guestNudgeCta) guestNudgeCta.addEventListener('click', function () {
      if (window.openRegisterModal) window.openRegisterModal();
    });
    var guestNudgeClose = _q('guest-nudge-close');
    if (guestNudgeClose) guestNudgeClose.addEventListener('click', function () {
      if (window.dismissGuestNudge) window.dismissGuestNudge();
    });

    // Copy buttons
    var btnCopySummary = _q('btn-copy-summary');
    if (btnCopySummary) btnCopySummary.addEventListener('click', function () {
      if (window.copyText) window.copyText('summary-text');
    });
    var btnCopyFlashcard = _q('btn-copy-flashcard');
    if (btnCopyFlashcard) btnCopyFlashcard.addEventListener('click', function () {
      if (window.copyFlashcard) window.copyFlashcard();
    });

    // Quiz open-ended buttons
    var btnReveal = _q('btn-reveal-answer');
    if (btnReveal) btnReveal.addEventListener('click', function () {
      if (window.revealAnswer) window.revealAnswer();
    });
    var btnSelfCorrect = _q('btn-self-correct');
    if (btnSelfCorrect) btnSelfCorrect.addEventListener('click', function () {
      if (window.selfAssess) window.selfAssess(true);
    });
    var btnSelfWrong = _q('btn-self-wrong');
    if (btnSelfWrong) btnSelfWrong.addEventListener('click', function () {
      if (window.selfAssess) window.selfAssess(false);
    });

    // Consolidation
    var btnConsolidate = _q('btn-consolidate');
    if (btnConsolidate) btnConsolidate.addEventListener('click', function () {
      if (window.startConsolidation) window.startConsolidation();
    });

    // Bottom nav
    var bottomNavDash = _q('bottom-nav-dashboard');
    if (bottomNavDash) bottomNavDash.addEventListener('click', function () {
      window.location.href = '/dashboard';
    });
    var bottomNavAccount = _q('bottom-nav-account');
    if (bottomNavAccount) bottomNavAccount.addEventListener('click', function () {
      if (window.showAuthModal) window.showAuthModal();
    });

    // Footer support link
    var footerSupport = _q('footer-link-support');
    if (footerSupport) footerSupport.addEventListener('click', function (e) {
      e.preventDefault();
      var btn = document.querySelector('#support-bot-container button');
      if (btn) btn.click();
    });
  }());

  // ── "Voir un exemple" → scroll to btn-generate + pulse ───────
  var btnSeeExample = document.getElementById('btn-see-example');
  if (btnSeeExample) {
    btnSeeExample.addEventListener('click', function () {
      var btnGen = document.getElementById('btn-generate');
      if (!btnGen) return;
      btnGen.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(function () {
        btnGen.classList.add('btn-pulse');
        setTimeout(function () { btnGen.classList.remove('btn-pulse'); }, 1400);
      }, 600);
    });
  }

  // ── How-it-works steps — animate in on scroll ────────────────
  (function () {
    var steps = document.querySelectorAll('.how-step-anim');
    if (!steps.length || !window.IntersectionObserver) {
      steps.forEach(function (s) { s.classList.add('how-step-visible'); });
      return;
    }
    var triggered = false;
    var obs = new IntersectionObserver(function (entries) {
      if (triggered) return;
      if (!entries[0].isIntersecting) return;
      triggered = true;
      obs.disconnect();
      steps.forEach(function (step, i) {
        setTimeout(function () {
          step.classList.add('how-step-visible');
        }, i * 200);
      });
    }, { threshold: 0.15 });
    var container = document.getElementById('how-steps');
    if (container) obs.observe(container);
  }());

  // ============================================================
  //  GÉNÉRATION
  // ============================================================

  window.useExample = function (btn) {
    var content;
    var i18nKey = btn.dataset && btn.dataset.i18n;
    if (i18nKey && window.i18n && window.i18n.t) {
      var translated = window.i18n.t(i18nKey + '_text');
      if (translated && translated !== i18nKey + '_text') content = translated;
    }
    if (!content) content = (btn.dataset && btn.dataset.example) ? btn.dataset.example : btn.textContent.trim();
    if (!content || !courseInput) return;
    courseInput.value = content;
    courseInput.dispatchEvent(new Event('input'));
    courseInput.focus();
    courseInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  // ── Topic picker ────────────────────────────────────────────
  var _SUBJECTS = {
    math: {
      re: /\bmath|algebr|geometr|trigon|dérivée|derivada|derivativ|intégral|integral|équation|ecuacion|equation|fraction|probabilit|logarithm|polynôm|polynom|vecteur|vector|matematy|matematik|matematica|matematicas|matematika|wiskund|математик|数学|수학|toán|คณิต|رياض|गणित/i,
      topics: ['ma_arith','ma_frac','ma_pct','ma_eq1','ma_eq2','ma_func','ma_geom','ma_vol','ma_trig','ma_stat','ma_seq','ma_calc']
    },
    physics: {
      re: /physique|physic|física|physik|fisic|fisik|fyzic|fizik|fizyk|natuurk|визик|физик|фізик|物理|물리|ฟิสิกส์|فيزياء|vật|भौतिक/i,
      topics: ['ph_kine','ph_dyn','ph_enrg','ph_circ','ph_magn','ph_opti','ph_wave','ph_thermo','ph_fluid','ph_mod']
    },
    chemistry: {
      re: /chimi|chemist|quím|chemi|scheik|kimia|kimya|chimică|хими|хімі|化学|화학|เคมี|كيمياء|hóa|रसायन/i,
      topics: ['ch_atom','ch_table','ch_react','ch_acid','ch_redox','ch_therm','ch_kinet','ch_org','ch_stoich','ch_sol']
    },
    biology: {
      re: /biolog|biyoloj|биолог|біолог|sinh\s*học|生物|생물|ชีว|بيولوج|जीव/i,
      topics: ['bi_cell','bi_divis','bi_dna','bi_genet','bi_evol','bi_class','bi_body','bi_immun','bi_eco','bi_photo']
    },
    history: {
      re: /histoir|histor|geschicht|geschied|sejarah|tarih|storia|歴史|истори|істори|历史|역사|ประวัติ|تاريخ|lịch\s*sử|इतिहास/i,
      topics: ['hi_anc','hi_rome','hi_midage','hi_crusad','hi_plague','hi_renais','hi_revol','hi_imper','hi_ww1','hi_ww2','hi_cold','hi_contem']
    },
    geography: {
      re: /géograph|geograph|geografí|geografi|aardrijks|coğrafya|географ|地理|지리|ภูมิ|جغرافي|địa\s*lý|भूगोल/i,
      topics: ['ge_relief','ge_ocean','ge_clima','ge_pop','ge_urban','ge_resrc','ge_enrg','ge_glob','ge_inequ','ge_geopo']
    },
    literature: {
      re: /littératur|literatur|letteratur|sastra|edebiyat|литератур|літератур|文学|문학|วรรณ|أدب|văn\s*học|साहित्य/i,
      topics: ['li_text','li_style','li_poet','li_novel','li_theat','li_essay','li_human','li_class','li_romant','li_modern']
    },
    economics: {
      re: /econom|économ|ekonom|wirtschaft|economía|economia|экономик|経済|경제|kinh\s*tế|เศรษฐ|اقتصاد|अर्थ/i,
      topics: ['ec_micro','ec_macro','ec_money','ec_trade','ec_pubfin','ec_labor','ec_devel','ec_think','ec_eu','ec_envi']
    },
    law: {
      re: /\bdroit|law\b|recht|derecho|diritto|hukum|hukuku|право|法律|법|pháp\s*luật|กฎหมาย|قانون|कानून|prawa\b|rechts/i,
      topics: ['la_const','la_civil','la_prop','la_crim','la_admin','la_eu','la_intl','la_labor','la_biz','la_dig']
    },
    medicine: {
      re: /médecin|medicin|medizin|medicina|kedokter|tıp|медицин|医学|의학|y\s*học|การแพทย์|طب|चिकित्सा/i,
      topics: ['md_anato','md_cardio','md_neuro','md_infect','md_pharma','md_diag','md_surg','md_pub','md_endo','md_onco']
    },
    cs: {
      re: /informatik|comput|informatica|programmier|komputer|bilgisayar|информатик|情報|컴퓨터|lập\s*trình|คอมพิว|حاسوب|कंप्यूटर/i,
      topics: ['cs_algo','cs_data','cs_prog','cs_db','cs_os','cs_net','cs_web','cs_sec','cs_ai','cs_soft']
    },
    philosophy: {
      re: /philosoph|filosofi|philosophie|filosofía|filosofia|filsafat|felsefe|философи|哲学|철학|triết|ปรัชญา|فلسف|दर्शन/i,
      topics: ['pf_meta','pf_epist','pf_ethic','pf_polit','pf_logic','pf_mind','pf_sci','pf_anc','pf_mod','pf_cont']
    }
  };
  // Triggers: stem-based, no \b needed — inputs are short (≤350 chars)
  var _TRIGGER_RE = /aide|help|ayuda|hilf|ajuda|aiuto|bantuan|yardım|hulp|studeren|oefenen|pomoc|egzamin|nauka|devoir|homework|examen|exam|revision|study|prepare|prépare|prepara|prüfung|помог|помомож|допомож|экзамен|іспит|екзамен|도와|도움|시험|복습|ช่วย|สอบ|手伝|試験|帮|練|勉強|مساعد|امتحان|تحضير|ôn\s|révision|étude|मदद|परीक्षा|पढ़/i;
  var _skipPicker      = false;
  var _currentSubject  = null;
  var _currentTopicKey = null;

  function _detectSubject(text) {
    if (text.length > 350) return null;
    // Complete sentences (6+ words) are full requests — send directly to AI, skip picker
    if (text.trim().split(/\s+/).length > 5) return null;
    if (!_TRIGGER_RE.test(text)) return null;
    for (var s in _SUBJECTS) {
      if (_SUBJECTS[s].re.test(text)) return s;
    }
    return null;
  }

  function _showTopicPicker(subject) {
    var picker  = document.getElementById('topic-picker');
    var chips   = document.getElementById('topic-chips');
    var titleEl = document.getElementById('topic-picker-title');
    var subEl   = document.getElementById('topic-picker-sub');
    var skipEl  = document.getElementById('topic-skip-btn');
    if (!picker) return;
    if (!_SUBJECTS[subject] || !_SUBJECTS[subject].topics.length) return;

    _hideModePicker();
    titleEl.textContent = t('topic_picker_title');
    subEl.textContent   = t('topic_picker_sub');
    skipEl.textContent  = t('topic_picker_skip');

    chips.innerHTML = '';
    _SUBJECTS[subject].topics.forEach(function (key) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'topic-chip';
      btn.textContent = t(key);
      btn.addEventListener('click', function () { _onTopicChip(key, subject); });
      chips.appendChild(btn);
    });

    skipEl.onclick = function () {
      _hideTopicPicker();
      _skipPicker = true;
      generate();
    };

    picker.classList.remove('hidden');
    picker.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function _hideTopicPicker() {
    var el = document.getElementById('topic-picker');
    if (el) el.classList.add('hidden');
  }

  function _onTopicChip(topicKey, subjectKey) {
    _currentTopicKey = topicKey;
    _currentSubject  = subjectKey;
    _hideTopicPicker();
    _showModePicker(topicKey);
  }

  // ── Mode picker (step 2) ─────────────────────────────────────
  var _MODE_DEFS = [
    { key: 'revise', color: '#3b82f6' },
    { key: 'stuck',  color: '#f59e0b' },
    { key: 'exam',   color: '#ef4444' },
    { key: 'devoir', color: '#10b981' },
    { key: 'deep',   color: '#8b5cf6' },
  ];

  function _showModePicker(topicKey) {
    var picker  = document.getElementById('mode-picker');
    var cards   = document.getElementById('mode-cards');
    var titleEl = document.getElementById('mode-picker-title');
    if (!picker) return;

    var topicName = t(topicKey);
    titleEl.textContent = t('mode_picker_title').replace('{topic}', topicName);

    cards.innerHTML = '';
    _MODE_DEFS.forEach(function (mode) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mode-card';
      btn.setAttribute('data-color', mode.color);
      btn.textContent = t('mode_' + mode.key);
      btn.style.setProperty('--mode-color', mode.color);
      btn.addEventListener('click', function () { _onModePick(mode.key); });
      cards.appendChild(btn);
    });

    picker.classList.remove('hidden');
    picker.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function _hideModePicker() {
    var el = document.getElementById('mode-picker');
    if (el) el.classList.add('hidden');
  }

  function _onModePick(modeKey) {
    var topicName  = t(_currentTopicKey);
    var promptTpl  = t('mode_prompt_' + modeKey);
    var richPrompt = promptTpl.replace(/\{topic\}/g, topicName);
    courseInput.value = richPrompt;
    _hideModePicker();
    _skipPicker = true;
    generate();
  }
  // ────────────────────────────────────────────────────────────

  async function generate() {
    const text = courseInput.value.trim();

    if (text.length < 10) {
      showToast('⚠️ ' + t('toast_min_text'), 'error');
      courseInput.focus();
      return;
    }

    if (text.length > 20000) {
      const msg = t('text_too_long') !== 'text_too_long' ? t('text_too_long') : 'Texte trop long — maximum 20 000 caractères.';
      showToast('⚠️ ' + msg, 'error');
      courseInput.focus();
      return;
    }

    // Show topic picker for short subject-related commands
    if (!_skipPicker) {
      const subj = _detectSubject(text);
      if (subj) { _showTopicPicker(subj); return; }
    }
    _skipPicker = false;

    // Guard against double-clicks and race conditions
    if (btnGenerate.disabled || state._generating) return;
    state._generating = true;
    btnGenerate.disabled = true;

    showSection('loading');

    // Messages de chargement — adaptés selon la longueur du texte
    const isCommand = text.length < 200;
    const msgs = isCommand
      ? [t('loading_cmd_1'), t('loading_cmd_2'), t('loading_cmd_3'), t('loading_cmd_4')]
      : [t('loading_1'), t('loading_2'), t('loading_3'), t('loading_4'), t('loading_5'), t('loading_6')];
    let mi = 0;
    loadingMsg.textContent = msgs[0];
    const ticker = setInterval(function () {
      mi++;
      if (mi < msgs.length) loadingMsg.textContent = msgs[mi];
      else clearInterval(ticker);
    }, 800);

    const controller = new AbortController();
    const fetchTimeout = setTimeout(() => controller.abort(), 65000);

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (state.premiumToken) headers['x-premium-token'] = state.premiumToken;
      if (window.auth?.isLoggedIn()) headers['x-auth-token'] = window.auth.token;
      // Anti-abuse fingerprint for anonymous users
      if (!window.auth?.isLoggedIn()) {
        const fp = await window._getDeviceFingerprint?.();
        if (fp) headers['x-device-fingerprint'] = fp;
      }

      const lang = window.i18n ? window.i18n.currentLang : 'fr';
      const res  = await fetch('/api/generate', { method: 'POST', headers, body: JSON.stringify({ text, country: state.country || null, lang }), signal: controller.signal });
      clearTimeout(fetchTimeout);
      const data = await res.json();

      clearInterval(ticker);

      if (!res.ok) {
        state._generating = false;
        btnGenerate.disabled = false;
        if (data.error === 'limit_reached')   { showSection('input'); window.showPremiumModal(); return; }
        if (data.error === 'rate_limited')    { showSection('input'); showToast(t('toast_rate_limited'), 'error'); return; }
        if (data.error === 'quota_exceeded')  { showSection('input'); window._quotaUI?.showModal(data); return; }
        showSection('input');
        showToast('❌ ' + (data.message || data.error || t('toast_server_error')), 'error');
        return;
      }

      if (data.remaining !== null && data.remaining !== undefined) {
        updateUsage(data.remaining, false);
      }

      state.currentContentId = data.contentId || null;
      state.currentTopic     = text.slice(0, 100);
      state._generating = false;
      btnGenerate.disabled = false;
      showResults(data);

    } catch (err) {
      clearTimeout(fetchTimeout);
      clearInterval(ticker);
      state._generating = false;
      btnGenerate.disabled = false;
      showSection('input');
      if (err.name === 'AbortError') {
        showToast('❌ ' + t('toast_timeout'), 'error');
      } else {
        showToast('❌ ' + t('toast_conn_error'), 'error');
      }
    }
  }

  // ============================================================
  //  AFFICHAGE DES RÉSULTATS
  // ============================================================

  function injectShareButton(topic) {
    var existing = document.getElementById('share-btn-wrap');
    if (existing) existing.remove();

    var tabs = document.querySelector('#section-results .tabs');
    if (!tabs) return;

    var wrap = document.createElement('div');
    wrap.id = 'share-btn-wrap';
    wrap.className = 'share-btn-wrap';

    var btn = document.createElement('button');
    btn.className = 'share-btn';
    btn.innerHTML = (window.i18n && window.i18n.t('btn_share')) || '🔗 Partager';
    btn.addEventListener('click', function () {
      var base   = window.location.origin + '/';
      var qTopic = '?topic=' + encodeURIComponent((topic || '').slice(0, 200));
      var url    = base + qTopic;

      // Ajoute le code referral si connecté
      if (window.auth?.isLoggedIn()) {
        fetch('/api/referral', { headers: { 'x-auth-token': window.auth.token } })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (d.code) url = base + '?ref=' + d.code + '&topic=' + encodeURIComponent((topic || '').slice(0, 200));
            copyShareLink(url);
          }).catch(function () { copyShareLink(url); });
      } else {
        copyShareLink(url);
      }
    });

    wrap.appendChild(btn);
    tabs.parentNode.insertBefore(wrap, tabs);
  }

  function copyShareLink(url) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(function () {
        showToast('🔗 ' + t('toast_link_copied'), 'success');
      }).catch(function () { fallbackCopy(url); });
    } else {
      fallbackCopy(url);
    }
  }

  function fallbackCopy(url) {
    var ta = document.createElement('textarea');
    ta.value = url;
    ta.style.position = 'fixed';
    ta.style.opacity  = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    showToast('🔗 ' + t('toast_link_copied'), 'success');
  }

  // Expose globally for inline onclick handlers
  window.dismissGuestNudge = function () {
    var nudge = document.getElementById('guest-nudge');
    if (nudge) nudge.classList.add('hidden');
    try { sessionStorage.setItem('nudge_dismissed', '1'); } catch {}
  };

  window.openRegisterModal = function () {
    if (window.showAuthModal) window.showAuthModal();
    setTimeout(function () {
      if (window.switchAuthTab) window.switchAuthTab('register');
    }, 50);
  };

  function showResults(data) {
    summaryText.textContent = data.summary || '';

    flashcardList.innerHTML = '';
    state.flashcardData = data.flashcard || [];
    state.flashcardData.forEach(function (point) {
      const li  = document.createElement('li');
      li.className = 'flashcard-item';
      const dot = document.createElement('span');
      dot.className = 'flashcard-dot';
      const txt = document.createElement('span');
      txt.textContent = point;
      li.appendChild(dot);
      li.appendChild(txt);
      flashcardList.appendChild(li);
    });

    state.quizQuestions = data.quiz || [];
    const n = state.quizQuestions.length;
    var examLabel = n >= 14 ? (t('quiz_exam_mode') || '🎯 Mode Examen') : (t('quiz_standard_label') || '— du facile au difficile');
    quizQCount.textContent = (t('quiz_n_questions') || '{n} questions').replace('{n}', n) + ' ' + examLabel;

    const mode = data.mode || 'full';
    showSection('results');

    if (mode === 'quiz') {
      switchTab('quiz');
      setTimeout(startQuiz, 120);
    } else {
      switchTab('summary');
    }

    // Bouton partage viral
    injectShareButton(state.currentTopic);

    // Wirer les nouveaux boutons export/partage
    _wireExportButtons();

    // Guest nudge — invite à créer un compte après la première génération
    if (!window.auth?.isLoggedIn()) {
      try {
        if (!sessionStorage.getItem('nudge_dismissed')) {
          setTimeout(function () {
            var nudge = document.getElementById('guest-nudge');
            if (nudge) nudge.classList.remove('hidden');
          }, 800);
        }
      } catch {}
    }
  }

  // ============================================================
  //  QUIZ
  // ============================================================

  function startQuiz() {
    state.currentQuestion = 0;
    state.score = 0;
    state.answered = false;
    state.wrongQuestions = [];
    state.correctByDifficulty = {};
    quizScore.classList.add('hidden');
    showSection('quiz');
    showQuestion(0);
    _startTimer();
  }

  function showQuestion(idx) {
    const q     = state.quizQuestions[idx];
    const total = state.quizQuestions.length;

    quizFill.style.width = Math.round((idx / total) * 100) + '%';
    quizCounter.textContent = t('quiz_counter', { c: idx + 1, t: total });
    quizQuestionText.textContent = q.question;

    state.answered = false;
    quizExplanation.classList.add('hidden');
    quizSelfAssess.classList.add('hidden');
    quizOpenZone.classList.add('hidden');
    btnNext.classList.add('hidden');
    quizOpenInput.value = '';

    // Badges difficulté + type
    const diffLabels = { 1: t('quiz_difficulty_easy'), 2: t('quiz_difficulty_medium'), 3: t('quiz_difficulty_hard') };
    const diffClasses = { 1: 'easy', 2: 'medium', 3: 'hard' };
    const d = q.difficulty || 1;
    quizDiffBadge.textContent = diffLabels[d] || t('quiz_difficulty_easy');
    quizDiffBadge.className = 'quiz-difficulty-badge ' + (diffClasses[d] || 'easy');
    quizTypeBadge.textContent = q.type === 'open' ? t('quiz_type_open') : t('quiz_type_mcq');
    quizMeta.classList.remove('hidden');

    if (q.type === 'open') {
      quizOptions.innerHTML = '';
      quizOptions.classList.add('hidden');
      quizOpenZone.classList.remove('hidden');
    } else {
      quizOptions.classList.remove('hidden');
      quizOptions.innerHTML = '';
      (q.options || []).forEach(function (opt, i) {
        const btn = document.createElement('button');
        btn.className = 'quiz-option';
        btn.textContent = opt;
        btn.addEventListener('click', function () { answer(i, q.answer, q.explanation); });
        quizOptions.appendChild(btn);
      });
    }
  }

  function answer(selected, correct, explanation) {
    if (state.answered) return;
    state.answered = true;

    const btns = quizOptions.querySelectorAll('.quiz-option');
    btns.forEach(function (b) { b.disabled = true; });
    btns[correct].classList.add('correct');
    if (selected !== correct) {
      btns[selected].classList.add('incorrect');
      window.SFX && SFX.wrong();
      const q = state.quizQuestions[state.currentQuestion];
      state.wrongQuestions.push(q.question);
    } else {
      state.score++;
      window.SFX && SFX.correct();
      const q = state.quizQuestions[state.currentQuestion];
      const d = String(q.difficulty || 1);
      state.correctByDifficulty[d] = (state.correctByDifficulty[d] || 0) + 1;
    }

    quizExplText.textContent = explanation || '';
    quizExplanation.classList.remove('hidden');

    const isLast = state.currentQuestion === state.quizQuestions.length - 1;
    btnNext.textContent = isLast ? t('quiz_finish') : t('quiz_next');
    btnNext.classList.remove('hidden');
  }

  window.revealAnswer = function () {
    if (state.answered) return;
    state.answered = true;

    const q = state.quizQuestions[state.currentQuestion];
    quizExplText.textContent = (q.expectedAnswer || q.explanation || '') +
      (q.explanation && q.expectedAnswer ? '\n\n💡 ' + q.explanation : '');
    quizExplanation.classList.remove('hidden');
    quizOpenZone.classList.add('hidden');
    quizSelfAssess.classList.remove('hidden');
  };

  window.selfAssess = function (wasCorrect) {
    if (wasCorrect) {
      state.score++;
      const q = state.quizQuestions[state.currentQuestion];
      const d = String(q.difficulty || 1);
      state.correctByDifficulty[d] = (state.correctByDifficulty[d] || 0) + 1;
    } else {
      const q = state.quizQuestions[state.currentQuestion];
      state.wrongQuestions.push(q.question);
    }
    quizSelfAssess.classList.add('hidden');
    const isLast = state.currentQuestion === state.quizQuestions.length - 1;
    btnNext.textContent = isLast ? t('quiz_finish') : t('quiz_next');
    btnNext.classList.remove('hidden');
  };

  function nextQuestion() {
    const isLast = state.currentQuestion === state.quizQuestions.length - 1;
    if (isLast) { showScore(); }
    else { state.currentQuestion++; showQuestion(state.currentQuestion); }
  }

  function showScore() {
    const total = state.quizQuestions.length;
    const pct   = state.score / total;
    quizFill.style.width = '100%';
    quizQuestionText.textContent = '';
    quizOptions.innerHTML = '';
    quizExplanation.classList.add('hidden');
    quizOpenZone.classList.add('hidden');
    quizSelfAssess.classList.add('hidden');
    btnNext.classList.add('hidden');

    const map = [
      [1,    '🏆', t('score_perfect')],
      [0.8,  '🌟', t('score_great')],
      [0.6,  '👍', t('score_good')],
      [0.4,  '📚', t('score_ok')],
      [-1,   '💪', t('score_low')],
    ];
    const [, emoji, msg] = map.find(([min]) => pct >= min) || map[map.length - 1];

    scoreEmoji.textContent   = emoji;
    scoreValue.textContent   = state.score;
    scoreTotal.textContent   = ' / ' + total;
    scoreMessage.textContent = msg;
    quizScore.classList.remove('hidden');
    _stopTimer();

    // Bouton de consolidation si au moins 2 questions ratées
    const btnConsolidate = document.getElementById('btn-consolidate');
    if (btnConsolidate) {
      if (state.wrongQuestions.length >= 2) {
        btnConsolidate.classList.remove('hidden');
        btnConsolidate.textContent = t('quiz_consolidate', { n: state.wrongQuestions.length });
      } else {
        btnConsolidate.classList.add('hidden');
      }
    }

    // Sauvegarde automatique du score + gamification si connecté
    if (state.currentContentId && window.auth?.isLoggedIn()) {
      const quizHeaders = { 'Content-Type': 'application/json', 'x-auth-token': window.auth.token };
      if (state.premiumToken) quizHeaders['x-premium-token'] = state.premiumToken;
      fetch('/api/quiz-result', {
        method: 'POST',
        headers: quizHeaders,
        body: JSON.stringify({
          contentId: state.currentContentId,
          score: state.score,
          total,
          wrongConcepts: state.wrongQuestions,
          correctByDifficulty: state.correctByDifficulty,
        }),
      })
        .then(function (r) { if (!r.ok) throw new Error('quiz-result'); return r.json(); })
        .then(function (data) { if (data.xpGain) showGamiResult(data); })
        .catch(function () {});
    }
  }

  // ============================================================
  //  GAMIFICATION — ANIMATIONS & FEEDBACK
  // ============================================================

  function showGamiResult(data) {
    var xpTotal = data.xpGain?.total || 0;

    // 1. Popup XP flottant au-dessus du score
    var anchor = document.getElementById('score-value');
    if (anchor && xpTotal > 0) {
      var rect  = anchor.getBoundingClientRect();
      var popup = document.createElement('div');
      popup.className   = 'xp-popup';
      popup.textContent = '+' + xpTotal + ' XP';
      popup.style.left  = (rect.left + rect.width / 2) + 'px';
      popup.style.top   = (rect.top + window.scrollY + 10) + 'px';
      document.body.appendChild(popup);
      window.SFX && SFX.xp();
      setTimeout(function () { popup.remove(); }, 2000);
    }

    // 2. Injecte le panel gamification dans le bloc score
    injectGamiPanel(data);

    // 3. Level up overlay (si passage de niveau)
    if (data.levelUp) {
      setTimeout(function () { showLevelUp(data.level); }, 800);
    }

    // 4. Toasts missions complétées
    (data.completedMissions || []).forEach(function (m, i) {
      setTimeout(function () { showMissionToast(m); }, 400 + i * 900);
    });

    // 5. Toasts des badges débloqués
    var baseDelay = (data.completedMissions || []).length * 900 + 400;
    (data.newBadges || []).forEach(function (badge, i) {
      setTimeout(function () { showBadgeToast(badge); }, (data.levelUp ? 2400 : baseDelay) + i * 1200);
    });

    // 5. Streak pop
    var streakEl = document.querySelector('.streak-chip');
    if (streakEl) streakEl.classList.add('streak-pop');
  }

  function injectGamiPanel(data) {
    // Supprime un éventuel panel précédent
    var old = document.getElementById('gami-score-panel');
    if (old) old.remove();

    var xpGain  = data.xpGain || {};
    var prog    = data.progress || {};
    var pct     = Math.min(prog.pct || 0, 100);

    // Chips de détail XP
    var chips = '';
    if (xpGain.base)        chips += '<span class="gami-xp-chip">Score +'  + xpGain.base + '</span>';
    if (xpGain.perfect)     chips += '<span class="gami-xp-chip bonus">' + t('xp_perfect') + ' +' + xpGain.perfect + '</span>';
    if (xpGain.streakBonus) chips += '<span class="gami-xp-chip bonus">' + t('xp_streak_bonus') + ' +' + xpGain.streakBonus + '</span>';
    if (xpGain.daily)       chips += '<span class="gami-xp-chip bonus">' + t('xp_daily') + ' +' + xpGain.daily + '</span>';

    var panel = document.createElement('div');
    panel.id        = 'gami-score-panel';
    panel.className = 'gami-score-panel';
    panel.innerHTML =
      '<div class="gami-xp-row">' +
        '<span class="gami-xp-earned">+' + (xpGain.total || 0) + ' XP</span>' +
        '<div class="gami-xp-details">' + chips + '</div>' +
      '</div>' +
      '<div class="gami-level-row">' +
        '<div class="level-badge" id="gami-lv-badge">' + t('gami_lv') + ' ' + data.level + '</div>' +
        '<div class="gami-level-info">' +
          '<div class="gami-level-label">' + t('gami_level_label').replace('{level}', data.level).replace('{streak}', data.streak) + '</div>' +
          '<div class="xp-bar-wrap"><div class="xp-bar-fill" id="gami-xp-fill" style="width:0%"></div></div>' +
          '<div class="gami-level-sub">' + (prog.current || 0) + ' / ' + (prog.needed || 100) + ' XP</div>' +
        '</div>' +
      '</div>' +
      (data.motivational ? '<div class="gami-motivational">' + esc(data.motivational) + '</div>' : '') +
      '<a class="engage-cta" href="#" id="engage-cta-btn">' +
        '<div class="engage-cta-text">' +
          '<strong>' + t('gami_cta_strong') + '</strong>' +
          '<span>' + t('gami_streak_msg') + '</span>' +
        '</div>' +
        '<span class="engage-cta-arrow">→</span>' +
      '</a>';

    quizScore.appendChild(panel);

    // Anime la barre XP après insertion
    setTimeout(function () {
      var fill = document.getElementById('gami-xp-fill');
      if (fill) fill.style.width = pct + '%';
    }, 120);

    // Clic sur CTA → retour à l'input
    var cta = document.getElementById('engage-cta-btn');
    if (cta) cta.addEventListener('click', function (e) {
      e.preventDefault();
      resetToInput();
    });
  }

  // Noms de niveaux — tableau indexé par niveau (1-based)
  function _getLevelName(n) {
    try {
      var names = JSON.parse(t('level_names'));
      return names[Math.min(n, names.length - 1)] || t('level_up_tag');
    } catch (_) {
      var fallback = ['', 'Novice', 'Débutant', 'Apprenti', 'Étudiant', 'Explorateur', 'Avancé', 'Expert', 'Maître', 'Champion', 'Légende'];
      return fallback[Math.min(n, fallback.length - 1)] || 'Expert';
    }
  }

  // Confettis CSS purs — utilise .confetti-particle défini dans premium.css
  function _spawnConfetti() {
    var COLORS = ['#8b5cf6','#06b6d4','#f59e0b','#10b981','#ef4444','#ec4899','#ffffff'];
    for (var i = 0; i < 48; i++) {
      (function (idx) {
        setTimeout(function () {
          var p  = document.createElement('div');
          p.className = 'confetti-particle';
          var x   = (Math.random() * 80 + 10).toFixed(1);    // 10-90 vw
          var dx  = ((Math.random() - 0.5) * 240).toFixed(0);
          var dy  = (-(Math.random() * 220 + 80)).toFixed(0);
          var rot = ((Math.random() - 0.5) * 720).toFixed(0);
          var dur = (Math.random() * 0.55 + 0.75).toFixed(2);
          var sz  = (Math.random() * 7 + 6).toFixed(1);
          var col = COLORS[Math.floor(Math.random() * COLORS.length)];
          p.style.cssText = 'left:' + x + 'vw;top:52vh;width:' + sz + 'px;height:' +
            (parseFloat(sz) * 0.55).toFixed(1) + 'px;background:' + col +
            ';--dx:' + dx + 'px;--dy:' + dy + 'px;--rot:' + rot + 'deg;--dur:' + dur + 's';
          document.body.appendChild(p);
          setTimeout(function () { p.remove(); }, parseFloat(dur) * 1000 + 300);
        }, idx * 28);
      }(i));
    }
  }

  function showLevelUp(level) {
    window.SFX && SFX.levelup();
    _spawnConfetti();
    var levelName = _getLevelName(level);
    var overlay = document.createElement('div');
    overlay.className = 'level-up-overlay';
    overlay.innerHTML =
      '<div class="level-up-card">' +
        '<div class="level-up-tag">' + t('level_up_tag') + '</div>' +
        '<div class="level-up-num">' + level + '</div>' +
        '<div class="level-up-name">' + levelName + '</div>' +
        '<div class="level-up-title">' + t('level_up_msg').replace('{name}', '<strong>' + levelName + '</strong>') + '</div>' +
        '<div class="level-up-sub">' + t('level_up_sub') + '</div>' +
        '<button class="level-up-close" id="lv-close">' + t('level_up_close') + '</button>' +
      '</div>';
    document.body.appendChild(overlay);
    document.getElementById('lv-close').addEventListener('click', function () { overlay.remove(); });
    setTimeout(function () { overlay.remove(); }, 7000);
  }

  function showMissionToast(m) {
    var toast = document.createElement('div');
    toast.className = 'badge-toast mission-toast';
    toast.innerHTML =
      '<div class="badge-toast-icon">' + (m.icon || '🎯') + '</div>' +
      '<div class="badge-toast-body">' +
        '<div class="badge-toast-tag">' + t('mission_done') + '</div>' +
        '<div class="badge-toast-name">' + esc(m.label || '') + '</div>' +
        '<div class="badge-toast-desc">+' + (m.xp || 0) + ' XP bonus</div>' +
      '</div>';
    document.body.appendChild(toast);
    setTimeout(function () { toast.remove(); }, 3400);
  }

  function showBadgeToast(badge) {
    window.SFX && SFX.badge();
    var toast = document.createElement('div');
    toast.className = 'badge-toast';
    toast.innerHTML =
      '<div class="badge-toast-icon">' + (badge.icon || '🏅') + '</div>' +
      '<div class="badge-toast-body">' +
        '<div class="badge-toast-tag">' + t('badge_unlocked') + '</div>' +
        '<div class="badge-toast-name">' + esc(badge.name || '') + '</div>' +
        '<div class="badge-toast-desc">' + esc(badge.desc || '') + '</div>' +
      '</div>';
    document.body.appendChild(toast);
    setTimeout(function () { toast.remove(); }, 3400);
  }

  // ============================================================
  //  QUIZ DE CONSOLIDATION
  // ============================================================

  window.startConsolidation = async function () {
    if (state.wrongQuestions.length === 0) return;
    const btnConsolidate = document.getElementById('btn-consolidate');
    if (btnConsolidate) { btnConsolidate.disabled = true; btnConsolidate.textContent = t('loading_5'); }

    try {
      const res  = await fetch('/api/consolidation-quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wrongConcepts: state.wrongQuestions, topic: state.currentTopic }),
      });
      const data = await res.json();
      if (!res.ok || !Array.isArray(data.questions)) {
        showToast('❌ ' + (data.error || t('toast_server_error')), 'error');
        if (btnConsolidate) { btnConsolidate.disabled = false; btnConsolidate.textContent = t('quiz_consolidate', { n: state.wrongQuestions.length }); }
        return;
      }
      state.quizQuestions  = data.questions;
      state.wrongQuestions = [];
      state.currentContentId = null;
      startQuiz();
    } catch {
      showToast('❌ ' + t('toast_conn_error'), 'error');
      if (btnConsolidate) { btnConsolidate.disabled = false; btnConsolidate.textContent = t('quiz_consolidate', { n: state.wrongQuestions.length }); }
    }
  };

  // Chargement d'un item depuis l'historique
  window.loadFromHistory = function (item) {
    state.currentContentId = item.id;
    showResults(item);
  };

  // ============================================================
  //  NAVIGATION
  // ============================================================

  function showSection(name) {
    sectionInput.classList.toggle('hidden', name !== 'input');
    sectionLoading.classList.toggle('hidden', name !== 'loading');
    sectionResults.classList.toggle('hidden', name !== 'results');
    sectionQuiz.classList.toggle('hidden', name !== 'quiz');
  }

  function switchTab(name) {
    document.querySelectorAll('.tab').forEach(function (t) {
      t.classList.toggle('active', t.dataset.tab === name);
    });
    document.querySelectorAll('.tab-content').forEach(function (c) {
      const active = c.id === 'tab-' + name;
      c.classList.toggle('active', active);
      c.classList.toggle('hidden', !active);
    });
  }

  function resetToInput() {
    courseInput.value = '';
    charCount.textContent = t('char_count_of') !== 'char_count_of' ? t('char_count_of').replace('{n}', '0') : '0 / 20 000';
    btnGenerate.disabled = false;
    showSection('input');
    courseInput.focus();
  }

  // ============================================================
  //  COPIER
  // ============================================================

  window.copyText = function (id) {
    const el = document.getElementById(id);
    if (el) navigator.clipboard.writeText(el.textContent).then(function () {
      showToast('✓ ' + t('toast_summary_copied'), 'success');
    });
  };

  window.copyFlashcard = function () {
    const txt = state.flashcardData.map(function (p) { return '• ' + p; }).join('\n');
    navigator.clipboard.writeText(txt).then(function () {
      showToast('✓ ' + t('toast_card_copied'), 'success');
    });
  };

  // ============================================================
  //  USAGE / FREEMIUM
  // ============================================================

  async function refreshUsage() {
    if (!window.auth?.isLoggedIn()) return;
    try {
      const headers = {};
      if (state.premiumToken) headers['x-premium-token'] = state.premiumToken;
      const res  = await fetch('/api/usage', { headers });
      if (!res.ok) return;
      const data = await res.json();
      updateUsage(data.remaining, data.isPremium);
    } catch (_) {}
  }

  const usageCounter = document.getElementById('usage-counter');

  function updateUsage(remaining, isPremium) {
    if (!window.auth?.isLoggedIn()) {
      if (usageBadge)  usageBadge.classList.add('hidden');
      if (usageCounter) usageCounter.classList.add('hidden');
      return;
    }
    if (usageBadge) usageBadge.classList.remove('hidden');
    if (isPremium) {
      state.isPremium              = true;
      usageText.textContent        = t('usage_premium');
      usageText.style.color        = '';
      if (btnPremium) {
        btnPremium.textContent     = t('premium_active');
        btnPremium.style.opacity   = '0.6';
        btnPremium.style.cursor    = 'default';
        btnPremium.setAttribute('aria-disabled', 'true');
        btnPremium.title           = t('premium_already');
      }
      // Compteur sous le bouton
      if (usageCounter) {
        usageCounter.textContent = t('usage_premium');
        usageCounter.className   = 'usage-counter premium';
      }
    } else if (remaining !== null && remaining !== undefined) {
      const s = remaining > 1 ? 's' : '';
      usageText.textContent = t('usage_remaining', { n: remaining, s });
      usageText.style.color = remaining === 0 ? 'var(--error)' : '';
      // Compteur sous le bouton — couleur adaptée
      if (usageCounter) {
        usageCounter.classList.remove('hidden');
        usageCounter.textContent = t('usage_remaining', { n: remaining, s });
        usageCounter.className = 'usage-counter ' + (remaining === 0 ? 'empty' : remaining <= 2 ? 'low' : 'plenty');
      }
    }
  }

  // ============================================================
  //  MODAL PREMIUM — event wiring (logique définie au niveau module)
  // ============================================================
  (function () {
    if (!modalPremium) return;
    var card = modalPremium.querySelector('.modal-card');
    if (!card) return;
    modalPremium.addEventListener('click', function (e) {
      if (e.target === modalPremium) window.hidePremiumModal();
    });
    card.addEventListener('click', function (e) {
      e.stopPropagation();
      if (e.target.closest('.modal-close')) { window.hidePremiumModal(); return; }
      var btn = e.target.closest('.btn-checkout');
      if (btn && !btn.disabled) {
        var plan = btn.dataset.plan;
        if (plan) window.startCheckout(plan);
      }
    });
  }());

  // ── Waitlist modal — event wiring ─────────────────────────────
  (function () {
    var modal = document.getElementById('modal-waitlist');
    if (!modal) return;
    var card   = modal.querySelector('.modal-card');
    var form   = document.getElementById('wl-form');
    var closeBtn = document.getElementById('wl-close');

    // Overlay click → close
    modal.addEventListener('click', function (e) {
      if (e.target === modal) window.hideWaitlistModal();
    });

    // Stop clicks inside card from closing via overlay
    if (card) card.addEventListener('click', function (e) { e.stopPropagation(); });

    // Close button
    if (closeBtn) closeBtn.addEventListener('click', function () { window.hideWaitlistModal(); });

    // Escape key
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && _wlOpen) window.hideWaitlistModal();
    });

    // Form submit
    if (form) form.addEventListener('submit', function (e) {
      e.preventDefault();
      var emailEl = document.getElementById('wl-email');
      var btn     = document.getElementById('wl-submit');
      var msg     = document.getElementById('wl-message');
      var email   = emailEl ? emailEl.value.trim() : '';
      if (!email) return;
      if (btn) { btn.disabled = true; btn.textContent = '…'; }
      fetch('/api/beta/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email }),
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (form) form.style.display = 'none';
          if (msg) {
            msg.className = 'wl-message wl-success';
            msg.textContent = data.already
              ? (t('wl_already') || '✓ Tu es déjà sur la liste !')
              : (t('wl_thanks')  || '🎉 Merci ! Tu seras prévenu(e) au lancement.');
          }
          setTimeout(function () { window.hideWaitlistModal(); }, 3000);
        })
        .catch(function () {
          if (btn) { btn.disabled = false; btn.textContent = t('wl_btn') || "M'inscrire"; }
          if (msg) {
            msg.className = 'wl-message wl-error';
            msg.textContent = '❌ ' + (t('toast_conn_error') || 'Erreur réseau, réessaie.');
          }
        });
    });
  }());

  // ============================================================
  //  VÉRIFICATION PAIEMENT
  // ============================================================

  async function verifyPayment(sid) {
    try {
      const res  = await fetch('/api/verify-payment?session_id=' + sid);
      const data = await res.json();
      if (data.success && data.token) {
        state.premiumToken = data.token;
        localStorage.setItem('studyai_premium_token', data.token);
        showToast('🎉 ' + t('toast_premium_activated'), 'success');
        updateUsage(null, true);
      }
    } catch (_) {}
  }

  // ============================================================
  //  TOAST
  // ============================================================

  let toastTimer;
  function showToast(msg, type) {
    clearTimeout(toastTimer);
    toast.textContent  = msg;
    toast.className    = 'toast' + (type ? ' ' + type : '');
    toast.classList.remove('hidden');
    toastTimer = setTimeout(function () { toast.classList.add('hidden'); }, 4000);
  }

  // Expose showToast globalement pour les boutons onclick inline
  window.showToast = showToast;

  // ── FAQ accordéon ─────────────────────────────────────────────
  document.addEventListener('click', function (e) {
    var question = e.target.closest('.faq-question');
    if (!question) return;
    var item = question.closest('.faq-item');
    if (!item) return;
    var answer = item.querySelector('.faq-answer');
    if (!answer) return;
    var isOpen = item.classList.contains('open');

    // Ferme tous les autres
    document.querySelectorAll('.faq-item.open').forEach(function (other) {
      if (other === item) return;
      other.classList.remove('open');
      var otherAns = other.querySelector('.faq-answer');
      if (otherAns) otherAns.style.maxHeight = '0';
    });

    // Toggle l'item courant
    if (isOpen) {
      item.classList.remove('open');
      answer.style.maxHeight = '0';
    } else {
      item.classList.add('open');
      answer.style.maxHeight = answer.scrollHeight + 'px';
    }
  });

  // ── Exam Examples Grid ─────────────────────────────────────
  var _EXAM_SUBJECTS = [
    { key: 'history',        icon: '📜' },
    { key: 'philosophy',     icon: '🧠' },
    { key: 'literature',     icon: '📖' },
    { key: 'geography',      icon: '🌍' },
    { key: 'math',           icon: '📐' },
    { key: 'physics',        icon: '⚛️' },
    { key: 'chemistry',      icon: '🧪' },
    { key: 'biology',        icon: '🧬' },
    { key: 'economics',      icon: '📊' },
    { key: 'cs',             icon: '💻' },
    { key: 'law',            icon: '⚖️' },
    { key: 'medicine',       icon: '🏥' },
  ];

  function _renderExamExamples() {
    var grid = document.getElementById('exam-examples-grid');
    if (!grid) return;
    grid.innerHTML = '';
    _EXAM_SUBJECTS.forEach(function (subj) {
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'exam-example-card';

      var icon  = document.createElement('span');
      icon.className = 'exam-example-card-icon';
      icon.textContent = subj.icon;

      var title = document.createElement('span');
      title.className = 'exam-example-card-title';
      title.textContent = t('exam_ex_' + subj.key + '_title');

      var desc  = document.createElement('span');
      desc.className = 'exam-example-card-desc';
      desc.textContent = t('exam_ex_' + subj.key + '_desc');

      card.appendChild(icon);
      card.appendChild(title);
      card.appendChild(desc);

      card.addEventListener('click', function () {
        // Reset: remove active highlight from all cards, apply to this one
        grid.querySelectorAll('.exam-example-card').forEach(function (c) {
          c.classList.remove('exam-example-card--active');
        });
        card.classList.add('exam-example-card--active');

        if (_SUBJECTS[subj.key]) {
          // Subject has subtopics → open topic picker (74 subtopics system)
          // Clear any textarea pre-fill from a previous no-subtopics card
          if (courseInput) courseInput.value = '';
          _showTopicPicker(subj.key);
        } else {
          // No subtopics yet (philosophy, economics, cs, law, medicine)
          // Close pickers, switch to text tab (makes #imode-text visible), pre-fill textarea
          _hideTopicPicker();
          _hideModePicker();
          var textTab = document.getElementById('tab-text-mode');
          if (textTab) textTab.click();
          if (courseInput) {
            courseInput.value = t('exam_ex_' + subj.key + '_prompt');
            courseInput.dispatchEvent(new Event('input'));
            courseInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }
      });

      grid.appendChild(card);
    });
  }

  _renderExamExamples();
  document.addEventListener('langchange', _renderExamExamples);

  // ============================================================
  //  EXPORT PDF / ANKI / PARTAGE
  // ============================================================
  function _wireExportButtons() {
    var btnPdf   = document.getElementById('btn-export-pdf');
    var btnAnki  = document.getElementById('btn-export-anki');
    var btnShare = document.getElementById('btn-share-topic');

    if (btnPdf) btnPdf.onclick = function() { window.print(); };

    if (btnAnki) btnAnki.onclick = function() {
      if (!state.flashcardData || !state.flashcardData.length) return;
      var lines = state.flashcardData.map(function(card) {
        var parts = card.split(' — ');
        var front = parts[0] ? parts[0].trim() : card;
        var back  = parts.slice(1).join(' — ').trim() || card;
        return front + '\t' + back;
      });
      var blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
      var url  = URL.createObjectURL(blob);
      var a    = document.createElement('a');
      a.href   = url;
      a.download = 'studyai-flashcards.txt';
      a.click();
      URL.revokeObjectURL(url);
      showToast('🎴 ' + t('toast_anki_exported'), 'success');
    };

    if (btnShare) btnShare.onclick = function() {
      var topic = state.currentTopic || '';
      var url   = window.location.origin + '/?topic=' + encodeURIComponent(topic);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function() {
          showToast('🔗 ' + t('toast_share_copied'), 'success');
        });
      } else {
        window.prompt('Copie ce lien :', url);
      }
    };
  }

  // ============================================================
  //  TIMER QUIZ
  // ============================================================
  var _timerInterval = null;
  var _timerSeconds  = 0;

  function _startTimer() {
    _timerSeconds = 0;
    var el = document.getElementById('quiz-timer');
    var val = document.getElementById('quiz-timer-val');
    if (!el || !val) return;
    el.classList.remove('hidden', 'warning');
    clearInterval(_timerInterval);
    _timerInterval = setInterval(function() {
      _timerSeconds++;
      var m = Math.floor(_timerSeconds / 60);
      var s = _timerSeconds % 60;
      if (val) val.textContent = m + ':' + (s < 10 ? '0' : '') + s;
      if (el && _timerSeconds > 60) el.classList.add('warning');
    }, 1000);
  }

  function _stopTimer() {
    clearInterval(_timerInterval);
    var el = document.getElementById('quiz-timer');
    if (el) el.classList.add('hidden');
  }

  // Patch startQuiz et fin de quiz pour le timer
  var _origStartQuiz = window._startQuizInternal;

  // ============================================================
  //  SURPRISE QUIZ
  // ============================================================
  window.startSurpriseQuiz = async function() {
    if (!window.auth?.isLoggedIn()) { window.showAuthModal && window.showAuthModal(); return; }
    var btn = document.getElementById('btn-surprise-quiz');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Chargement…'; }
    try {
      var res  = await fetch('/api/surprise-quiz', { headers: { 'x-auth-token': window.auth.token } });
      var data = await res.json();
      if (!res.ok || !data.questions?.length) {
        showToast('❌ ' + (data.error || 'Pas assez de questions sauvegardées'), 'error');
        if (btn) { btn.disabled = false; btn.textContent = '🎲 Interro surprise'; }
        return;
      }
      // Lance le quiz avec les questions récupérées
      state.quizQuestions    = data.questions;
      state.currentQuestion  = 0;
      state.score            = 0;
      state.wrongQuestions   = [];
      state.correctByDifficulty = {};
      state.currentContentId = null; // pas de sauvegarde pour le surprise quiz
      showToast('🎲 ' + data.picked + ' questions depuis ' + data.total + ' au total !', 'success');
      showSection('quiz');
      quizScore.classList.add('hidden');
      showQuestion(0);
      _startTimer();
    } catch(e) {
      showToast('❌ Erreur réseau', 'error');
    }
    if (btn) { btn.disabled = false; btn.textContent = '🎲 Interro surprise'; }
  };

  // ────────────────────────────────────────────────────────────

}); // fin DOMContentLoaded

// ============================================================
//  ANTI-ABUSE QUOTA UI (anonymous users only)
// ============================================================
(function () {
  'use strict';

  const MAX_GEN  = 5;
  let _lastRemaining = MAX_GEN; // cache — évite le fetch réseau au langchange
  let _lastResetAt   = null;    // cache pour le texte de réinitialisation modal

  // Build a stable fingerprint from the existing window._fpSignals (fingerprint.js)
  // Augmented with screen/timezone signals for uniqueness
  async function getDeviceFingerprint() {
    const signals = window._fpSignals || {};
    const parts   = [
      signals['x-canvas-hash'] || '',
      signals['x-webgl-hash']  || '',
      signals['x-audio-hash']  || '',
      String(screen.width),
      String(screen.height),
      String(screen.colorDepth),
      Intl.DateTimeFormat().resolvedOptions().timeZone || '',
      navigator.language || '',
      navigator.hardwareConcurrency || '',
    ];
    const raw  = parts.join('|');
    const buf  = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 64);
  }

  // Expose globally for app.js fetch header
  window._getDeviceFingerprint = getDeviceFingerprint;

  // ── Banner ──────────────────────────────────────────────────
  const banner     = document.getElementById('quota-banner');
  const bannerText = document.getElementById('quota-banner-text');
  const bannerCta  = document.getElementById('quota-banner-cta');

  function showBanner(remaining) {
    if (!banner || !bannerText) return;
    if (window.auth?.isLoggedIn()) { banner.hidden = true; return; }
    _lastRemaining = remaining;
    const _t = window.i18n?.t || function(k) { return k; };
    bannerText.textContent = remaining === 0
      ? _t('quota_banner_empty',     { n: 0,         max: MAX_GEN })
      : _t('quota_banner_remaining', { n: remaining, max: MAX_GEN });
    banner.hidden = false;
  }

  if (bannerCta) {
    bannerCta.addEventListener('click', function (e) {
      e.preventDefault();
      const loginBtn = document.getElementById('btn-login') || document.querySelector('[data-action="login"]');
      if (loginBtn) loginBtn.click();
    });
  }

  // ── Modal ──────────────────────────────────────────────────
  const overlay       = document.getElementById('quota-modal-overlay');
  const modalBody     = document.getElementById('quota-modal-body');
  const modalReset    = document.getElementById('quota-modal-reset');
  const btnSignup     = document.getElementById('quota-modal-signup');
  const btnPremium    = document.getElementById('quota-modal-premium');
  const btnClose      = document.getElementById('quota-modal-close');

  function showModal(data) {
    if (!overlay) return;
    _lastResetAt = data?.resetAt || null;
    _renderModalReset();
    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function _renderModalReset() {
    if (!modalReset) return;
    const _t = window.i18n?.t || function(k) { return k; };
    if (_lastResetAt) {
      const delta = Math.max(0, _lastResetAt - Date.now());
      const h     = Math.floor(delta / 3600000);
      const m     = Math.floor((delta % 3600000) / 60000);
      modalReset.textContent = _t('quota_modal_reset', { h, m });
    } else {
      modalReset.textContent = '';
    }
  }

  function hideModal() {
    if (!overlay) return;
    overlay.hidden = true;
    document.body.style.overflow = '';
  }

  if (btnClose)   btnClose.addEventListener('click', hideModal);
  if (overlay)    overlay.addEventListener('click', function (e) { if (e.target === overlay) hideModal(); });

  if (btnSignup) {
    btnSignup.addEventListener('click', function () {
      hideModal();
      const loginBtn = document.getElementById('btn-login') || document.querySelector('[data-action="login"]');
      if (loginBtn) loginBtn.click();
    });
  }

  if (btnPremium) {
    btnPremium.addEventListener('click', function () {
      hideModal();
      if (window.showPremiumModal) window.showPremiumModal();
    });
  }

  // Expose for use in generate error handler
  window._quotaUI = { showModal, showBanner };

  // Re-render banner + modal-reset synchronously on lang change (no fetch)
  document.addEventListener('langchange', function () {
    if (!window.auth?.isLoggedIn()) {
      if (banner && !banner.hidden) showBanner(_lastRemaining);
    }
    if (overlay && !overlay.hidden) _renderModalReset();
  });

  // ── Init: fetch quota on load (anonymous only) ─────────────
  async function refreshQuota() {
    if (window.auth?.isLoggedIn()) { if (banner) banner.hidden = true; return; }
    try {
      const fp  = await getDeviceFingerprint();
      const res = await fetch('/api/quota', { headers: { 'X-Device-Fingerprint': fp } });
      if (!res.ok) return;
      const data = await res.json();
      if (data.anonymous) showBanner(data.remaining ?? MAX_GEN);
    } catch {}
  }

  // Wait for fingerprint.js to collect signals before refreshing
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(refreshQuota, 500); });
  } else {
    setTimeout(refreshQuota, 500);
  }
})();
