/* ============================================================
   Léo — Tuteur IA conversationnel
   /leo page
   ============================================================ */
'use strict';

const LEO_STATE = {
  messages:    [],
  loading:     false,
  userLevel:   null,
  subject:     null,
  recording:   false,
  mediaRecorder: null,
  audioChunks: [],
};

// ── Helpers ──────────────────────────────────────────────────

function getCurrentLang() {
  return localStorage.getItem('studyai_lang')
    || document.documentElement.lang
    || 'fr';
}

function getUserLevel() {
  return localStorage.getItem('studyai_user_level') || null;
}

/** Minimal markdown → HTML (bold, italic, code, newlines) */
function formatContent(text) {
  // Escape HTML first to prevent XSS
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  return escaped
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,     '<em>$1</em>')
    .replace(/`([^`]+)`/g,     '<code>$1</code>')
    .replace(/\n/g,            '<br>');
}

// ── Stats ─────────────────────────────────────────────────────

async function loadUserStats() {
  try {
    const token = localStorage.getItem('studyai_token');
    if (!token) return;
    const res = await fetch('/api/gamification', {
      headers: { 'x-auth-token': token },
    });
    if (!res.ok) return;
    const data = await res.json();
    const xpEl  = document.getElementById('leo-xp');
    const lvlEl = document.getElementById('leo-level');
    const strEl = document.getElementById('leo-streak');
    if (xpEl)  xpEl.textContent  = data.xp     ?? 0;
    if (lvlEl) lvlEl.textContent = data.level   ?? 1;
    if (strEl) strEl.textContent = data.streak  ?? 0;
  } catch { /* non-critical */ }
}

// ── Message rendering ─────────────────────────────────────────

function addMessage(role, content, suggestions = []) {
  const chat = document.getElementById('leo-chat');
  if (!chat) return;

  const isBot   = role === 'bot';
  const wrapper = document.createElement('div');
  wrapper.className = `leo-message leo-message-${isBot ? 'bot' : 'user'}`;

  const avatar  = isBot ? '🤖' : '👤';

  let sugHTML = '';
  if (isBot && suggestions.length > 0) {
    const btns = suggestions.map(s =>
      `<button class="leo-suggestion" data-prompt="${s.prompt.replace(/"/g,'&quot;')}">
         ${s.label}
       </button>`
    ).join('');
    sugHTML = `<div class="leo-suggestions" role="list">${btns}</div>`;
  }

  wrapper.innerHTML = `
    <div class="leo-message-avatar" aria-hidden="true">${avatar}</div>
    <div class="leo-message-content">
      ${isBot ? '<div class="leo-message-name">Léo</div>' : ''}
      <div class="leo-message-text">${formatContent(content)}</div>
      ${sugHTML}
    </div>`;

  // Wire suggestion clicks
  wrapper.querySelectorAll('.leo-suggestion').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById('leo-input');
      if (input) input.value = btn.dataset.prompt;
      sendMessage();
    });
  });

  chat.appendChild(wrapper);
  chat.scrollTop = chat.scrollHeight;
}

// ── Typing indicator ─────────────────────────────────────────

function showTyping() {
  const chat = document.getElementById('leo-chat');
  if (!chat || document.getElementById('leo-typing')) return;

  const el = document.createElement('div');
  el.id        = 'leo-typing';
  el.className = 'leo-message leo-message-bot';
  el.setAttribute('aria-label', 'Léo est en train d\'écrire…');
  el.innerHTML = `
    <div class="leo-message-avatar" aria-hidden="true">🤖</div>
    <div class="leo-message-content">
      <div class="leo-typing">
        <span class="leo-typing-dot"></span>
        <span class="leo-typing-dot"></span>
        <span class="leo-typing-dot"></span>
      </div>
    </div>`;
  chat.appendChild(el);
  chat.scrollTop = chat.scrollHeight;
}

function hideTyping() {
  const el = document.getElementById('leo-typing');
  if (el) el.remove();
}

// ── Send message ──────────────────────────────────────────────

async function sendMessage() {
  const input  = document.getElementById('leo-input');
  const sendBtn = document.getElementById('leo-send');
  if (!input || !sendBtn) return;

  const text = input.value.trim();
  if (!text || LEO_STATE.loading) return;

  LEO_STATE.loading = true;
  sendBtn.disabled  = true;

  addMessage('user', text);
  LEO_STATE.messages.push({ role: 'user', content: text });

  input.value        = '';
  input.style.height = 'auto';

  showTyping();

  try {
    const token = localStorage.getItem('studyai_token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['x-auth-token'] = token;

    const res = await fetch('/api/tutor/chat', {
      method:  'POST',
      headers,
      body: JSON.stringify({
        messages:  LEO_STATE.messages,
        lang:      getCurrentLang(),
        userLevel: getUserLevel(),
      }),
    });

    hideTyping();

    if (res.status === 429) {
      addMessage('bot',
        'Tu as atteint la limite de messages pour cette heure. ' +
        'Réessaie dans un moment, ou connecte-toi pour plus de capacité&nbsp;!');
      return;
    }

    if (!res.ok) {
      addMessage('bot', 'Désolé, j\'ai eu un souci. Tu peux réessayer&nbsp;?');
      return;
    }

    const data  = await res.json();
    const reply = data.reply || 'Pas de réponse reçue.';

    addMessage('bot', reply);
    LEO_STATE.messages.push({ role: 'assistant', content: reply });

    // Reload stats non-blocking
    loadUserStats();

  } catch (err) {
    hideTyping();
    addMessage('bot', 'Erreur de connexion. Vérifie ton réseau et réessaie.', []);
    console.error('[Léo] fetch error:', err);
  } finally {
    LEO_STATE.loading = false;
    sendBtn.disabled  = false;
    input.focus();
  }
}

// ── Auto-resize textarea ──────────────────────────────────────

function setupComposer() {
  const input   = document.getElementById('leo-input');
  const sendBtn = document.getElementById('leo-send');
  if (!input || !sendBtn) return;

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  sendBtn.addEventListener('click', sendMessage);
}

// ── Wire initial suggestion buttons ──────────────────────────

function setupInitialSuggestions() {
  document.querySelectorAll('.leo-suggestion').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById('leo-input');
      if (input) input.value = btn.dataset.prompt || '';
      sendMessage();
    });
  });
}

// ── Upload helper ─────────────────────────────────────────────

function _authHeaders() {
  const token = localStorage.getItem('studyai_token');
  return token ? { 'x-auth-token': token } : {};
}

async function _uploadToLeo(endpoint, formData, userMessage) {
  if (LEO_STATE.loading) return;

  // Show what the user sent
  addMessage('user', userMessage);
  showTyping();
  LEO_STATE.loading = true;

  try {
    const res = await fetch(endpoint, {
      method:  'POST',
      headers: _authHeaders(),
      body:    formData,
    });

    hideTyping();

    if (res.status === 429) {
      addMessage('bot', 'Tu as atteint la limite d\'uploads pour cette heure. Réessaie plus tard&nbsp;!');
      return;
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      addMessage('bot', `Désolé, je n'ai pas pu traiter ce fichier : ${err.error || 'erreur inconnue'}`);
      return;
    }

    const data = await res.json();
    const extractedText = data.text || '';

    if (!extractedText.trim()) {
      addMessage('bot', 'Je n\'ai pas pu lire le contenu. Essaie avec un autre fichier&nbsp;?');
      return;
    }

    // Push extracted content as user context then ask Leo to analyse
    const contextMsg = { role: 'user', content: extractedText.slice(0, 3000) };
    LEO_STATE.messages.push(contextMsg);

    // Now ask Leo to react to the content
    const lang = getCurrentLang();
    const chatRes = await fetch('/api/tutor/chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', ..._authHeaders() },
      body: JSON.stringify({
        messages:  LEO_STATE.messages,
        lang,
        userLevel: getUserLevel(),
      }),
    });

    if (!chatRes.ok) {
      addMessage('bot', 'Contenu reçu, mais je n\'ai pas pu l\'analyser. Réessaie&nbsp;?');
      return;
    }

    const chatData = await chatRes.json();
    const reply    = chatData.reply || 'Pas de réponse.';
    addMessage('bot', reply);
    LEO_STATE.messages.push({ role: 'assistant', content: reply });
    loadUserStats();

  } catch (e) {
    hideTyping();
    addMessage('bot', 'Erreur de connexion. Vérifie ton réseau.');
    console.error('[Léo upload]', e);
  } finally {
    LEO_STATE.loading = false;
    const sendBtn = document.getElementById('leo-send');
    if (sendBtn) sendBtn.disabled = false;
  }
}

