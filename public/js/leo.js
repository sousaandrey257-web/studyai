/* ============================================================
   Léo — Tuteur IA conversationnel
   /leo page
   ============================================================ */
'use strict';

const LEO_STATE = {
  messages:  [],
  loading:   false,
  userLevel: null,
  subject:   null,
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

// ── Init ──────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  loadUserStats();
  setupComposer();
  setupInitialSuggestions();

  // Focus input on desktop
  const input = document.getElementById('leo-input');
  if (input && window.innerWidth > 640) input.focus();
});
