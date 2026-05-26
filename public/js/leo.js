/* ============================================================
   Ari — Atelier Cosmique  v5
   /leo page — streaming · LaTeX · code · subject detection
   ============================================================ */
'use strict';

// ── State ─────────────────────────────────────────────────────
const S = {
  messages:    [],
  loading:     false,
  recording:   false,
  mediaRecorder: null,
  audioChunks: [],
  recTimerID:  null,
  recSeconds:  0,
  convId:      null,
  conversations: [],
  searchQuery: '',
};

// ── Lang / Level ──────────────────────────────────────────────
const getLang  = () => localStorage.getItem('studyai_lang') || document.documentElement.lang || 'fr';
const getLevel = () => localStorage.getItem('studyai_user_level') || null;
const getToken = () => localStorage.getItem('studyai_token') || null;

function authHeaders(json = false) {
  const h = {};
  if (json) h['Content-Type'] = 'application/json';
  const t = getToken();
  if (t) h['x-auth-token'] = t;
  return h;
}

// ── Theme ─────────────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem('studyai_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  _updateThemeIcon(saved);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next    = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('studyai_theme', next);
  _updateThemeIcon(next);
}

function _updateThemeIcon(theme) {
  const el = document.querySelector('#theme-toggle .theme-icon');
  if (el) el.textContent = theme === 'dark' ? '🌙' : '☀️';
}

// ── Cosmos stars ──────────────────────────────────────────────
function generateStars() {
  const container = document.getElementById('cosmos-stars');
  if (!container) return;
  const COLORS = ['var(--ac-star-1)', 'var(--ac-star-2)', 'var(--ac-star-3)'];
  for (let i = 0; i < 30; i++) {
    const s = document.createElement('div');
    s.className = 'cosmos-star';
    s.style.cssText = [
      `left:${Math.random()*100}%`,
      `top:${Math.random()*100}%`,
      `width:${1+Math.random()*2.5}px`,
      `height:${1+Math.random()*2.5}px`,
      `background:${COLORS[Math.floor(Math.random()*COLORS.length)]}`,
      `animation-delay:${(Math.random()*4).toFixed(2)}s`,
      `animation-duration:${(2.5+Math.random()*3).toFixed(2)}s`,
    ].join(';');
    container.appendChild(s);
  }
}

// ── Subject detection ─────────────────────────────────────────
const SUBJECTS = {
  math:    { label: '📐 Mathématiques', kw: ['math','calcul','équation','algèbre','géométrie','trigono','dérivée','intégrale','probabilité','fraction','pourcentage','logarithme','vecteur','matrice','complexe'] },
  history: { label: '📜 Histoire',      kw: ['histoire','guerre','révolution','siècle','civilisation','empire','roi','reine','président','traité','bataille','colonisation','shoah','antiquité'] },
  science: { label: '🔬 Sciences',      kw: ['physique','chimie','biologie','atome','molécule','énergie','force','gravité','oxygène','cellule','adn','génétique','évolution','réaction','électricité'] },
  geo:     { label: '🌍 Géographie',    kw: ['géographie','pays','capitale','continent','océan','fleuve','montagne','climat','population','relief','carte','territoire'] },
  lit:     { label: '📖 Littérature',   kw: ['littérature','roman','poème','auteur','personnage','analyse','texte','lecture','chapitre','métaphore','rhétorique','narration','théâtre','fable'] },
  lang:    { label: '🗣 Langues',        kw: ['grammaire','conjugaison','vocabulaire','anglais','espagnol','allemand','verbe','nom','adjectif','syntaxe','orthographe','accord','participe'] },
  code:    { label: '💻 Programmation', kw: ['code','programme','fonction','variable','algorithme','boucle','array','python','javascript','java','html','css','bug','erreur','compilateur','base de données'] },
  philo:   { label: '🤔 Philosophie',   kw: ['philosophie','éthique','morale','philosophe','platon','descartes','kant','conscience','existence','liberté','raison','logique'] },
  eco:     { label: '📈 Économie',      kw: ['économie','marché','offre','demande','inflation','pib','budget','entreprise','finance','impôt','commerce','mondialisation'] },
};

