// ============================================================
//  StudyAI — Support Bot Widget v1
//  Floating chat bubble powered by /api/support/chat
// ============================================================
(function () {
  'use strict';

  var SESSION_KEY    = 'studyai_support_session';
  var HISTORY_KEY    = 'studyai_support_history';
  var MAX_HISTORY    = 10;

  var _sessionId     = null;
  var _history       = [];   // { role, content }[]
  var _open          = false;
  var _waiting       = false;
  var _needsHuman    = false;

  var _bubble, _window, _messages, _input, _sendBtn, _suggestions, _escalateBar;

  // ── Init ─────────────────────────────────────────────────
  function _init() {
    _sessionId = sessionStorage.getItem(SESSION_KEY) || _newSession();
    try {
      var raw = sessionStorage.getItem(HISTORY_KEY);
      _history = raw ? JSON.parse(raw) : [];
    } catch (_) { _history = []; }

    _render();
    _bindEvents();

    // Show welcome message if first visit this session
    if (_history.length === 0) {
      _appendBotMsg('Salut ! 👋 Je suis l\'assistant StudyAI. Comment puis-je t\'aider ?');
      _renderSuggestions(['Comment ça marche ?', 'Mon paiement', 'Bug', 'Étudier mieux']);
    } else {
      _rebuildMessages();
    }
  }

  function _newSession() {
    var id = 'sess_' + Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem(SESSION_KEY, id);
    return id;
  }

  // ── DOM ───────────────────────────────────────────────────
  function _render() {
    var container = document.getElementById('support-bot-container');
    if (!container) return;

    container.innerHTML =
      '<button id="support-bubble" aria-label="Ouvrir le chat d\'aide" title="Aide & support">' +
        '💬' +
        '<span class="support-bubble-badge" aria-hidden="true"></span>' +
      '</button>' +
      '<div id="support-window" class="support-hidden" role="dialog" aria-label="Chat support StudyAI" aria-modal="true">' +
        '<div class="support-header">' +
          '<div class="support-header-avatar" aria-hidden="true">⚡</div>' +
          '<div class="support-header-info">' +
            '<div class="support-header-name">StudyAI Helper</div>' +
            '<div class="support-header-status">En ligne</div>' +
          '</div>' +
          '<button class="support-close-btn" id="support-close-btn" aria-label="Fermer le chat">✕</button>' +
        '</div>' +
        '<div class="support-messages" id="support-messages" role="log" aria-live="polite" aria-label="Conversation"></div>' +
        '<div class="support-suggestions" id="support-suggestions"></div>' +
        '<div class="support-input-row">' +
          '<textarea id="support-input" placeholder="Pose ta question…" rows="1" maxlength="1000" aria-label="Message"></textarea>' +
          '<button id="support-send-btn" aria-label="Envoyer">➤</button>' +
        '</div>' +
      '</div>';

    _bubble      = document.getElementById('support-bubble');
    _window      = document.getElementById('support-window');
    _messages    = document.getElementById('support-messages');
    _input       = document.getElementById('support-input');
    _sendBtn     = document.getElementById('support-send-btn');
    _suggestions = document.getElementById('support-suggestions');
  }

  function _bindEvents() {
    if (!_bubble) return;

    _bubble.addEventListener('click', _toggle);
    document.getElementById('support-close-btn').addEventListener('click', _close);

    _sendBtn.addEventListener('click', _send);
    _input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _send(); }
    });
    _input.addEventListener('input', _autoResize);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && _open) _close();
    });
  }

  // ── Open / Close ──────────────────────────────────────────
  function _toggle() { _open ? _close() : _openChat(); }

  function _openChat() {
    _open = true;
    _window.classList.remove('support-hidden');
    _bubble.setAttribute('aria-expanded', 'true');
    _bubble.innerHTML = '✕<span class="support-bubble-badge" aria-hidden="true"></span>';
    setTimeout(function () { _input && _input.focus(); }, 50);
    _scrollBottom();
  }

  function _close() {
    _open = false;
    _window.classList.add('support-hidden');
    _bubble.setAttribute('aria-expanded', 'false');
    _bubble.innerHTML = '💬<span class="support-bubble-badge" aria-hidden="true"></span>';
  }

  // ── Messages ──────────────────────────────────────────────
  function _appendBotMsg(text) {
    var div = document.createElement('div');
    div.className = 'support-msg bot';
    div.innerHTML = '<div class="support-msg-bubble">' + _escHtml(text) + '</div>';
    _messages.appendChild(div);
    _scrollBottom();
  }

  function _appendUserMsg(text) {
    var div = document.createElement('div');
    div.className = 'support-msg user';
    div.innerHTML = '<div class="support-msg-bubble">' + _escHtml(text) + '</div>';
    _messages.appendChild(div);
    _scrollBottom();
  }

  function _showTyping() {
    var el = document.createElement('div');
    el.className = 'support-typing';
    el.id = 'support-typing-indicator';
    el.innerHTML = '<span></span><span></span><span></span>';
    _messages.appendChild(el);
    _scrollBottom();
    return el;
  }

  function _removeTyping() {
    var el = document.getElementById('support-typing-indicator');
    if (el) el.remove();
  }

  function _rebuildMessages() {
    _messages.innerHTML = '';
    _history.forEach(function (m) {
      if (m.role === 'user') _appendUserMsg(m.content);
      else _appendBotMsg(m.content);
    });
  }

  // ── Suggestions ───────────────────────────────────────────
  function _renderSuggestions(items) {
    _suggestions.innerHTML = '';
    items.forEach(function (label) {
      var btn = document.createElement('button');
      btn.className = 'support-suggestion-btn';
      btn.textContent = label;
      btn.addEventListener('click', function () {
        _suggestions.innerHTML = '';
        _sendMessage(label);
      });
      _suggestions.appendChild(btn);
    });
  }

  // ── Escalation bar ────────────────────────────────────────
  function _showEscalateBar() {
    if (document.getElementById('support-escalate-bar')) return;
    var bar = document.createElement('div');
    bar.className = 'support-escalate-bar';
    bar.id = 'support-escalate-bar';
    bar.innerHTML =
      '⚠️ Contacter un humain ?' +
      '<button id="support-escalate-btn">Envoyer un ticket</button>';
    _window.insertBefore(bar, _window.querySelector('.support-input-row'));
    document.getElementById('support-escalate-btn').addEventListener('click', _escalate);
  }

  function _escalate() {
    var problem = '';
    for (var i = _history.length - 1; i >= 0; i--) {
      if (_history[i].role === 'user') { problem = _history[i].content; break; }
    }
    var userEmail = '';
    try {
      var token = localStorage.getItem('studyai_token') || sessionStorage.getItem('studyai_token');
      if (token) {
        var payload = JSON.parse(atob(token.split('.')[1]));
        userEmail = payload.email || '';
      }
    } catch (_) {}

    fetch('/api/support/escalate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: _sessionId, conversationHistory: _history, userEmail: userEmail, problem: problem }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var bar = document.getElementById('support-escalate-bar');
        if (bar) bar.remove();
        _appendBotMsg('Ticket #' + data.ticketId + ' créé ✓ Notre équipe te répondra par email dès que possible.');
      })
      .catch(function () {
        _appendBotMsg('Impossible d\'envoyer le ticket pour l\'instant. Réessaie dans un moment.');
      });
  }

  // ── Send ──────────────────────────────────────────────────
  function _send() {
    if (_waiting) return;
    var text = _input.value.trim();
    if (!text) return;
    _input.value = '';
    _autoResize();
    _sendMessage(text);
  }

  function _sendMessage(text) {
    _suggestions.innerHTML = '';
    _appendUserMsg(text);
    _history.push({ role: 'user', content: text });
    _saveHistory();

    _waiting = true;
    _sendBtn.disabled = true;
    var typing = _showTyping();

    var authToken = '';
    try { authToken = localStorage.getItem('studyai_token') || ''; } catch (_) {}

    fetch('/api/support/chat', {
      method: 'POST',
      headers: Object.assign(
        { 'Content-Type': 'application/json' },
        authToken ? { 'x-auth-token': authToken } : {}
      ),
      body: JSON.stringify({
        message: text,
        sessionId: _sessionId,
        conversationHistory: _history.slice(-10),
      }),
    })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        _removeTyping();
        _waiting = false;
        _sendBtn.disabled = false;

        var reply = data.reply || 'Désolé, je n\'ai pas pu répondre.';
        _appendBotMsg(reply);
        _history.push({ role: 'assistant', content: reply });
        _saveHistory();

        if (data.needsHuman && !_needsHuman) {
          _needsHuman = true;
          _showEscalateBar();
        }

        if (data.suggestions && data.suggestions.length) {
          _renderSuggestions(data.suggestions);
        }
      })
      .catch(function () {
        _removeTyping();
        _waiting = false;
        _sendBtn.disabled = false;
        _appendBotMsg('Une erreur est survenue. Vérifie ta connexion et réessaie.');
      });
  }

  // ── Helpers ───────────────────────────────────────────────
  function _scrollBottom() {
    if (_messages) setTimeout(function () { _messages.scrollTop = _messages.scrollHeight; }, 30);
  }

  function _autoResize() {
    _input.style.height = 'auto';
    _input.style.height = Math.min(_input.scrollHeight, 90) + 'px';
  }

  function _saveHistory() {
    try {
      var trimmed = _history.slice(-MAX_HISTORY);
      _history = trimmed;
      sessionStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
    } catch (_) {}
  }

  function _escHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/\n/g, '<br>');
  }

  // ── Boot ──────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }
}());
