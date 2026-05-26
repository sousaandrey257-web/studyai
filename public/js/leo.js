/* ============================================================
   Léo — Tuteur IA conversationnel  v3
   /leo page
   ============================================================ */
'use strict';

// ── State ─────────────────────────────────────────────────────
const S = {
  messages:    [],        // current conversation [{role, content}]
  loading:     false,
  recording:   false,
  mediaRecorder: null,
  audioChunks: [],
  recTimerID:  null,
  recSeconds:  0,
  convId:      null,      // current conversation ID
  conversations: [],      // history [{id, title, messages, updatedAt}]
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

// ── Minimal safe markdown renderer ───────────────────────────
function renderMd(raw) {
  if (!raw) return '';

  // 1. Escape HTML
  let s = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  // 2. Code blocks ```…```
  s = s.replace(/```[\w]*\n?([\s\S]*?)```/g,
    (_, c) => `<pre><code>${c.trim()}</code></pre>`);

  // 3. Inline code
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');

  // 4. Bold / italic
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*(.+?)\*/g,     '<em>$1</em>');

  // 5. HR
  s = s.replace(/^---+$/gm, '<hr>');

  // 6. Headings
  s = s.replace(/^#{1,3}\s+(.+)$/gm, '<h3>$1</h3>');

  // 7. Unordered lists
  s = s.replace(/((?:^[ \t]*[-*]\s.+\n?)+)/gm, match => {
    const items = match.trim().split('\n')
      .map(l => `<li>${l.replace(/^[ \t]*[-*]\s/, '')}</li>`).join('');
    return `<ul>${items}</ul>`;
  });

  // 8. Ordered lists
  s = s.replace(/((?:^[ \t]*\d+\.\s.+\n?)+)/gm, match => {
    const items = match.trim().split('\n')
      .map(l => `<li>${l.replace(/^[ \t]*\d+\.\s/, '')}</li>`).join('');
    return `<ol>${items}</ol>`;
  });

  // 9. Paragraphs (double newline)
  s = s.split(/\n{2,}/).map(p => {
    p = p.trim();
    if (!p) return '';
    if (/^<(h3|ul|ol|pre|hr)/.test(p)) return p;
    return `<p>${p.replace(/\n/g, '<br>')}</p>`;
  }).join('');

  return s;
}

// ── DOM helpers ───────────────────────────────────────────────
const $ = id => document.getElementById(id);

function scrollChatBottom() {
  const c = $('leo-chat');
  if (c) c.scrollTop = c.scrollHeight;
}

// ── Gamification stats ────────────────────────────────────────
async function loadStats() {
  try {
    const t = getToken();
    if (!t) return;
    const r = await fetch('/api/gamification', { headers: authHeaders() });
    if (!r.ok) return;
    const d = await r.json();
    if ($('leo-xp'))     $('leo-xp').textContent     = d.xp     ?? 0;
    if ($('leo-level'))  $('leo-level').textContent  = d.level  ?? 1;
    if ($('leo-streak')) $('leo-streak').textContent = d.streak ?? 0;
  } catch { /* non-critical */ }
}

// ── Message rendering ─────────────────────────────────────────
function addMsg(role, content, suggestions = []) {
  const chat = $('leo-chat');
  if (!chat) return;

  const isBot = role === 'bot' || role === 'assistant';
  const wrap  = document.createElement('div');
  wrap.className = `leo-msg leo-msg-${isBot ? 'bot' : 'user'}`;

  let sugHTML = '';
  if (isBot && suggestions.length) {
    const btns = suggestions.map(s =>
      `<button class="leo-sug-btn" data-prompt="${s.prompt.replace(/"/g, '&quot;')}">
         ${s.label}
       </button>`
    ).join('');
    sugHTML = `<div class="leo-suggestions">${btns}</div>`;
  }

  wrap.innerHTML = `
    <div class="leo-msg-avatar" aria-hidden="true">${isBot ? '🤖' : '👤'}</div>
    <div class="leo-msg-body">
      ${isBot ? '<div class="leo-msg-sender">Léo</div>' : ''}
      <div class="leo-msg-bubble">${isBot ? renderMd(content) : renderMd(content)}</div>
      ${sugHTML}
    </div>`;

  wrap.querySelectorAll('.leo-sug-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const inp = $('leo-input');
      if (inp) { inp.value = btn.dataset.prompt; inp.focus(); }
      sendMessage();
    });
  });

  chat.appendChild(wrap);
  scrollChatBottom();
}