function detectSubject(text) {
  const lower = text.toLowerCase();
  for (const { label, kw } of Object.values(SUBJECTS)) {
    if (kw.some(k => lower.includes(k))) return label;
  }
  return null;
}

function updateSubjectBar(text) {
  const subject = detectSubject(text);
  if (!subject) return;
  const bar = $('ari-subject-bar');
  const tag = $('ari-subject-tag');
  if (bar && tag) { tag.textContent = subject; bar.hidden = false; }
}

// ── Markdown renderer (with LaTeX placeholder extraction) ─────
function renderMd(raw) {
  if (!raw) return '';

  // 0. Extract LaTeX before HTML-escaping so & isn't corrupted
  const math = [];
  let s = raw;
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_, m) => { const id=`\x02M${math.length}\x03`; math.push({m,d:true});  return id; });
  s = s.replace(/\$([^$\n]{1,300}?)\$/g,   (_, m) => { const id=`\x02M${math.length}\x03`; math.push({m,d:false}); return id; });

  // 1. Escape HTML
  s = s
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;');

  // 2. Code blocks
  s = s.replace(/```[\w]*\n?([\s\S]*?)```/g, (_, c) => `<pre><code>${c.trim()}</code></pre>`);

  // 3. Inline code
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');

  // 4. Bold / italic
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*(.+?)\*/g,     '<em>$1</em>');

  // 5. HR / Headings
  s = s.replace(/^---+$/gm, '<hr>');
  s = s.replace(/^#{1,3}\s+(.+)$/gm, '<h3>$1</h3>');

  // 6. Lists
  s = s.replace(/((?:^[ \t]*[-*]\s.+\n?)+)/gm, match => {
    const items = match.trim().split('\n').map(l => `<li>${l.replace(/^[ \t]*[-*]\s/, '')}</li>`).join('');
    return `<ul>${items}</ul>`;
  });
  s = s.replace(/((?:^[ \t]*\d+\.\s.+\n?)+)/gm, match => {
    const items = match.trim().split('\n').map(l => `<li>${l.replace(/^[ \t]*\d+\.\s/, '')}</li>`).join('');
    return `<ol>${items}</ol>`;
  });

  // 7. Paragraphs
  s = s.split(/\n{2,}/).map(p => {
    p = p.trim(); if (!p) return '';
    if (/^<(h3|ul|ol|pre|hr)/.test(p)) return p;
    return `<p>${p.replace(/\n/g, '<br>')}</p>`;
  }).join('');

  // 8. Restore LaTeX
  s = s.replace(/\x02M(\d+)\x03/g, (_, i) => {
    const { m, d } = math[+i];
    if (!window.katex) return d ? `$$${m}$$` : `$${m}$`;
    try { return window.katex.renderToString(m, { displayMode: d, throwOnError: false }); }
    catch { return d ? `$$${m}$$` : `$${m}$`; }
  });

  return s;
}

// ── Contextual suggestions ────────────────────────────────────
function _contextSugs(botText) {
  const t = botText.toLowerCase();
  if (t.includes('exercice') || t.includes('pratique') || t.includes('entraîne'))
    return [
      { label: '📝 Encore des exercices', prompt: 'Donne-moi d\'autres exercices sur ce sujet' },
      { label: '✅ Voir les corrections',  prompt: 'Montre-moi les corrections détaillées' },
    ];
  if (t.includes('examen') || t.includes('quiz') || t.includes('question type'))
    return [
      { label: '❓ Questions types',     prompt: 'Quelles sont les questions types d\'examen ?' },
      { label: '⚠️ Erreurs fréquentes', prompt: 'Quelles erreurs fréquentes dois-je éviter ?' },
    ];
  if (t.includes('révision') || t.includes('plan') || t.includes('programme'))
    return [
      { label: '📅 Plan détaillé',  prompt: 'Fais-moi un plan de révision complet' },
      { label: '🧪 Quiz rapide',    prompt: 'Fais-moi un quiz sur ce sujet' },
    ];
  if (t.includes('formule') || t.includes('théorème') || t.includes('loi '))
    return [
      { label: '💡 Exemple concret',    prompt: 'Donne-moi un exemple concret avec des chiffres' },
      { label: '📐 Exercice guidé',     prompt: 'Fais-moi un exercice guidé étape par étape' },
    ];
  return [];
}

