// StudyAI — Auto Study Engine Frontend
// ============================================================
(function () {
  'use strict';

  // ── State ────────────────────────────────────────────────────
  var state = {
    file: null, mode: 'standard', jobId: null,
    result: null, pollTimer: null,
    quizAnswers: {}, quizRevealed: {},
    fcIndex: 0, fcCards: [],
  };

  var _ss = window.safeStore || {
    get: function (k, fb) { try { var v = localStorage.getItem(k); return v === null ? fb : v; } catch { return fb; } },
  };
  var AUTH_TOKEN = _ss.get('studyai_auth_token', null) || _ss.get('token', null) || '';

  // ── i18n helper ──────────────────────────────────────────────
  function _t(key, fallback) {
    if (window.i18n && window.i18n.t) {
      var v = window.i18n.t(key);
      return (v && v !== key) ? v : (fallback || key);
    }
    return fallback || key;
  }

  // ── DOM references ───────────────────────────────────────────
  var $ = function (id) { return document.getElementById(id); };

  // ── Mode selector ────────────────────────────────────────────
  document.querySelectorAll('.mode-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.mode-btn').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      state.mode = btn.dataset.mode;
    });
  });

  // ── Input mode tabs (Fichier / YouTube / Photo) ─────────────
  var _uploadZones = {
    file:    ['upload-zone', 'file-preview', 'btn-analyze-file'],
    youtube: ['yt-upload-wrap'],
    photo:   ['photo-upload-wrap'],
  };

  function _switchUploadMode(mode) {
    // Hide all zones
    ['upload-zone', 'yt-upload-wrap', 'photo-upload-wrap', 'file-preview', 'btn-analyze-file', 'paste-area'].forEach(hide);
    // Show target zones
    (_uploadZones[mode] || []).forEach(show);
    document.querySelectorAll('.input-mode-btn').forEach(function (b) {
      b.classList.toggle('active', b.dataset.umode === mode);
    });
  }

  document.querySelectorAll('.input-mode-btn').forEach(function (btn) {
    btn.addEventListener('click', function () { _switchUploadMode(btn.dataset.umode); });
  });

  // ── YouTube analyze ──────────────────────────────────────────
  var ytAnalyzeBtn = $('btn-analyze-yt');
  if (ytAnalyzeBtn) {
    ytAnalyzeBtn.addEventListener('click', async function () {
      var url = ($('yt-upload-url')?.value || '').trim();
      if (!url) { flash(_t('up_err_yt_url', 'Colle une URL YouTube valide.')); return; }
      ytAnalyzeBtn.disabled = true;
      ytAnalyzeBtn.querySelector('.btn-label').textContent = _t('up_yt_fetching', '⏳ Récupération du transcript…');
      try {
        var headers = {};
        if (AUTH_TOKEN) headers['Authorization'] = 'Bearer ' + AUTH_TOKEN;
        var r = await fetch('/api/youtube-transcript?url=' + encodeURIComponent(url), { headers: headers });
        var d = await r.json();
        if (!r.ok) throw new Error(d.error || _t('up_err_unknown', 'Erreur inconnue'));
        if (!d.transcript) throw new Error(_t('up_err_unknown', 'Transcript vide.'));
        startAnalysis({ text: d.transcript, filename: 'youtube-' + (d.videoId || 'video') + '.txt', mimeType: 'text/plain' });
      } catch (err) {
        flash('❌ ' + err.message);
        ytAnalyzeBtn.disabled = false;
        ytAnalyzeBtn.querySelector('.btn-label').textContent = _t('up_yt_analyze_label', '🎬 Analyser la vidéo');
      }
    });
  }

  // ── Photo / Vision ────────────────────────────────────────────
  var photoInput = $('photo-file-input');
  if (photoInput) {
    $('btn-browse-photo').addEventListener('click', function () { photoInput.click(); });
    $('photo-drop-label').addEventListener('click', function (e) {
      if (e.target.tagName !== 'BUTTON') photoInput.click();
    });
    photoInput.addEventListener('change', function () {
      var file = this.files[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) { flash(_t('up_err_img_size', 'Image trop grande (max 10 Mo).')); return; }
      var reader = new FileReader();
      reader.onload = function (e) {
        $('photo-preview-img').src = e.target.result;
        $('photo-preview-name').textContent = file.name;
        show('photo-preview-wrap');
      };
      reader.readAsDataURL(file);
    });
    var photoAnalyzeBtn = $('btn-analyze-photo');
    if (photoAnalyzeBtn) {
      photoAnalyzeBtn.addEventListener('click', async function () {
        var file = photoInput.files[0];
        if (!file) { flash(_t('up_err_no_photo', 'Sélectionne d\'abord une photo.')); return; }
        photoAnalyzeBtn.disabled = true;
        photoAnalyzeBtn.querySelector('.btn-label').textContent = _t('up_ocr_loading', '⏳ Analyse OCR en cours…');
        try {
          var formData = new FormData();
          formData.append('image', file);
          var headers = {};
          if (AUTH_TOKEN) headers['Authorization'] = 'Bearer ' + AUTH_TOKEN;
          var r = await fetch('/api/vision', { method: 'POST', headers: headers, body: formData });
          var d = await r.json();
          if (!r.ok) throw new Error(d.error || _t('up_err_unknown', 'Erreur inconnue'));
          if (!d.text) throw new Error(_t('up_err_unknown', 'Aucun texte détecté.'));
          startAnalysis({ text: d.text, filename: file.name, mimeType: 'text/plain' });
        } catch (err) {
          flash('❌ ' + err.message);
          photoAnalyzeBtn.disabled = false;
          photoAnalyzeBtn.querySelector('.btn-label').textContent = _t('up_photo_analyze_label', '📸 Analyser la photo');
        }
      });
    }
  }

  // ── Upload zone drag & drop ───────────────────────────────────
  var zone = $('upload-zone');
  zone.addEventListener('dragover',  function (e) { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', function ()  { zone.classList.remove('drag-over'); });
  zone.addEventListener('drop', function (e) {
    e.preventDefault(); zone.classList.remove('drag-over');
    var files = e.dataTransfer.files;
    if (files.length) handleFile(files[0]);
  });
  zone.addEventListener('click', function (e) {
    if (e.target.closest('#btn-browse, #btn-paste-toggle')) return;
    $('file-input').click();
  });
  zone.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('file-input').click(); }
  });

  $('btn-browse').addEventListener('click', function (e) {
    e.stopPropagation(); $('file-input').click();
  });

  $('file-input').addEventListener('change', function () {
    if (this.files.length) handleFile(this.files[0]);
  });

  // ── Paste mode ───────────────────────────────────────────────
  $('btn-paste-toggle').addEventListener('click', function (e) {
    e.stopPropagation();
    show('paste-area'); hide('upload-zone');
    $('text-input').focus();
  });
  $('btn-paste-close').addEventListener('click', function () {
    show('upload-zone'); hide('paste-area');
  });

  var _updateCharCount = function () {
    var len = $('text-input').value.length;
    var lang = (window.i18n && window.i18n.currentLang) || 'fr';
    var tpl = _t('up_chars_count', '{n} caractères');
    $('char-count').textContent = tpl.replace('{n}', len.toLocaleString(lang));
  };
  $('text-input').addEventListener('input',
    window.debounce ? window.debounce(_updateCharCount, 80) : _updateCharCount
  );

  $('btn-analyze-text').addEventListener('click', function () {
    var text = $('text-input').value.trim();
    if (!text || text.length < 50) {
      flash(_t('up_err_text_short', 'Texte trop court — colle au moins quelques paragraphes.')); return;
    }
    startAnalysis({ text: text });
  });

  // ── File handling ────────────────────────────────────────────
  function handleFile(file) {
    if (file.size > 20 * 1024 * 1024) { flash(_t('up_err_file_size', 'Fichier trop volumineux (max 20 Mo).')); return; }
    state.file = file;
    var ext = file.name.split('.').pop().toLowerCase();
    var iconMap = { pdf: '📕', txt: '📄', md: '📝', docx: '📘', html: '🌐' };
    $('preview-icon').textContent = iconMap[ext] || '📄';
    $('preview-name').textContent = file.name;
    $('preview-size').textContent = formatBytes(file.size);
    hide('upload-zone');
    show('file-preview');
    show('btn-analyze-file');
  }

  $('btn-remove-file').addEventListener('click', function () {
    state.file = null;
    $('file-input').value = '';
    show('upload-zone');
    hide('file-preview');
    hide('btn-analyze-file');
  });

  $('btn-analyze-file').addEventListener('click', function () {
    if (!state.file) return;
    readAndAnalyze(state.file);
  });

  function readAndAnalyze(file) {
    var reader = new FileReader();
    reader.onload = function (e) {
      var ext = file.name.split('.').pop().toLowerCase();
      if (ext === 'txt' || ext === 'md' || ext === 'html' || ext === 'htm') {
        startAnalysis({ text: e.target.result, filename: file.name, mimeType: file.type || 'text/plain' });
      } else {
        // Binary file (PDF etc) — send as base64
        var b64 = arrayBufferToBase64(e.target.result);
        startAnalysis({ base64: b64, filename: file.name, mimeType: file.type || 'application/octet-stream' });
      }
    };
    if (file.name.split('.').pop().toLowerCase() === 'pdf') {
      reader.readAsArrayBuffer(file);
    } else {
      reader.readAsText(file, 'UTF-8');
    }
  }

  function arrayBufferToBase64(buffer) {
    var bytes = new Uint8Array(buffer);
    var binary = '';
    for (var i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  // ── Start analysis ────────────────────────────────────────────
  async function startAnalysis(payload) {
    try {
      showSection('section-progress');
      setProgress(5, _t('up_progress_send', 'Envoi du contenu…'));

      var body = Object.assign({ mode: state.mode }, payload);
      var headers = { 'Content-Type': 'application/json' };
      if (AUTH_TOKEN) headers['Authorization'] = 'Bearer ' + AUTH_TOKEN;

      var res = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        var err = await res.json();
        throw new Error(err.error || _t('up_err_unknown', 'Erreur serveur'));
      }

      var data = await res.json();
      state.jobId = data.jobId;
      startPolling();

    } catch (err) {
      showSection('section-upload');
      flash('Erreur : ' + err.message);
    }
  }

  // ── Polling ───────────────────────────────────────────────────
  var POLL_INTERVAL = 1800;
  function startPolling() {
    clearInterval(state.pollTimer);
    state.pollTimer = setInterval(poll, POLL_INTERVAL);
    poll();
  }

  var _pollErrors = 0;
  async function poll() {
    try {
      var res  = await fetch('/api/ai/job/' + state.jobId);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();
      _pollErrors = 0;
      setProgress(data.progress || 0, data.progressLabel || _t('up_err_unknown', 'Traitement…'));
      updateProgressSteps(data.progress || 0);

      if (data.status === 'done') {
        clearInterval(state.pollTimer);
        var rRes  = await fetch('/api/ai/job/' + state.jobId + '/result', {
          headers: AUTH_TOKEN ? { Authorization: 'Bearer ' + AUTH_TOKEN } : {},
        });
        if (!rRes.ok) throw new Error('HTTP ' + rRes.status);
        var rData = await rRes.json();
        state.result = rData.result;
        renderResults(state.result);
        showSection('section-results');
      } else if (data.status === 'failed') {
        clearInterval(state.pollTimer);
        showSection('section-upload');
        flash('❌ ' + (data.error || _t('up_err_unknown', 'Erreur inconnue')));
      }
    } catch (err) {
      _pollErrors++;
      if (_pollErrors >= 4) {
        clearInterval(state.pollTimer);
        showSection('section-upload');
        flash('❌ ' + _t('up_err_unknown', 'Erreur réseau. Réessaie.'));
      }
    }
  }

  // ── Progress UI ───────────────────────────────────────────────
  function setProgress(pct, label) {
    $('progress-bar').style.width = Math.max(0, Math.min(100, pct)) + '%';
    $('progress-pct').textContent = Math.round(pct) + '%';
    $('progress-label').textContent = label || '';
    rotateTip(pct);
  }

  var TIPS_FR = [
    '💡 Notre IA analyse la structure hiérarchique de ton cours.',
    '🧠 Les flashcards sont optimisées pour la répétition espacée (algorithme SM-2).',
    '🎯 Les questions de quiz sont progressives : facile → difficile.',
    '📊 Le score de difficulté est calculé à partir de la densité conceptuelle.',
    '⚡ Après le pack, lance un duel quiz avec un(e) ami(e) !',
    '🗺️ La roadmap est personnalisée selon la durée estimée de maîtrise.',
    '🔥 Les pièges détectés viennent des erreurs les plus fréquentes des étudiants.',
    '💡 Ton profil d\'apprentissage s\'améliore à chaque session.',
  ];
  function _getTips() { return TIPS_FR; }
  var TIPS = TIPS_FR;
  var lastTipPct = -1;
  function rotateTip(pct) {
    if (pct - lastTipPct < 15) return;
    lastTipPct = pct;
    var tips = _getTips();
    var tip = tips[Math.floor(pct / (100 / tips.length)) % tips.length];
    var el = $('progress-tip');
    el.style.opacity = '0';
    setTimeout(function () { el.textContent = tip; el.style.opacity = '1'; }, 200);
  }

  function updateProgressSteps(pct) {
    var steps = [
      { id: 'step-parse',   min: 5  },
      { id: 'step-summary', min: 18 },
      { id: 'step-quiz',    min: 35 },
      { id: 'step-flash',   min: 52 },
      { id: 'step-concepts',min: 68 },
      { id: 'step-done',    min: 95 },
    ];
    steps.forEach(function (s) {
      var el = $(s.id);
      if (!el) return;
      el.classList.remove('active', 'complete');
      if (pct >= s.min + 15) el.classList.add('complete');
      else if (pct >= s.min)  el.classList.add('active');
    });
  }

  // ── Render results ────────────────────────────────────────────
  function renderResults(r) {
    if (!r) return;

    // Header
    $('res-title').textContent   = r.title || _t('up_results_title', 'Pack d\'étude');
    $('res-subject').textContent = r.subject || '';
    $('res-level').textContent   = r.level || '';
    $('res-time').textContent    = r.studyTimeMin ? '⏱️ ' + r.studyTimeMin + ' min' : '';

    // Difficulty
    var diff = r.difficultyScore || 50;
    $('diff-value').textContent     = diff + '/100';
    setTimeout(function () { $('diff-fill').style.width = diff + '%'; }, 300);

    // Brain links
    if (r._brainLinks && r._brainLinks.length) {
      var bl = $('brain-links');
      bl.innerHTML = '<p class="brain-links-title">' + esc(_t('up_brain_links_title','🧠 Connexions avec tes cours précédents')) + '</p>' +
        r._brainLinks.map(function (l) {
          return '<p class="brain-link-item">Tu as déjà étudié <strong>' + esc(l.concept) + '</strong> dans <em>' + esc(l.seenIn || _t('up_brain_prev_course','un cours précédent')) + '</em> (' + esc(l.subject || '') + ')</p>';
        }).join('');
      bl.classList.remove('hidden');
    }

    // Render all tabs
    renderSummary(r.summary);
    renderQuiz(r.quiz);
    renderFlashcards(r.flashcards, r.memo);
    renderMemo(r.memo);
    renderConcepts(r.concepts, r.traps, r.examQuestions);
    renderRoadmap(r.roadmap, r.mastery);

    // Tab switching
    document.querySelectorAll('.res-tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        document.querySelectorAll('.res-tab').forEach(function (t) { t.classList.remove('active'); });
        document.querySelectorAll('.res-tab-content').forEach(function (c) { c.classList.add('hidden'); });
        tab.classList.add('active');
        $('tab-' + tab.dataset.tab).classList.remove('hidden');
      });
    });

    // Action buttons
    $('btn-new-study').onclick = function () { location.href = '/upload'; };
    $('btn-regen').onclick     = regenAll;
    $('btn-exam').onclick      = startExam;
    $('btn-battle').onclick    = createBattle;
  }

  // Summary
  function renderSummary(s) {
    if (!s) return;
    $('sum-executive').textContent = s.executive || '';
    var sec = $('sum-sections');
    sec.innerHTML = (s.sections || []).map(function (section) {
      return '<div class="summary-section">' +
        '<div class="summary-section-header">' +
        '<span class="summary-section-icon">' + esc(section.icon || '📌') + '</span>' +
        '<span class="summary-section-title">' + esc(section.title || '') + '</span>' +
        '</div>' +
        '<p class="summary-section-body">' + esc(section.content || '') + '</p>' +
        '<div class="summary-kp-list">' +
        (section.key_points || []).map(function (p) {
          return '<div class="summary-kp"><div class="kp-dot"></div><span>' + esc(p) + '</span></div>';
        }).join('') + '</div></div>';
    }).join('');

    $('sum-formulas').innerHTML = (s.formulas || []).map(function (f) {
      return '<div class="formula-item">' +
        '<div class="formula-label">' + esc(f.label || '') + '</div>' +
        '<div class="formula-value">' + esc(f.formula || f) + '</div>' +
        (f.usage ? '<div class="formula-usage">' + esc(f.usage) + '</div>' : '') +
        '</div>';
    }).join('');
    if (!s.formulas || !s.formulas.length) $('sum-formulas-col').style.display = 'none';

    $('sum-vocab').innerHTML = (s.vocabulary || []).map(function (v) {
      return '<div class="vocab-item">' +
        '<div class="vocab-term">' + esc(v.term || '') + '</div>' +
        '<div class="vocab-def">' + esc(v.definition || '') + '</div>' +
        (v.example ? '<div class="vocab-ex">' + esc(v.example) + '</div>' : '') +
        '</div>';
    }).join('');
    if (!s.vocabulary || !s.vocabulary.length) $('sum-vocab-col').style.display = 'none';

    if (s.mindMap && s.mindMap.root) {
      // Keep summary text badges as fallback
      $('sum-mindmap').innerHTML =
        '<div class="mindmap-card"><div class="mindmap-title">🗺️ Mind Map</div>' +
        '<div class="mindmap-root">' + esc(s.mindMap.root) + '</div>' +
        '<div class="mindmap-branches">' +
        (s.mindMap.branches || []).map(function (b) {
          return '<span class="mindmap-branch">' + esc(b) + '</span>';
        }).join('') + '</div></div>';

      // Render interactive canvas mind map in its own tab
      setTimeout(function () {
        var canvas = $('mindmap-canvas');
        if (canvas && window.StudyMindMap) {
          window.StudyMindMap(canvas, s.mindMap);
        }
      }, 100);
    }
  }

  // Quiz
  function renderQuiz(q) {
    if (!q || !q.questions || !q.questions.length) return;
    var total = q.questions.length;
    $('quiz-info').textContent = total + ' questions · Mode ' + (state.result?.mode || 'standard');
    var html = q.questions.map(function (qu, i) {
      var diffClass = 'diff-' + (qu.difficulty || 'medium');
      var diffLabel = { easy: _t('up_diff_easy','Facile'), medium: _t('up_diff_medium','Moyen'), hard: _t('up_diff_hard','Difficile') }[qu.difficulty] || qu.difficulty;
      var optionsHtml = '';
      if (qu.type === 'mcq' && qu.options) {
        optionsHtml = '<div class="quiz-options">' +
          qu.options.map(function (opt) {
            var letter = opt.charAt(0);
            return '<button class="quiz-opt" data-qi="' + i + '" data-ans="' + esc(letter) + '">' + esc(opt) + '</button>';
          }).join('') + '</div>';
      } else if (qu.type === 'truefalse') {
        optionsHtml = '<div class="quiz-options">' +
          '<button class="quiz-opt" data-qi="' + i + '" data-ans="true">' + esc(_t('up_quiz_true','✓ Vrai')) + '</button>' +
          '<button class="quiz-opt" data-qi="' + i + '" data-ans="false">' + esc(_t('up_quiz_false','✗ Faux')) + '</button>' +
          '</div>';
      } else if (qu.type === 'open') {
        optionsHtml = '<p class="quiz-expl" style="font-style:italic;color:var(--text-subtle)">📝 Question ouverte : ' + esc(qu.answer_guide || '') + '</p>';
      }
      return '<div class="quiz-q-card" id="qcard-' + i + '">' +
        '<div class="quiz-q-header">' +
        '<span class="quiz-q-num">Q' + (i + 1) + '</span>' +
        '<span class="quiz-q-diff ' + diffClass + '">' + esc(diffLabel) + '</span>' +
        '<span style="font-size:0.75rem;color:var(--text-subtle);margin-left:auto">' + esc(qu.concept || '') + '</span>' +
        '</div>' +
        '<p class="quiz-q-text">' + esc(qu.question || '') + '</p>' +
        optionsHtml +
        '<div class="quiz-expl hidden" id="expl-' + i + '">' + esc(qu.explanation || '') + '</div>' +
        '</div>';
    }).join('');
    $('quiz-questions').innerHTML = html;

    // Quiz interaction
    document.querySelectorAll('.quiz-opt').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var qi  = parseInt(btn.dataset.qi);
        var ans = btn.dataset.ans;
        if (state.quizRevealed[qi]) return;
        state.quizAnswers[qi] = ans;
        state.quizRevealed[qi] = true;
        var qu = q.questions[qi];
        var correct = String(qu.correct).toLowerCase() === String(ans).toLowerCase();
        var card = $('qcard-' + qi);
        card.querySelectorAll('.quiz-opt').forEach(function (o) {
          o.disabled = true;
          var isCorrect = String(qu.correct).toLowerCase() === String(o.dataset.ans).toLowerCase();
          if (isCorrect) o.classList.add('correct');
          else if (o === btn && !correct) o.classList.add('wrong');
        });
        $('expl-' + qi).classList.remove('hidden');

        // Check if all answered
        if (Object.keys(state.quizRevealed).length === total) {
          var score = q.questions.filter(function (_, idx2) {
            return state.quizRevealed[idx2] && String(q.questions[idx2].correct).toLowerCase() === String(state.quizAnswers[idx2]).toLowerCase();
          }).length;
          var pct = Math.round(score / total * 100);
          var emoji = pct >= 90 ? '🏆' : pct >= 75 ? '⭐' : pct >= 60 ? '👍' : '📚';
          var msg   = pct >= 90 ? _t('up_score_excellent','Excellent !') : pct >= 75 ? _t('up_score_good','Très bien !') : pct >= 60 ? _t('up_score_ok','Pas mal !') : _t('up_score_keep','Continue !');
          var scoreEl = $('quiz-score');
          scoreEl.innerHTML =
            '<div class="quiz-score-emoji">' + emoji + '</div>' +
            '<div class="quiz-score-val">' + score + '/' + total + '</div>' +
            '<div class="quiz-score-label">' + pct + '% · ' + msg + '</div>';
          scoreEl.classList.remove('hidden');
          // Confetti on good score
          if (pct >= 70 && window.StudyConfetti) {
            setTimeout(function () { window.StudyConfetti.launch({ count: pct >= 90 ? 120 : 80 }); }, 300);
          }
        }
      });
    });
  }

  // Flashcards
  function renderFlashcards(cards, memo) {
    state.fcCards = cards || [];
    state.fcIndex = 0;
    renderFCCard();
    renderFCDots();
    $('fc-progress').textContent = state.fcCards.length ? '1 / ' + state.fcCards.length : '0 / 0';

    $('btn-fc-shuffle').onclick = function () {
      shuffle(state.fcCards);
      state.fcIndex = 0;
      renderFCCard();
      renderFCDots();
    };
    $('btn-fc-prev').onclick = function () { if (state.fcIndex > 0) { state.fcIndex--; renderFCCard(); renderFCDots(); } };
    $('btn-fc-next').onclick = function () { if (state.fcIndex < state.fcCards.length - 1) { state.fcIndex++; renderFCCard(); renderFCDots(); } };
  }

  function renderFCCard() {
    var c = state.fcCards[state.fcIndex];
    var stack = $('flashcard-stack');
    if (!c) { stack.innerHTML = '<p style="color:var(--text-subtle);text-align:center;padding:40px">' + esc(_t('up_fc_empty','Aucune flashcard disponible.')) + '</p>'; return; }
    stack.innerHTML =
      '<div class="flashcard" id="current-fc">' +
      '<div class="fc-face-label">' + esc(_t('up_fc_question','Question')) + '</div>' +
      '<div class="fc-front">' +
      '<p class="fc-question">' + esc(c.front || '') + '</p>' +
      '<p class="fc-flip-hint">' + esc(_t('up_fc_flip','Cliquer pour retourner')) + '</p>' +
      '</div>' +
      '<div class="fc-back">' +
      '<div class="fc-face-label">' + esc(_t('up_fc_answer_label','Réponse')) + '</div>' +
      '<p class="fc-answer">' + esc(c.back || '') + '</p>' +
      (c.hint ? '<p class="fc-hint">💡 ' + esc(c.hint) + '</p>' : '') +
      '<div class="fc-tags">' + (c.tags || []).map(function (t) { return '<span class="fc-tag">' + esc(t) + '</span>'; }).join('') + '</div>' +
      '</div>' +
      '</div>';
    document.getElementById('current-fc').addEventListener('click', function () {
      this.classList.toggle('flipped');
    });
    $('fc-progress').textContent = (state.fcIndex + 1) + ' / ' + state.fcCards.length;
  }

  function renderFCDots() {
    $('fc-dots').innerHTML = state.fcCards.slice(0, 10).map(function (_, i) {
      return '<div class="fc-dot' + (i === state.fcIndex ? ' active' : '') + '"></div>';
    }).join('');
  }

  // Memo
  function renderMemo(memo) {
    if (!memo) { $('memo-content').innerHTML = '<p style="color:var(--text-subtle)">' + esc(_t('up_memo_empty','Mémo non disponible.')) + '</p>'; return; }
    var html = '<div class="memo-header">' +
      '<h2 class="memo-title">' + esc(memo.title || 'Mémo Express') + '</h2>' +
      '<p class="memo-tagline">' + esc(memo.tagline || '') + '</p>' +
      '</div>' +
      (memo.sections || []).map(function (s) {
        return '<div class="memo-section">' +
          '<h3 class="memo-section-title">' + esc(s.title || '') + '</h3>' +
          '<ul class="memo-list">' + (s.items || []).map(function (it) { return '<li>' + esc(it) + '</li>'; }).join('') + '</ul>' +
          '</div>';
      }).join('') +
      (memo.exam_checklist && memo.exam_checklist.length ?
        '<div class="memo-section"><h3 class="memo-section-title">' + esc(_t('up_memo_checklist','✅ Checklist veille d\'examen')) + '</h3>' +
        '<ul class="memo-checklist">' + memo.exam_checklist.map(function (it) { return '<li>' + esc(it) + '</li>'; }).join('') + '</ul></div>'
        : '');
    $('memo-content').innerHTML = html;
  }

  // Concepts & traps
  function renderConcepts(concepts, traps, examQs) {
    $('concepts-list').innerHTML = (concepts || []).map(function (c) {
      var impClass = 'imp-' + (c.importance || 'medium');
      var impLabel = { high: _t('up_imp_high','🔴 Crucial'), medium: _t('up_imp_medium','🟡 Important'), low: _t('up_imp_low','🟢 Secondaire') }[c.importance] || c.importance;
      return '<div class="concept-card">' +
        '<div class="concept-header">' +
        '<span class="concept-name">' + esc(c.name || '') + '</span>' +
        '<span class="concept-imp ' + impClass + '">' + esc(impLabel) + '</span>' +
        '</div>' +
        '<p class="concept-def">' + esc(c.definition || '') + '</p>' +
        (c.real_world_example ? '<p class="concept-example">Exemple : ' + esc(c.real_world_example) + '</p>' : '') +
        (c.mastery_question ? '<p class="concept-check">❓ ' + esc(c.mastery_question) + '</p>' : '') +
        '</div>';
    }).join('');

    if (traps && traps.length) {
      $('traps-list').innerHTML = '<h3 class="traps-header">' + esc(_t('up_traps_header','⚠️ Pièges & erreurs fréquentes')) + '</h3>' +
        traps.map(function (t) {
          return '<div class="trap-card">' +
            '<p class="trap-text">❌ ' + esc(t.trap || '') + '</p>' +
            (t.why_common ? '<p class="trap-why">Pourquoi : ' + esc(t.why_common) + '</p>' : '') +
            '<p class="trap-fix">✅ ' + esc(t.correction || '') + '</p>' +
            (t.memory_tip ? '<p class="trap-tip">💡 ' + esc(t.memory_tip) + '</p>' : '') +
            '</div>';
        }).join('');
    }

    if (examQs && examQs.length) {
      $('exam-questions-list').innerHTML =
        '<h3 class="traps-header">' + esc(_t('up_exam_q_header','🎯 Questions probables d\'examen')) + '</h3>' +
        examQs.map(function (q) {
          return '<div class="exam-q-card">' +
            '<span class="exam-q-type">' + esc(q.type || '') + '</span>' +
            '<span class="exam-q-text">' + esc(q.question || '') + '</span>' +
            '</div>';
        }).join('');
    }
  }

  // Roadmap
  function renderRoadmap(roadmap, mastery) {
    if (roadmap && roadmap.sessions && roadmap.sessions.length) {
      $('roadmap-content').innerHTML =
        '<h3 class="roadmap-header">' + esc(_t('up_roadmap_header','🗺️ Plan de révision sur {n} jours').replace('{n}', roadmap.total_days || 7)) + '</h3>' +
        roadmap.sessions.map(function (s) {
          return '<div class="roadmap-day">' +
            '<div class="roadmap-day-num"><span class="roadmap-day-label">' + esc(_t('up_roadmap_day','Jour')) + '</span><span class="roadmap-day-n">' + s.day + '</span></div>' +
            '<div>' +
            '<p class="roadmap-day-title">' + esc(s.title || '') + '</p>' +
            '<p class="roadmap-day-meta">⏱️ ' + (s.duration_min || 30) + ' min · ' + esc(s.focus || '') + '</p>' +
            (s.activities || []).map(function (a) { return '<p class="roadmap-activity">' + esc(a) + '</p>'; }).join('') +
            (s.goal ? '<p class="roadmap-goal">🎯 ' + esc(s.goal) + '</p>' : '') +
            '</div></div>';
        }).join('');
    }

    if (mastery) {
      $('mastery-card').innerHTML =
        '<div class="mastery-card">' +
        '<p class="mastery-title">' + esc(_t('up_mastery_title','📊 Niveau de maîtrise estimé')) + '</p>' +
        '<div class="mastery-score-row">' +
        '<span class="mastery-score-val">' + (mastery.estimated_level || '?') + '%</span>' +
        '<div><p class="mastery-score-label">' + esc(_t('up_mastery_level','Premier contact')) + '</p></div>' +
        '</div>' +
        '<p class="mastery-time">⏳ ' + (mastery.time_to_master_hours || '?') + 'h</p>' +
        '<p class="mastery-rec">' + esc(mastery.recommendation || '') + '</p>' +
        '</div>';
    }
  }

  // ── Actions ───────────────────────────────────────────────────
  async function regenAll() {
    if (!state.jobId) return;
    showSection('section-upload');
    try {
      var res = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, AUTH_TOKEN ? { Authorization: 'Bearer ' + AUTH_TOKEN } : {}),
        body: JSON.stringify({ text: state.result?.summary?.executive || '', mode: state.mode }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      var data = await res.json();
      state.jobId = data.jobId;
      showSection('section-progress');
      startPolling();
    } catch (err) { flash('❌ ' + err.message); }
  }

  async function startExam() {
    if (!AUTH_TOKEN) { flash(_t('up_err_auth_exam', 'Connecte-toi pour accéder au simulateur d\'examen.')); return; }
    try {
      var res = await fetch('/api/ai/exam', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + AUTH_TOKEN },
        body: JSON.stringify({ jobId: state.jobId, config: { durationMin: 45, mode: state.mode } }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      var data = await res.json();
      // Redirect to exam page with examId
      location.href = '/exam?id=' + data.examId;
    } catch (err) { flash('Erreur : ' + err.message); }
  }

  async function createBattle() {
    if (!AUTH_TOKEN) { flash(_t('up_err_auth_battle', 'Connecte-toi pour créer un duel.')); return; }
    try {
      var res = await fetch('/api/ai/battle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + AUTH_TOKEN },
        body: JSON.stringify({ jobId: state.jobId }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      var data = await res.json();
      var url = location.origin + data.inviteUrl;
      if (navigator.clipboard) navigator.clipboard.writeText(url);
      flash(_t('up_battle_copied', 'Lien de duel copié ! 🎉 Partage : {url}').replace('{url}', url));
    } catch (err) { flash('Erreur : ' + err.message); }
  }

  // ── Utilities ─────────────────────────────────────────────────
  function show(id)  { $(id) && $(id).classList.remove('hidden'); }
  function hide(id)  { $(id) && $(id).classList.add('hidden'); }
  function showSection(id) {
    ['section-upload', 'section-progress', 'section-results'].forEach(hide);
    show(id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function formatBytes(b) {
    if (b < 1024) return b + ' o';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' Ko';
    return (b / 1024 / 1024).toFixed(1) + ' Mo';
  }
  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
  }
  var _flashTimer = null;
  function flash(msg) {
    var t = document.getElementById('toast') || document.createElement('div');
    if (!t.id) { t.id = 'toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.className = 'toast';
    t.classList.remove('hidden');
    clearTimeout(_flashTimer);
    _flashTimer = setTimeout(function () { t.classList.add('hidden'); }, 4000);
  }

  // ── Public API for workspace.js integration ──────────────────
  function restoreJob(jobId) {
    if (!jobId) return;
    state.jobId = jobId;
    showSection('section-progress');
    startPolling();
  }

  window._uploadAPI = { restoreJob };

  // ── Keyboard shortcuts ────────────────────────────────────────
  document.addEventListener('keydown', function (e) {
    // Ignore when typing in inputs
    if (['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    var activeTab = document.querySelector('.res-tab.active');
    if (!activeTab) return;
    var tab = activeTab.dataset.tab;

    if (tab === 'flashcards') {
      if (e.key === 'ArrowLeft')  { $('btn-fc-prev')?.click(); e.preventDefault(); }
      if (e.key === 'ArrowRight') { $('btn-fc-next')?.click(); e.preventDefault(); }
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('current-fc')?.click();
      }
    }

    if (tab === 'quiz') {
      var n = parseInt(e.key, 10);
      if (n >= 1 && n <= 4) {
        // Find the first unanswered question and click its nth option
        var cards = document.querySelectorAll('.quiz-q-card');
        for (var i = 0; i < cards.length; i++) {
          var opts = cards[i].querySelectorAll('.quiz-opt:not([disabled])');
          if (opts.length && opts[n - 1]) { opts[n - 1].click(); e.preventDefault(); break; }
        }
      }
    }
  });

  // ── Flashcard swipe gestures (mobile) ─────────────────────────
  (function () {
    var stack = $('flashcard-stack');
    if (!stack) return;
    var _tx = null;

    stack.addEventListener('touchstart', function (e) {
      _tx = e.touches[0].clientX;
    }, { passive: true });

    stack.addEventListener('touchend', function (e) {
      if (_tx === null) return;
      var dx = e.changedTouches[0].clientX - _tx;
      _tx = null;
      if (Math.abs(dx) < 50) return;
      if (dx < 0) $('btn-fc-next')?.click();
      else         $('btn-fc-prev')?.click();
    }, { passive: true });
  }());

  // ── Copy buttons (injected after render) ─────────────────────
  function _injectCopyBtn(targetId, getTextFn) {
    var el = $(targetId);
    if (!el || el.querySelector('.copy-btn')) return;
    var btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.title = _t('up_copy_title', 'Copier');
    btn.textContent = '📋';
    btn.addEventListener('click', function () {
      var text = getTextFn();
      if (!text) return;
      navigator.clipboard?.writeText(text).then(function () {
        btn.textContent = '✅';
        setTimeout(function () { btn.textContent = '📋'; }, 1800);
      });
    });
    el.style.position = 'relative';
    el.appendChild(btn);
  }

  // Called after renderResults to wire copy buttons
  function _wireCopyButtons(r) {
    _injectCopyBtn('sum-executive', function () { return $('sum-executive')?.innerText || ''; });
    _injectCopyBtn('memo-content',  function () { return $('memo-content')?.innerText || ''; });
  }

  // ── Confetti on high quiz score ───────────────────────────────
  function _maybeConfetti(scorePct) {
    if (scorePct >= 70 && window.StudyConfetti) {
      window.StudyConfetti.launch({ count: scorePct >= 90 ? 120 : 80 });
    }
  }

  // Patch quiz score reveal to trigger confetti
  var _origRenderQuiz = renderQuiz;
  // (confetti is triggered inside renderQuiz scoreEl block — patched below in-place)

  // ── Print / PDF export ────────────────────────────────────────
  function _setupPrint() {
    var btn = document.getElementById('btn-print');
    if (btn) btn.addEventListener('click', function () { window.print(); });
  }

  // Re-run setup after results render
  var _origRenderResults = renderResults;
  renderResults = function (r) {
    _origRenderResults(r);
    _wireCopyButtons(r);
    _setupPrint();
  };

  window.registerCleanup && window.registerCleanup(function () {
    clearInterval(state.pollTimer);
    clearTimeout(_flashTimer);
  });

})();