// ── 🎤 Voice recording ────────────────────────────────────────

function _setVoiceBtn(recording) {
  const btn = document.getElementById('leo-voice-btn');
  if (!btn) return;
  btn.textContent = recording ? '⏹️' : '🎤';
  btn.title       = recording ? 'Arrêter l\'enregistrement' : 'Enregistrer (cliquer pour démarrer/arrêter)';
  btn.classList.toggle('leo-recording', recording);
}

async function toggleRecording() {
  if (LEO_STATE.recording) {
    // Stop — onstop will handle the upload
    if (LEO_STATE.mediaRecorder && LEO_STATE.mediaRecorder.state !== 'inactive') {
      LEO_STATE.mediaRecorder.stop();
    }
    LEO_STATE.recording = false;
    _setVoiceBtn(false);
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    addMessage('bot', 'Ton navigateur ne supporte pas l\'enregistrement audio. Essaie Chrome ou Firefox&nbsp;!');
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    LEO_STATE.audioChunks  = [];
    LEO_STATE.mediaRecorder = new MediaRecorder(stream);

    LEO_STATE.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) LEO_STATE.audioChunks.push(e.data);
    };

    LEO_STATE.mediaRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(LEO_STATE.audioChunks, { type: 'audio/webm' });
      if (blob.size < 1000) {
        addMessage('bot', 'Enregistrement trop court. Parle un peu plus longtemps&nbsp;!');
        return;
      }
      const fd = new FormData();
      fd.append('audio', blob, 'recording.webm');
      fd.append('lang', getCurrentLang());
      _uploadToLeo('/api/tutor/voice', fd, '🎤 Message vocal envoyé…');
    };

    LEO_STATE.mediaRecorder.start();
    LEO_STATE.recording = true;
    _setVoiceBtn(true);

  } catch (err) {
    const msg = err.name === 'NotAllowedError'
      ? 'Accès au micro refusé. Autorise le micro dans les paramètres du navigateur.'
      : 'Impossible d\'accéder au micro : ' + err.message;
    addMessage('bot', msg);
  }
}