// ── DOM helpers ───────────────────────────────────────────────
const $ = id => document.getElementById(id);

function _nowTime() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function scrollChatBottom(force = false) {
  const c = $('ari-chat');
  if (!c) return;
  const nearBottom = c.scrollHeight - c.scrollTop - c.clientHeight < 120;
  if (force || nearBottom) c.scrollTop = c.scrollHeight;
}

// ── Copy button ───────────────────────────────────────────────
function _addCopyBtn(bubble, rawText) {
  const btn = document.createElement('button');
  btn.className = 'ari-copy-btn';
  btn.innerHTML = '📋 Copier';
  btn.addEventListener('click', () => {
    navigator.clipboard.writeText(rawText).then(() => {
      btn.className = 'ari-copy-btn copied';
      btn.innerHTML = '✓ Copié';
      setTimeout(() => { btn.className = 'ari-copy-btn'; btn.innerHTML = '📋 Copier'; }, 2000);
    });
  });
  bubble.appendChild(btn);
}

// ── Code highlighting ─────────────────────────────────────────
function _applyHighlight(el) {
  if (!window.hljs) return;
  el.querySelectorAll('pre code').forEach(block => {
    try { window.hljs.highlightElement(block); } catch {}
  });
}

// ── Message rendering ─────────────────────────────────────────
function addMsg(role, content, suggestions = [], skipSugs = false) {
  const chat = $('ari-chat');
  if (!chat) return;

  const isBot = role === 'bot' || role === 'assistant';
  const wrap  = document.createElement('div');
  wrap.className = `ari-msg ari-msg-${isBot ? 'bot' : 'user'}`;

  const autoSugs = isBot && !skipSugs ? _contextSugs(content) : [];
  const allSugs  = [...suggestions, ...autoSugs];

  let sugHTML = '';
  if (isBot && allSugs.length) {
    const btns = allSugs.map(s =>
      `<button class="ari-sug-btn" data-prompt="${s.prompt.replace(/"/g, '&quot;')}">${s.label}</button>`
    ).join('');
    sugHTML = `<div class="ari-suggestions">${btns}</div>`;
  }

  const html = renderMd(content);

  wrap.innerHTML = `
    <div class="ari-msg-avatar" aria-hidden="true">${isBot ? '◈' : '✦'}</div>
    <div class="ari-msg-body">
      ${isBot ? '<div class="ari-msg-sender">Ari</div>' : ''}
      <div class="ari-msg-bubble">${html}</div>
      <div class="ari-msg-time">${_nowTime()}</div>
      ${sugHTML}
    </div>`;

  if (isBot) _addCopyBtn(wrap.querySelector('.ari-msg-bubble'), content);
  _applyHighlight(wrap);

  wrap.querySelectorAll('.ari-sug-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const inp = $('ari-input');
      if (inp) { inp.value = btn.dataset.prompt; inp.focus(); }
      sendMessage();
    });
  });

  chat.appendChild(wrap);
  scrollChatBottom(true);
  return wrap;
}

// ── Typing indicator ──────────────────────────────────────────
function showTyping() {
  if ($('ari-typing')) return;
  const chat = $('ari-chat');
  if (!chat) return;
  const el = document.createElement('div');
  el.id = 'ari-typing';
  el.className = 'ari-msg ari-msg-bot';
  el.setAttribute('aria-label', 'Ari est en train d\'écrire…');
  el.innerHTML = `
    <div class="ari-msg-avatar" aria-hidden="true">◈</div>
    <div class="ari-msg-body">
      <div class="ari-msg-sender">Ari</div>
      <div class="ari-msg-bubble">
        <div class="ari-typing">
          <span class="ari-typing-dot"></span>
          <span class="ari-typing-dot"></span>
          <span class="ari-typing-dot"></span>
        </div>
      </div>
    </div>`;
  chat.appendChild(el);
  scrollChatBottom(true);
}