function showTyping() {
  if ($('leo-typing')) return;
  const chat = $('leo-chat');
  if (!chat) return;
  const el = document.createElement('div');
  el.id = 'leo-typing';
  el.className = 'leo-msg leo-msg-bot';
  el.setAttribute('aria-label', 'Léo est en train d\'écrire…');
  el.innerHTML = `
    <div class="leo-msg-avatar" aria-hidden="true">🤖</div>
    <div class="leo-msg-body">
      <div class="leo-msg-sender">Léo</div>
      <div class="leo-msg-bubble">
        <div class="leo-typing">
          <span class="leo-typing-dot"></span>
          <span class="leo-typing-dot"></span>
          <span class="leo-typing-dot"></span>
        </div>
      </div>
    </div>`;
  chat.appendChild(el);
  scrollChatBottom();
}

function hideTyping() {
  const el = $('leo-typing');
  if (el) el.remove();
}

// ── Welcome message ───────────────────────────────────────────
const WELCOME_SUGGESTIONS = [
  { label: '📝 Devoir',   prompt: 'Aide-moi avec mon devoir' },
  { label: '🎯 Examen',   prompt: 'Aide-moi à préparer un examen' },
  { label: '📚 Révision', prompt: 'Je veux réviser une matière' },
  { label: '❓ Question', prompt: 'J\'ai une question rapide' },
];

function showWelcome() {
  const chat = $('leo-chat');
  if (!chat) return;
  chat.innerHTML = '';
  addMsg('bot',
    '**Salut&nbsp;! 👋** Je suis Léo, ton tuteur IA personnel.\n\n' +
    'Je peux t\'aider avec tes **devoirs**, **examens**, **révisions** ou répondre à n\'importe quelle question.\n\n' +
    'Toutes les matières, tous les niveaux — comment je peux t\'aider aujourd\'hui&nbsp;?',
    WELCOME_SUGGESTIONS
  );
}