// ── 📷 Image upload ───────────────────────────────────────────

function handlePhotoUpload() {
  const input = document.getElementById('leo-photo-input');
  if (!input) return;
  input.value = '';
  input.onchange = () => {
    const file = input.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      addMessage('bot', 'Image trop volumineuse (max 5 MB). Compresse-la et réessaie&nbsp;!');
      return;
    }
    const fd = new FormData();
    fd.append('image', file);
    fd.append('lang', getCurrentLang());
    _uploadToLeo('/api/tutor/vision', fd, `📷 Image envoyée : ${file.name}`);
  };
  input.click();
}

// ── 📎 File (PDF / TXT) upload ────────────────────────────────

function handleFileUpload() {
  const input = document.getElementById('leo-file-input');
  if (!input) return;
  input.value = '';
  input.onchange = () => {
    const file = input.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      addMessage('bot', 'Fichier trop volumineux (max 10 MB).');
      return;
    }
    const fd = new FormData();
    fd.append('file', file);
    _uploadToLeo('/api/tutor/file', fd, `📎 Fichier envoyé : ${file.name}`);
  };
  input.click();
}

// ── Setup media buttons ───────────────────────────────────────

function setupMediaButtons() {
  const voiceBtn = document.getElementById('leo-voice-btn');
  const photoBtn = document.getElementById('leo-photo-btn');
  const fileBtn  = document.getElementById('leo-file-btn');

  if (voiceBtn) voiceBtn.addEventListener('click', toggleRecording);
  if (photoBtn) photoBtn.addEventListener('click', handlePhotoUpload);
  if (fileBtn)  fileBtn.addEventListener('click',  handleFileUpload);
}

// ── Init ──────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  loadUserStats();
  setupComposer();
  setupInitialSuggestions();
  setupMediaButtons();

  // Focus input on desktop
  const input = document.getElementById('leo-input');
  if (input && window.innerWidth > 640) input.focus();
});