function hideTyping() {
  const el = $('ari-typing');
  if (el) el.remove();
}

// ── Streaming response ────────────────────────────────────────
async function _streamResponse(body) {
  const chat = $('ari-chat');
  if (!chat) return '';

  hideTyping();

  const wrap = document.createElement('div');
  wrap.className = 'ari-msg ari-msg-bot';
  wrap.innerHTML = `
    <div class="ari-msg-avatar" aria-hidden="true">◈</div>
    <div class="ari-msg-body">
      <div class="ari-msg-sender">Ari</div>
      <div class="ari-msg-bubble"><span class="ari-cursor"></span></div>
      <div class="ari-msg-time">${_nowTime()}</div>
    </div>`;
  chat.appendChild(wrap);
  scrollChatBottom(true);

  const bubble     = wrap.querySelector('.ari-msg-bubble');
  const reader     = body.getReader();
  const decoder    = new TextDecoder();
  let fullText     = '';
  let sseBuffer    = '';
  let lastRender   = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split('\n');
      sseBuffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') break;
        try {
          const parsed = JSON.parse(raw);
          if (parsed.error) throw new Error(parsed.error);
          if (parsed.delta) {
            fullText += parsed.delta;
            const now = Date.now();
            if (now - lastRender > 40) {
              bubble.innerHTML = renderMd(fullText) + '<span class="ari-cursor"></span>';
              _applyHighlight(bubble);
              scrollChatBottom();
              lastRender = now;
            }
          }
        } catch { /* ignore parse errors */ }
      }
    }
  } finally {
    // Final clean render with copy button and suggestions
    bubble.innerHTML = renderMd(fullText);
    _addCopyBtn(bubble, fullText);
    _applyHighlight(bubble);

    const autoSugs = _contextSugs(fullText);
    if (autoSugs.length) {
      const body = wrap.querySelector('.ari-msg-body');
      const div  = document.createElement('div');
      div.className = 'ari-suggestions';
      div.innerHTML = autoSugs.map(s =>
        `<button class="ari-sug-btn" data-prompt="${s.prompt.replace(/"/g,'&quot;')}">${s.label}</button>`
      ).join('');
      div.querySelectorAll('.ari-sug-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const inp = $('ari-input');
          if (inp) { inp.value = btn.dataset.prompt; inp.focus(); }
          sendMessage();
        });
      });
      body.appendChild(div);
    }

    scrollChatBottom(true);
  }

  return fullText;
}

// ── Welcome message ───────────────────────────────────────────
const WELCOME_SUGGESTIONS = [
  { label: '📝 Devoir',   prompt: 'Aide-moi avec mon devoir' },
  { label: '🎯 Examen',   prompt: 'Aide-moi à préparer un examen' },
  { label: '📚 Révision', prompt: 'Je veux réviser une matière' },
  { label: '❓ Question', prompt: 'J\'ai une question rapide' },
];

function showWelcome() {
  const chat = $('ari-chat');
  if (!chat) return;
  chat.innerHTML = '';
  addMsg('bot',
    '**Salut ! 👋** Je suis Ari, ton compagnon d\'études cosmique.\n\n' +
    'Je peux t\'aider avec tes **devoirs**, **examens**, **révisions** ou répondre à n\'importe quelle question.\n\n' +
    'Toutes les matières, tous les niveaux — comment je peux t\'aider aujourd\'hui ?',
    WELCOME_SUGGESTIONS,
    true  // skip contextual sugs on welcome
  );
}

// ── Gamification stats ────────────────────────────────────────
async function loadStats() {
  try {
    if (!getToken()) return;
    const r = await fetch('/api/gamification', { headers: authHeaders() });
    if (!r.ok) return;
    const d = await r.json();
    if ($('ari-xp'))     $('ari-xp').textContent     = d.xp     ?? 0;
    if ($('ari-level'))  $('ari-level').textContent  = d.level  ?? 1;
    if ($('ari-streak')) $('ari-streak').textContent = d.streak ?? 0;
  } catch { /* non-critical */ }
}