// ── Send text message ─────────────────────────────────────────
async function sendMessage() {
  const inp  = $('leo-input');
  const send = $('leo-send');
  if (!inp || !send) return;

  const text = inp.value.trim();
  if (!text || S.loading) return;

  _setLoading(true);

  addMsg('user', text);
  S.messages.push({ role: 'user', content: text });
  inp.value = '';
  inp.style.height = 'auto';

  // Update history title on first user message
  if (S.messages.filter(m => m.role === 'user').length === 1) {
    _ensureConv(text);
  }

  showTyping();

  try {
    const r = await fetch('/api/tutor/chat', {
      method: 'POST',
      headers: authHeaders(true),
      body: JSON.stringify({
        messages:  S.messages,
        lang:      getLang(),
        userLevel: getLevel(),
      }),
    });

    hideTyping();

    if (r.status === 429) {
      addMsg('bot', 'Tu as atteint la limite de messages pour cette heure. Réessaie dans un moment&nbsp;!');
      return;
    }

    if (!r.ok) {
      addMsg('bot', 'Une erreur s\'est produite. Tu peux réessayer&nbsp;?');
      return;
    }

    const d     = await r.json();
    const reply = d.reply || 'Pas de réponse reçue.';
    addMsg('bot', reply);
    S.messages.push({ role: 'assistant', content: reply });

    _saveCurrentConv();
    loadStats();

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
  const s = $('leo-send');
  if (s) s.disabled = v;
}

// ── Upload to Leo (vision / voice / file) ────────────────────
async function _uploadAndChat(endpoint, formData, userMsg) {
  if (S.loading) return;
  _setLoading(true);

  addMsg('user', userMsg);
  showTyping();

  try {
    const r = await fetch(endpoint, {
      method:  'POST',
      headers: authHeaders(false),
      body:    formData,
    });

    if (r.status === 429) {
      hideTyping();
      addMsg('bot', 'Limite d\'upload atteinte. Réessaie dans une heure&nbsp;!');
      return;
    }

    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      hideTyping();
      addMsg('bot', `Je n\'ai pas pu traiter ce fichier : ${e.error || 'erreur inconnue'}.`);
      return;
    }

    const data          = await r.json();
    const extracted     = (data.text || '').trim();

    if (!extracted) {
      hideTyping();
      addMsg('bot', 'Je n\'ai pas pu lire le contenu de ce fichier. Essaie avec un autre&nbsp;?');
      return;
    }

    // Push extracted text as user context
    const ctxMsg = { role: 'user', content: extracted.slice(0, 3000) };
    S.messages.push(ctxMsg);

    if (S.messages.filter(m => m.role === 'user').length === 1) {
      _ensureConv(userMsg);
    }

    // Now ask Leo to analyse the content
    const cr = await fetch('/api/tutor/chat', {
      method:  'POST',
      headers: authHeaders(true),
      body: JSON.stringify({
        messages:  S.messages,
        lang:      getLang(),
        userLevel: getLevel(),
      }),
    });

    hideTyping();

    if (!cr.ok) {
      addMsg('bot', 'Contenu reçu, mais je n\'ai pas pu l\'analyser. Réessaie&nbsp;?');
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
  S.recSeconds = 0;
  _updateRecTimer();
  S.recTimerID = setInterval(() => { S.recSeconds++; _updateRecTimer(); }, 1000);
}
function _stopRecTimer() {
  clearInterval(S.recTimerID);
  S.recTimerID = null;
}
function _updateRecTimer() {
  const el = $('leo-rec-timer');
  if (!el) return;
  const m = Math.floor(S.recSeconds / 60).toString();
  const s = (S.recSeconds % 60).toString().padStart(2, '0');
  el.textContent = `${m}:${s}`;
}

async function toggleRecording() {
  const btn = $('leo-voice-btn');
  const ind = $('leo-recording-indicator');

  if (S.recording) {
    // Stop
    if (S.mediaRecorder && S.mediaRecorder.state !== 'inactive') {
      S.mediaRecorder.stop();
    }
    S.recording = false;
    _stopRecTimer();
    if (btn) btn.classList.remove('recording');
    if (ind) ind.hidden = true;
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    addMsg('bot', 'Ton navigateur ne supporte pas l\'enregistrement audio. Essaie Chrome ou Firefox.');
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    S.audioChunks = [];

    // Pick best supported codec
    const mimeType = ['audio/webm;codecs=opus','audio/webm','audio/ogg','audio/mp4']
      .find(t => MediaRecorder.isTypeSupported(t)) || '';

    S.mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

    S.mediaRecorder.ondataavailable = e => {
      if (e.data?.size > 0) S.audioChunks.push(e.data);
    };

    S.mediaRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(S.audioChunks, { type: mimeType || 'audio/webm' });
      if (blob.size < 500) {
        addMsg('bot', 'Enregistrement trop court. Parle un peu plus longtemps&nbsp;!');
        return;
      }
      const fd = new FormData();
      const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : 'webm';
      fd.append('audio', blob, `recording.${ext}`);
      fd.append('lang', getLang());
      _uploadAndChat('/api/tutor/voice', fd, '🎤 Message vocal envoyé…');
    };

    S.mediaRecorder.start(250); // collect every 250ms
    S.recording = true;
    if (btn) btn.classList.add('recording');
    if (ind) ind.hidden = false;
    _startRecTimer();

  } catch (err) {
    const msg = err.name === 'NotAllowedError'
      ? 'Accès au micro refusé. Autorise le microphone dans les paramètres du navigateur, puis réessaie.'
      : `Impossible d\'accéder au micro : ${err.message}`;
    addMsg('bot', msg);
  }
}

// ── 📷 Photo upload ───────────────────────────────────────────
function handlePhoto() {
  const inp = $('leo-photo-input');
  if (!inp) return;
  inp.value = '';

  const onChange = () => {
    inp.removeEventListener('change', onChange);
    const file = inp.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      addMsg('bot', 'Image trop volumineuse (max 5 Mo). Compresse-la et réessaie&nbsp;!');
      return;
    }
    const fd = new FormData();
    fd.append('image', file);
    fd.append('lang', getLang());
    _uploadAndChat('/api/tutor/vision', fd, `📷 Image envoyée : ${file.name}`);
  };

  inp.addEventListener('change', onChange);
  inp.click();
}

// ── 📎 File upload ────────────────────────────────────────────
function handleFile() {
  const inp = $('leo-file-input');
  if (!inp) return;
  inp.value = '';

  const onChange = () => {
    inp.removeEventListener('change', onChange);
    const file = inp.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      addMsg('bot', 'Fichier trop volumineux (max 10 Mo).');
      return;
    }
    const fd = new FormData();
    fd.append('file', file);
    _uploadAndChat('/api/tutor/file', fd, `📎 Fichier envoyé : ${file.name}`);
  };

  inp.addEventListener('change', onChange);
  inp.click();
}

