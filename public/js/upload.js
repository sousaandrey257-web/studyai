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

  var AUTH_TOKEN = localStorage.getItem('studyai_auth_token') || localStorage.getItem('token') || '';

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

  $('text-input').addEventListener('input', function () {
    var len = this.value.length;
    $('char-count').textContent = len.toLocaleString('fr') + ' caractères';
  });

  $('btn-analyze-text').addEventListener('click', function () {
    var text = $('text-input').value.trim();
    if (!text || text.length < 50) {
      flash('Texte trop court — colle au moins quelques paragraphes.'); return;
    }
    startAnalysis({ text: text });
  });

  // ── File handling ────────────────────────────────────────────
  function handleFile(file) {
    if (file.size > 20 * 1024 * 1024) { flash('Fichier trop volumineux (max 20 Mo).'); return; }
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
      setProgress(5, 'Envoi du contenu…');

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
        throw new Error(err.error || 'Erreur serveur');
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

  async function poll() {
    try {
      var res  = await fetch('/api/ai/job/' + state.jobId);
      var data = await res.json();
      setProgress(data.progress || 0, data.progressLabel || 'Traitement…');
      updateProgressSteps(data.progress || 0);

      if (data.status === 'done') {
        clearInterval(state.pollTimer);
        // Fetch full result
        var rRes  = await fetch('/api/ai/job/' + state.jobId + '/result', {
          headers: AUTH_TOKEN ? { Authorization: 'Bearer ' + AUTH_TOKEN } : {},
        });
        var rData = await rRes.json();
        state.result = rData.result;
        renderResults(state.result);
        showSection('section-results');
      } else if (data.status === 'failed') {
        clearInterval(state.pollTimer);
        showSection('section-upload');
        flash('Génération échouée : ' + (data.error || 'Erreur inconnue'));
      }
    } catch {}
  }

  // ── Progress UI ───────────────────────────────────────────────
  function setProgress(pct, label) {
    $('progress-bar').style.width = Math.max(0, Math.min(100, pct)) + '%';
    $('progress-pct').textContent = Math.round(pct) + '%';
    $('progress-label').textContent = label || '';
    rotateTip(pct);
  }

  var TIPS = [
    '💡 Notre IA analyse la structure hiérarchique de ton cours.',
    '🧠 Les flashcards sont optimisées pour la répétition espacée (algorithme SM-2).',
    '🎯 Les questions de quiz sont progressives : facile → difficile.',
    '📊 Le score de difficulté est calculé à partir de la densité conceptuelle.',
    '⚡ Après le pack, lance un duel quiz avec un(e) ami(e) !',
    '🗺️ La roadmap est personnalisée selon la durée estimée de maîtrise.',
    '🔥 Les pièges détectés viennent des erreurs les plus fréquentes des étudiants.',
    '💡 Ton profil d\'apprentissage s\'améliore à chaque session.',
  ];
  var lastTipPct = -1;
  function rotateTip(pct) {
    if (pct - lastTipPct < 15) return;
    lastTipPct = pct;
    var tip = TIPS[Math.floor(pct / (100 / TIPS.length)) % TIPS.length];
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
    $('res-title').textContent   = r.title || 'Pack d\'étude';
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
      bl.innerHTML = '<p class="brain-links-title">🧠 Connexions avec tes cours précédents</p>' +
        r._brainLinks.map(function (l) {
          return '<p class="brain-link-item">Tu as déjà étudié <strong>' + esc(l.concept) + '</strong> dans <em>' + esc(l.seenIn || 'un cours précédent') + '</em> (' + esc(l.subject || '') + ')</p>';
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
      $('sum-mindmap').innerHTML =
        '<div class="mindmap-card"><div class="mindmap-title">🗺️ Mind Map</div>' +
        '<div class="mindmap-root">' + esc(s.mindMap.root) + '</div>' +
        '<div class="mindmap-branches">' +
        (s.mindMap.branches || []).map(function (b) {
          return '<span class="mindmap-branch">' + esc(b) + '</span>';
        }).join('') + '</div></div>';
    }
  }

  // Quiz
  function renderQuiz(q) {
    if (!q || !q.questions || !q.questions.length) return;
    var total = q.questions.length;
    $('quiz-info').textContent = total + ' questions · Mode ' + (state.result?.mode || 'standard');
    var html = q.questions.map(function (qu, i) {
      var diffClass = 'diff-' + (qu.difficulty || 'medium');
      var diffLabel = { easy: 'Facile', medium: 'Moyen', hard: 'Difficile' }[qu.difficulty] || qu.difficulty;
      var optionsHtml = '';
      if (qu.type === 'mcq' && qu.options) {
        optionsHtml = '<div class="quiz-options">' +
          qu.options.map(function (opt) {
            var letter = opt.charAt(0);
            return '<button class="quiz-opt" data-qi="' + i + '" data-ans="' + esc(letter) + '">' + esc(opt) + '</button>';
          }).join('') + '</div>';
      } else if (qu.type === 'truefalse') {
        optionsHtml = '<div class="quiz-options">' +
          '<button class="quiz-opt" data-qi="' + i + '" data-ans="true">✓ Vrai</button>' +
          '<button class="quiz-opt" data-qi="' + i + '" data-ans="false">✗ Faux</button>' +
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
          var score = q.questions.filter(function (_, i) {
            return state.quizRevealed[i] && String(q.questions[i].correct).toLowerCase() === String(state.quizAnswers[i]).toLowerCase();
          }).length;
          var scoreEl = $('quiz-score');
          scoreEl.innerHTML = '<div class="quiz-score-val">' + score + '/' + total + '</div>' +
            '<div class="quiz-score-label">' + Math.round(score / total * 100) + '% de réussite</div>';
          scoreEl.classList.remove('hidden');
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
    if (!c) { stack.innerHTML = '<p style="color:var(--text-subtle);text-align:center;padding:40px">Aucune flashcard disponible.</p>'; return; }
    stack.innerHTML =
      '<div class="flashcard" id="current-fc">' +
      '<div class="fc-face-label">Question</div>' +
      '<div class="fc-front">' +
      '<p class="fc-question">' + esc(c.front || '') + '</p>' +
      '<p class="fc-flip-hint">Cliquer pour retourner</p>' +
      '</div>' +
      '<div class="fc-back">' +
      '<div class="fc-face-label">Réponse</div>' +
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
    if (!memo) { $('memo-content').innerHTML = '<p style="color:var(--text-subtle)">Mémo non disponible.</p>'; return; }
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
        '<div class="memo-section"><h3 class="memo-section-title">✅ Checklist veille d\'examen</h3>' +
        '<ul class="memo-checklist">' + memo.exam_checklist.map(function (it) { return '<li>' + esc(it) + '</li>'; }).join('') + '</ul></div>'
        : '');
    $('memo-content').innerHTML = html;
  }

  // Concepts & traps
  function renderConcepts(concepts, traps, examQs) {
    $('concepts-list').innerHTML = (concepts || []).map(function (c) {
      var impClass = 'imp-' + (c.importance || 'medium');
      var impLabel = { high: '🔴 Crucial', medium: '🟡 Important', low: '🟢 Secondaire' }[c.importance] || c.importance;
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
      $('traps-list').innerHTML = '<h3 class="traps-header">⚠️ Pièges & erreurs fréquentes</h3>' +
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
        '<h3 class="traps-header">🎯 Questions probables d\'examen</h3>' +
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
        '<h3 class="roadmap-header">🗺️ Plan de révision sur ' + (roadmap.total_days || 7) + ' jours</h3>' +
        roadmap.sessions.map(function (s) {
          return '<div class="roadmap-day">' +
            '<div class="roadmap-day-num"><span class="roadmap-day-label">Jour</span><span class="roadmap-day-n">' + s.day + '</span></div>' +
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
        '<p class="mastery-title">📊 Niveau de maîtrise estimé</p>' +
        '<div class="mastery-score-row">' +
        '<span class="mastery-score-val">' + (mastery.estimated_level || '?') + '%</span>' +
        '<div><p class="mastery-score-label">Premier contact</p></div>' +
        '</div>' +
        '<p class="mastery-time">⏳ Temps pour maîtriser : ' + (mastery.time_to_master_hours || '?') + 'h</p>' +
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
    } catch (err) { flash('Erreur : ' + err.message); }
  }

  async function startExam() {
    if (!AUTH_TOKEN) { flash('Connecte-toi pour accéder au simulateur d\'examen.'); return; }
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
    if (!AUTH_TOKEN) { flash('Connecte-toi pour créer un duel.'); return; }
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
      flash('Lien de duel copié ! 🎉 Partage : ' + url);
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
  function flash(msg) {
    var t = document.getElementById('toast') || document.createElement('div');
    if (!t.id) { t.id = 'toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.className = 'toast';
    t.classList.remove('hidden');
    setTimeout(function () { t.classList.add('hidden'); }, 4000);
  }

  // ── Public API for workspace.js integration ──────────────────
  function restoreJob(jobId) {
    if (!jobId) return;
    state.jobId = jobId;
    showSection('section-progress');
    pollResult();
  }

  window._uploadAPI = { restoreJob };

})();