// ── Send text message (uses streaming) ────────────────────────
async function sendMessage() {
  const inp  = $('ari-input');
  const send = $('ari-send');
  if (!inp || !send) return;

  const text = inp.value.trim();
  if (!text || S.loading) return;

  _setLoading(true);

  addMsg('user', text);
  S.messages.push({ role: 'user', content: text });
  inp.value = '';
  inp.style.height = 'auto';

  if (S.messages.filter(m => m.role === 'user').length === 1) {
    _ensureConv(text);
    updateSubjectBar(text);
  } else {
    updateSubjectBar(text);
  }

  showTyping();

  try {
    const r = await fetch('/api/tutor/chat/stream', {
      method: 'POST',
      headers: authHeaders(true),
      body: JSON.stringify({ messages: S.messages, lang: getLang(), userLevel: getLevel() }),
    });

    if (r.status === 429) {
      hideTyping();
      addMsg('bot', 'Tu as atteint la limite de messages pour cette heure. Réessaie dans un moment !');
      return;
    }
    if (!r.ok) {
      hideTyping();
      addMsg('bot', 'Une erreur s\'est produite. Tu peux réessayer ?');
      return;
    }

    const reply = await _streamResponse(r.body);
    if (reply) {
      S.messages.push({ role: 'assistant', content: reply });
      _saveCurrentConv();
      loadStats();
    }

  } catch {
    hideTyping();
    addMsg('bot', 'Erreur de connexion. Vérifie ton réseau et réessaie.');
  } finally {
    _setLoading(false);
    inp.focus();
  }
}

function _setLoading(v) {
  S.loading = v;
  const s = $('ari-send');
  if (s) s.disabled = v;
}

// ── Upload to Ari (voice / vision / file — non-streaming) ─────
async function _uploadAndChat(endpoint, formData, userMsg) {
  if (S.loading) return;
  _setLoading(true);

  addMsg('user', userMsg);
  updateSubjectBar(userMsg);
  showTyping();

  try {
    const r = await fetch(endpoint, { method: 'POST', headers: authHeaders(false), body: formData });

    if (r.status === 429) {
      hideTyping();
      addMsg('bot', 'Limite d\'upload atteinte. Réessaie dans une heure !');
      return;
    }
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      hideTyping();
      addMsg('bot', `Je n\'ai pas pu traiter ce fichier : ${e.error || 'erreur inconnue'}.`);
      return;
    }

    const data      = await r.json();
    const extracted = (data.text || '').trim();

    if (!extracted) {
      hideTyping();
      addMsg('bot', 'Je n\'ai pas pu lire le contenu de ce fichier. Essaie avec un autre ?');
      return;
    }

    S.messages.push({ role: 'user', content: extracted.slice(0, 3000) });
    if (S.messages.filter(m => m.role === 'user').length === 1) _ensureConv(userMsg);

    const cr = await fetch('/api/tutor/chat', {
      method: 'POST',
      headers: authHeaders(true),
      body: JSON.stringify({ messages: S.messages, lang: getLang(), userLevel: getLevel() }),
    });

    hideTyping();

    if (!cr.ok) {
      addMsg('bot', 'Contenu reçu, mais je n\'ai pas pu l\'analyser. Réessaie ?');
      return;
    }

    const cd    = await cr.json();
    const reply = cd.reply || 'Pas de réponse.';
    addMsg('bot', reply);
    S.messages.push({ role: 'assistant', content: reply });
    _saveCurrentConv();
    loadStats();

  } catch {
    hideTyping();
    addMsg('bot', 'Erreur de connexion. Vérifie ton réseau.');
  } finally {
    _setLoading(false);
  }
}

// ── 🎤 Voice recording ────────────────────────────────────────
function _startRecTimer() {
  S.recSeconds = 0; _updateRecTimer();
  S.recTimerID = setInterval(() => { S.recSeconds++; _updateRecTimer(); }, 1000);
}
function _stopRecTimer() { clearInterval(S.recTimerID); S.recTimerID = null; }
function _updateRecTimer() {
  const el = $('ari-rec-timer');
  if (!el) return;
  el.textContent = `${Math.floor(S.recSeconds/60)}:${(S.recSeconds%60).toString().padStart(2,'0')}`;
}