// ── Drag & drop on textarea ───────────────────────────────────
function setupDragDrop() {
  const inp = $('leo-input');
  if (!inp) return;

  inp.addEventListener('dragover', e => {
    e.preventDefault();
    inp.classList.add('drag-over');
  });
  inp.addEventListener('dragleave', () => inp.classList.remove('drag-over'));
  inp.addEventListener('drop', e => {
    e.preventDefault();
    inp.classList.remove('drag-over');
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    if (file.type.startsWith('image/')) {
      const fd = new FormData();
      fd.append('image', file);
      fd.append('lang', getLang());
      _uploadAndChat('/api/tutor/vision', fd, `📷 Image déposée : ${file.name}`);
    } else {
      const fd = new FormData();
      fd.append('file', file);
      _uploadAndChat('/api/tutor/file', fd, `📎 Fichier déposé : ${file.name}`);
    }
  });
}

// ── Composer auto-resize + keyboard ──────────────────────────
function setupComposer() {
  const inp  = $('leo-input');
  const send = $('leo-send');
  if (!inp || !send) return;

  inp.addEventListener('input', () => {
    inp.style.height = 'auto';
    inp.style.height = Math.min(inp.scrollHeight, 160) + 'px';
  });

  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  send.addEventListener('click', sendMessage);
}

// ── HISTORY — localStorage (anonymous) ───────────────────────
const HIST_KEY = 'studyai_leo_history';

function _histLoad() {
  try { return JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); }
  catch { return []; }
}

function _histSave(convs) {
  try { localStorage.setItem(HIST_KEY, JSON.stringify(convs.slice(0, 50))); }
  catch { /* storage full */ }
}

function _histSaveConv(conv) {
  const all = _histLoad();
  const idx = all.findIndex(c => c.id === conv.id);
  if (idx >= 0) all[idx] = conv;
  else all.unshift(conv);
  _histSave(all);
}

function _histDelete(id) {
  const all = _histLoad().filter(c => c.id !== id);
  _histSave(all);
}

// Server history (for logged-in users)
async function _serverSaveConv(conv) {
  if (!getToken()) return;
  try {
    await fetch('/api/tutor/history', {
      method:  'POST',
      headers: authHeaders(true),
      body: JSON.stringify({
        id:       conv.id,
        title:    conv.title,
        messages: conv.messages.slice(-40),
        subject:  conv.subject || null,
        userLevel: getLevel(),
      }),
    });
  } catch { /* non-blocking */ }
}

async function _serverDeleteConv(id) {
  if (!getToken()) return;
  try {
    await fetch(`/api/tutor/history/${encodeURIComponent(id)}`, {
      method:  'DELETE',
      headers: authHeaders(),
    });
  } catch { /* non-blocking */ }
}