async function toggleRecording() {
  const btn = $('ari-voice-btn');
  const ind = $('ari-rec-indicator');

  if (S.recording) {
    if (S.mediaRecorder?.state !== 'inactive') S.mediaRecorder.stop();
    S.recording = false; _stopRecTimer();
    if (btn) btn.classList.remove('recording');
    if (ind) ind.hidden = true;
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    addMsg('bot', 'Ton navigateur ne supporte pas l\'enregistrement audio. Essaie Chrome ou Firefox.');
    return;
  }

  try {
    const stream   = await navigator.mediaDevices.getUserMedia({ audio: true });
    S.audioChunks  = [];
    const mimeType = ['audio/webm;codecs=opus','audio/webm','audio/ogg','audio/mp4']
      .find(t => MediaRecorder.isTypeSupported(t)) || '';

    S.mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    S.mediaRecorder.ondataavailable = e => { if (e.data?.size > 0) S.audioChunks.push(e.data); };
    S.mediaRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(S.audioChunks, { type: mimeType || 'audio/webm' });
      if (blob.size < 500) { addMsg('bot', 'Enregistrement trop court. Parle un peu plus longtemps !'); return; }
      const fd  = new FormData();
      const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : 'webm';
      fd.append('audio', blob, `recording.${ext}`);
      fd.append('lang', getLang());
      _uploadAndChat('/api/tutor/voice', fd, '🎤 Message vocal envoyé…');
    };

    S.mediaRecorder.start(250);
    S.recording = true;
    if (btn) btn.classList.add('recording');
    if (ind) ind.hidden = false;
    _startRecTimer();

  } catch (err) {
    addMsg('bot', err.name === 'NotAllowedError'
      ? 'Accès au micro refusé. Autorise le microphone dans les paramètres du navigateur, puis réessaie.'
      : `Impossible d\'accéder au micro : ${err.message}`);
  }
}

// ── 📷 Photo upload ───────────────────────────────────────────
function handlePhoto() {
  const inp = $('ari-photo-input');
  if (!inp) return;
  inp.value = '';
  const onChange = () => {
    inp.removeEventListener('change', onChange);
    const file = inp.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { addMsg('bot', 'Image trop volumineuse (max 5 Mo). Compresse-la et réessaie !'); return; }
    const fd = new FormData();
    fd.append('image', file); fd.append('lang', getLang());
    _uploadAndChat('/api/tutor/vision', fd, `📷 Image envoyée : ${file.name}`);
  };
  inp.addEventListener('change', onChange);
  inp.click();
}

// ── 📎 File upload ────────────────────────────────────────────
function handleFile() {
  const inp = $('ari-file-input');
  if (!inp) return;
  inp.value = '';
  const onChange = () => {
    inp.removeEventListener('change', onChange);
    const file = inp.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { addMsg('bot', 'Fichier trop volumineux (max 10 Mo).'); return; }
    const fd = new FormData();
    fd.append('file', file);
    _uploadAndChat('/api/tutor/file', fd, `📎 Fichier envoyé : ${file.name}`);
  };
  inp.addEventListener('change', onChange);
  inp.click();
}

// ── Drag & drop on textarea ───────────────────────────────────
function setupDragDrop() {
  const inp = $('ari-input');
  if (!inp) return;
  inp.addEventListener('dragover', e => { e.preventDefault(); inp.classList.add('drag-over'); });
  inp.addEventListener('dragleave', () => inp.classList.remove('drag-over'));
  inp.addEventListener('drop', e => {
    e.preventDefault(); inp.classList.remove('drag-over');
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    const fd = new FormData();
    if (file.type.startsWith('image/')) {
      fd.append('image', file); fd.append('lang', getLang());
      _uploadAndChat('/api/tutor/vision', fd, `📷 Image déposée : ${file.name}`);
    } else {
      fd.append('file', file);
      _uploadAndChat('/api/tutor/file', fd, `📎 Fichier déposé : ${file.name}`);
    }
  });
}

// ── Composer auto-resize + keyboard ──────────────────────────
function setupComposer() {
  const inp  = $('ari-input');
  const send = $('ari-send');
  if (!inp || !send) return;

  inp.addEventListener('input', () => {
    inp.style.height = 'auto';
    inp.style.height = Math.min(inp.scrollHeight, 160) + 'px';
  });
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  send.addEventListener('click', sendMessage);
}

// ── Scroll-to-bottom button ───────────────────────────────────
function setupScrollBtn() {
  const chat = $('ari-chat');
  const btn  = $('ari-scroll-btn');
  if (!chat || !btn) return;

  chat.addEventListener('scroll', () => {
    const fromBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight;
    btn.hidden = fromBottom < 200;
  });
  btn.addEventListener('click', () => { chat.scrollTop = chat.scrollHeight; btn.hidden = true; });
}

// ── HISTORY — localStorage (anonymous) ───────────────────────
const HIST_KEY = 'studyai_ari_history';

function _histLoad() {
  try { return JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); } catch { return []; }
}
function _histSave(convs) {
  try { localStorage.setItem(HIST_KEY, JSON.stringify(convs.slice(0, 50))); } catch {}
}
function _histSaveConv(conv) {
  const all = _histLoad(); const idx = all.findIndex(c => c.id === conv.id);
  if (idx >= 0) all[idx] = conv; else all.unshift(conv);
  _histSave(all);
}
function _histDelete(id) { _histSave(_histLoad().filter(c => c.id !== id)); }