// ── Conversation management ───────────────────────────────────
function _newConvId() { return 'conv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7); }

function _ensureConv(titleHint) {
  if (!S.convId) S.convId = _newConvId();
  const exists = S.conversations.find(c => c.id === S.convId);
  if (!exists) {
    const conv = {
      id:        S.convId,
      title:     (titleHint || 'Nouvelle conversation').slice(0, 60),
      messages:  [],
      updatedAt: Date.now(),
      createdAt: Date.now(),
    };
    S.conversations.unshift(conv);
    renderSidebar();
  }
}

function _saveCurrentConv() {
  if (!S.convId) return;
  const conv = S.conversations.find(c => c.id === S.convId);
  if (conv) {
    conv.messages  = S.messages.slice(-60).map(m => ({...m, timestamp: Date.now()}));
    conv.updatedAt = Date.now();
    _histSaveConv(conv);
    _serverSaveConv(conv);
    renderSidebar();
  }
}

function startNewConversation() {
  S.convId    = _newConvId();
  S.messages  = [];
  S.loading   = false;
  hideTyping();
  showWelcome();
  // Mark active
  document.querySelectorAll('.leo-history-item').forEach(el => el.classList.remove('active'));
  // Close sidebar on mobile
  if (window.innerWidth <= 768) closeSidebar();
}

function loadConversation(id) {
  const conv = S.conversations.find(c => c.id === id);
  if (!conv) return;

  S.convId   = id;
  S.messages = (conv.messages || []).map(m => ({ role: m.role, content: m.content }));

  const chat = $('leo-chat');
  if (!chat) return;
  chat.innerHTML = '';
  S.messages.forEach(m => addMsg(m.role, m.content));
  if (!S.messages.length) showWelcome();

  renderSidebar();
  if (window.innerWidth <= 768) closeSidebar();
}

function deleteConversation(id) {
  if (!confirm('Supprimer cette conversation ?')) return;
  S.conversations = S.conversations.filter(c => c.id !== id);
  _histDelete(id);
  _serverDeleteConv(id);
  if (S.convId === id) startNewConversation();
  renderSidebar();
}

// ── Sidebar rendering ─────────────────────────────────────────
function _relativeDate(ts) {
  const now  = Date.now();
  const diff = now - ts;
  const day  = 86400000;
  if (diff < day)      return 'Aujourd\'hui';
  if (diff < 2 * day)  return 'Hier';
  if (diff < 7 * day)  return 'Cette semaine';
  return 'Plus ancien';
}

function _timeAgo(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'à l\'instant';
  if (m < 60) return `il y a ${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h}h`;
  const d = Math.floor(h / 24);
  return `il y a ${d}j`;
}

function renderSidebar() {
  const list = $('leo-history-list');
  if (!list) return;

  const q = S.searchQuery.toLowerCase().trim();
  let convs = S.conversations;
  if (q) convs = convs.filter(c => c.title.toLowerCase().includes(q));

  if (!convs.length) {
    list.innerHTML = `<div class="leo-history-empty">${
      q ? 'Aucun résultat.' : 'Tes conversations apparaîtront ici.'
    }</div>`;
    return;
  }

  // Group by relative date
  const groups = {};
  convs.forEach(c => {
    const g = _relativeDate(c.updatedAt || c.createdAt || Date.now());
    if (!groups[g]) groups[g] = [];
    groups[g].push(c);
  });

  const ORDER = ['Aujourd\'hui', 'Hier', 'Cette semaine', 'Plus ancien'];
  let html = '';

  ORDER.forEach(g => {
    if (!groups[g]?.length) return;
    html += `<div class="leo-history-group-label">${g}</div>`;
    groups[g].forEach(c => {
      const active = c.id === S.convId ? ' active' : '';
      const ago    = _timeAgo(c.updatedAt || c.createdAt || Date.now());
      html += `
        <div class="leo-history-item${active}" role="listitem"
             data-id="${c.id}" tabindex="0" aria-label="${c.title}">
          <div class="leo-history-info">
            <div class="leo-history-title">${_esc(c.title)}</div>
            <div class="leo-history-date">${ago}</div>
          </div>
          <button class="leo-history-del" data-del="${c.id}"
                  aria-label="Supprimer cette conversation" title="Supprimer">✕</button>
        </div>`;
    });
  });

  list.innerHTML = html;

  // Wire clicks
  list.querySelectorAll('.leo-history-item').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('.leo-history-del')) return;
      loadConversation(el.dataset.id);
    });
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter') loadConversation(el.dataset.id);
    });
  });
  list.querySelectorAll('.leo-history-del').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      deleteConversation(btn.dataset.del);
    });
  });
}

function _esc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Sidebar toggle ────────────────────────────────────────────
function openSidebar() {
  document.body.classList.add('sidebar-open');
  $('leo-app')?.classList.add('sidebar-open');
}
function closeSidebar() {
  document.body.classList.remove('sidebar-open');
  $('leo-app')?.classList.remove('sidebar-open');
}
function toggleSidebar() {
  if ($('leo-app')?.classList.contains('sidebar-open')) closeSidebar();
  else openSidebar();
}

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Load history
  S.conversations = _histLoad();
  renderSidebar();

  // Start fresh conversation
  S.convId = _newConvId();
  showWelcome();
  loadStats();

  // Composer
  setupComposer();
  setupDragDrop();

  // Sidebar controls
  $('leo-sidebar-toggle')?.addEventListener('click', toggleSidebar);
  $('leo-sidebar-overlay')?.addEventListener('click', closeSidebar);
  $('leo-new-conv')?.addEventListener('click', startNewConversation);

  // Search
  $('leo-search')?.addEventListener('input', e => {
    S.searchQuery = e.target.value;
    renderSidebar();
  });

  // Subject bar close
  $('leo-subject-close')?.addEventListener('click', () => {
    const bar = $('leo-subject-bar');
    if (bar) bar.hidden = true;
  });

  // Media buttons — direct addEventListener, no disabled, no inline handlers
  $('leo-voice-btn')?.addEventListener('click', toggleRecording);
  $('leo-photo-btn')?.addEventListener('click', handlePhoto);
  $('leo-file-btn')?.addEventListener('click',  handleFile);

  // Focus input on desktop
  if (window.innerWidth > 768) $('leo-input')?.focus();
});