async function _serverSaveConv(conv) {
  if (!getToken()) return;
  try {
    await fetch('/api/tutor/history', {
      method: 'POST', headers: authHeaders(true),
      body: JSON.stringify({ id: conv.id, title: conv.title, messages: conv.messages.slice(-40), subject: conv.subject || null, userLevel: getLevel() }),
    });
  } catch {}
}
async function _serverDeleteConv(id) {
  if (!getToken()) return;
  try { await fetch(`/api/tutor/history/${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders() }); } catch {}
}

// ── Conversation management ───────────────────────────────────
function _newConvId() { return 'conv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7); }

function _ensureConv(titleHint) {
  if (!S.convId) S.convId = _newConvId();
  if (!S.conversations.find(c => c.id === S.convId)) {
    S.conversations.unshift({ id: S.convId, title: (titleHint || 'Nouvelle conversation').slice(0, 60), messages: [], updatedAt: Date.now(), createdAt: Date.now() });
    renderSidebar();
  }
}

function _saveCurrentConv() {
  if (!S.convId) return;
  const conv = S.conversations.find(c => c.id === S.convId);
  if (conv) {
    conv.messages  = S.messages.slice(-60).map(m => ({...m, timestamp: Date.now()}));
    conv.updatedAt = Date.now();
    _histSaveConv(conv); _serverSaveConv(conv); renderSidebar();
  }
}

function startNewConversation() {
  S.convId = _newConvId(); S.messages = []; S.loading = false;
  hideTyping(); showWelcome();
  document.querySelectorAll('.ari-history-item').forEach(el => el.classList.remove('active'));
  if (window.innerWidth <= 768) closeSidebar();
}

function loadConversation(id) {
  const conv = S.conversations.find(c => c.id === id);
  if (!conv) return;
  S.convId   = id;
  S.messages = (conv.messages || []).map(m => ({ role: m.role, content: m.content }));
  const chat = $('ari-chat');
  if (!chat) return;
  chat.innerHTML = '';
  S.messages.forEach(m => addMsg(m.role, m.content, [], true));
  if (!S.messages.length) showWelcome();
  renderSidebar();
  if (window.innerWidth <= 768) closeSidebar();
}

function deleteConversation(id) {
  if (!confirm('Supprimer cette conversation ?')) return;
  S.conversations = S.conversations.filter(c => c.id !== id);
  _histDelete(id); _serverDeleteConv(id);
  if (S.convId === id) startNewConversation();
  renderSidebar();
}

// ── Sidebar ───────────────────────────────────────────────────
function _relDate(ts) {
  const d = Date.now() - ts, day = 86400000;
  if (d < day)     return 'Aujourd\'hui';
  if (d < 2*day)   return 'Hier';
  if (d < 7*day)   return 'Cette semaine';
  return 'Plus ancien';
}
function _timeAgo(ts) {
  const m = Math.floor((Date.now()-ts)/60000);
  if (m < 1)  return 'à l\'instant';
  if (m < 60) return `il y a ${m}min`;
  const h = Math.floor(m/60);
  if (h < 24) return `il y a ${h}h`;
  return `il y a ${Math.floor(h/24)}j`;
}
function _esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderSidebar() {
  const list = $('ari-history-list');
  if (!list) return;
  const q = S.searchQuery.toLowerCase().trim();
  let convs = S.conversations;
  if (q) convs = convs.filter(c => c.title.toLowerCase().includes(q));

  if (!convs.length) {
    list.innerHTML = `<div class="ari-history-empty">${q ? 'Aucun résultat.' : 'Tes conversations apparaîtront ici.'}</div>`;
    return;
  }

  const groups = {};
  convs.forEach(c => { const g = _relDate(c.updatedAt||c.createdAt||Date.now()); if (!groups[g]) groups[g]=[]; groups[g].push(c); });

  let html = '';
  ['Aujourd\'hui','Hier','Cette semaine','Plus ancien'].forEach(g => {
    if (!groups[g]?.length) return;
    html += `<div class="ari-history-group-lbl">${g}</div>`;
    groups[g].forEach(c => {
      html += `
        <div class="ari-history-item${c.id===S.convId?' active':''}" role="listitem" data-id="${c.id}" tabindex="0" aria-label="${c.title}">
          <div class="ari-history-info">
            <div class="ari-history-title">${_esc(c.title)}</div>
            <div class="ari-history-date">${_timeAgo(c.updatedAt||c.createdAt||Date.now())}</div>
          </div>
          <button class="ari-history-del" data-del="${c.id}" aria-label="Supprimer" title="Supprimer">✕</button>
        </div>`;
    });
  });

  list.innerHTML = html;
  list.querySelectorAll('.ari-history-item').forEach(el => {
    el.addEventListener('click', e => { if (e.target.closest('.ari-history-del')) return; loadConversation(el.dataset.id); });
    el.addEventListener('keydown', e => { if (e.key==='Enter') loadConversation(el.dataset.id); });
  });
  list.querySelectorAll('.ari-history-del').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); deleteConversation(btn.dataset.del); });
  });
}

// ── Sidebar toggle ────────────────────────────────────────────
function openSidebar()  { document.body.classList.add('sidebar-open');    $('ari-app')?.classList.add('sidebar-open'); }
function closeSidebar() { document.body.classList.remove('sidebar-open'); $('ari-app')?.classList.remove('sidebar-open'); }
function toggleSidebar() { $('ari-app')?.classList.contains('sidebar-open') ? closeSidebar() : openSidebar(); }

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  generateStars();

  S.conversations = _histLoad();
  renderSidebar();

  S.convId = _newConvId();
  showWelcome();
  loadStats();

  setupComposer();
  setupDragDrop();
  setupScrollBtn();

  $('theme-toggle')?.addEventListener('click', toggleTheme);
  $('ari-sidebar-toggle')?.addEventListener('click', toggleSidebar);
  $('ari-sidebar-overlay')?.addEventListener('click', closeSidebar);
  $('ari-new-conv')?.addEventListener('click', startNewConversation);

  $('ari-search')?.addEventListener('input', e => { S.searchQuery = e.target.value; renderSidebar(); });

  $('ari-subject-close')?.addEventListener('click', () => { const b=$('ari-subject-bar'); if(b) b.hidden=true; });

  $('ari-voice-btn')?.addEventListener('click', toggleRecording);
  $('ari-photo-btn')?.addEventListener('click', handlePhoto);
  $('ari-file-btn')?.addEventListener('click',  handleFile);

  if (window.innerWidth > 768) $('ari-input')?.focus();
});
