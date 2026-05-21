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

  // Per-language UI strings (welcome, suggestions, status)
  var _UI = {
    fr:    { welcome: 'Salut ! 👋 Je suis Studio, l\'assistant StudyAI. Comment puis-je t\'aider ?', status: 'En ligne',     suggest: ['Comment ça marche ?', 'Tarifs', 'Bug', 'Mieux réviser'],      escalate: '⚠️ Parler à un humain ?',         ticket: 'Envoyer un ticket',    error: 'Une erreur est survenue. Vérifie ta connexion.' },
    en:    { welcome: 'Hi! 👋 I\'m Studio, the StudyAI assistant. How can I help you?',             status: 'Online',       suggest: ['How does it work?', 'Pricing', 'Bug', 'Study tips'],            escalate: '⚠️ Talk to a human?',             ticket: 'Send a ticket',        error: 'An error occurred. Check your connection.' },
    es:    { welcome: '¡Hola! 👋 Soy Studio, el asistente de StudyAI. ¿En qué puedo ayudarte?',   status: 'En línea',     suggest: ['¿Cómo funciona?', 'Precios', 'Error', 'Estudiar mejor'],       escalate: '⚠️ ¿Hablar con una persona?',     ticket: 'Enviar ticket',        error: 'Ocurrió un error. Verifica tu conexión.' },
    de:    { welcome: 'Hallo! 👋 Ich bin Studio, der StudyAI-Assistent. Wie kann ich dir helfen?', status: 'Online',       suggest: ['Wie funktioniert es?', 'Preise', 'Fehler', 'Besser lernen'],   escalate: '⚠️ Mit einer Person sprechen?',   ticket: 'Ticket senden',        error: 'Ein Fehler ist aufgetreten. Prüfe deine Verbindung.' },
    pt:    { welcome: 'Olá! 👋 Sou o Studio, o assistente do StudyAI. Como posso ajudar-te?',      status: 'Online',       suggest: ['Como funciona?', 'Preços', 'Bug', 'Estudar melhor'],           escalate: '⚠️ Falar com uma pessoa?',        ticket: 'Enviar ticket',        error: 'Ocorreu um erro. Verifica a tua ligação.' },
    it:    { welcome: 'Ciao! 👋 Sono Studio, l\'assistente di StudyAI. Come posso aiutarti?',      status: 'Online',       suggest: ['Come funziona?', 'Prezzi', 'Bug', 'Studiare meglio'],          escalate: '⚠️ Parlare con una persona?',     ticket: 'Invia ticket',         error: 'Si è verificato un errore. Controlla la connessione.' },
    zh:    { welcome: '你好！👋 我是 Studio，StudyAI 的助手。有什么可以帮您的？',                   status: '在线',          suggest: ['怎么使用？', '价格', '报告错误', '学习技巧'],                  escalate: '⚠️ 联系人工客服？',                ticket: '发送工单',              error: '发生错误，请检查网络连接。' },
    ja:    { welcome: 'こんにちは！👋 StudyAI のアシスタント Studio です。お手伝いできますか？',     status: 'オンライン',    suggest: ['使い方は？', '料金', 'バグ報告', '学習のコツ'],                 escalate: '⚠️ 担当者に連絡？',               ticket: 'チケット送信',          error: 'エラーが発生しました。接続を確認してください。' },
    ko:    { welcome: '안녕하세요! 👋 저는 StudyAI 어시스턴트 Studio입니다. 어떻게 도와드릴까요?', status: '온라인',        suggest: ['어떻게 사용하나요?', '요금제', '버그 신고', '공부 팁'],        escalate: '⚠️ 담당자에게 연결?',             ticket: '티켓 보내기',           error: '오류가 발생했습니다. 연결을 확인하세요.' },
    id:    { welcome: 'Halo! 👋 Saya Studio, asisten StudyAI. Ada yang bisa saya bantu?',          status: 'Online',       suggest: ['Cara kerja?', 'Harga', 'Bug', 'Tips belajar'],                  escalate: '⚠️ Bicara dengan manusia?',       ticket: 'Kirim tiket',          error: 'Terjadi kesalahan. Periksa koneksimu.' },
    ar:    { welcome: 'مرحباً! 👋 أنا Studio، مساعد StudyAI. كيف يمكنني مساعدتك؟',               status: 'متصل',          suggest: ['كيف يعمل؟', 'الأسعار', 'إبلاغ عن خطأ', 'نصائح الدراسة'],    escalate: '⚠️ التحدث مع شخص؟',              ticket: 'إرسال تذكرة',          error: 'حدث خطأ. تحقق من اتصالك.' },
    th:    { welcome: 'สวัสดี! 👋 ฉันคือ Studio ผู้ช่วย StudyAI มีอะไรให้ช่วยไหม?',              status: 'ออนไลน์',       suggest: ['วิธีใช้งาน?', 'ราคา', 'รายงานบัก', 'เคล็ดลับการเรียน'],     escalate: '⚠️ คุยกับเจ้าหน้าที่?',          ticket: 'ส่งตั๋ว',               error: 'เกิดข้อผิดพลาด ตรวจสอบการเชื่อมต่อ' },
    tr:    { welcome: 'Merhaba! 👋 Ben Studio, StudyAI asistanı. Nasıl yardımcı olabilirim?',      status: 'Çevrimiçi',    suggest: ['Nasıl çalışır?', 'Fiyatlar', 'Hata bildir', 'Çalışma ipuçları'], escalate: '⚠️ İnsan ile konuş?',            ticket: 'Ticket gönder',        error: 'Bir hata oluştu. Bağlantını kontrol et.' },
    nl:    { welcome: 'Hoi! 👋 Ik ben Studio, de StudyAI-assistent. Hoe kan ik je helpen?',       status: 'Online',       suggest: ['Hoe werkt het?', 'Prijzen', 'Bug melden', 'Studeertips'],      escalate: '⚠️ Met een persoon praten?',      ticket: 'Ticket sturen',        error: 'Er is een fout opgetreden. Controleer je verbinding.' },
    ru:    { welcome: 'Привет! 👋 Я Studio, ассистент StudyAI. Чем могу помочь?',                 status: 'Онлайн',        suggest: ['Как это работает?', 'Цены', 'Ошибка', 'Советы по учёбе'],    escalate: '⚠️ Поговорить с человеком?',      ticket: 'Отправить тикет',      error: 'Произошла ошибка. Проверь соединение.' },
    pl:    { welcome: 'Cześć! 👋 Jestem Studio, asystentem StudyAI. Jak mogę ci pomóc?',          status: 'Online',       suggest: ['Jak to działa?', 'Ceny', 'Błąd', 'Wskazówki do nauki'],       escalate: '⚠️ Porozmawiać z człowiekiem?',   ticket: 'Wyślij zgłoszenie',    error: 'Wystąpił błąd. Sprawdź połączenie.' },
    vi:    { welcome: 'Xin chào! 👋 Tôi là Studio, trợ lý của StudyAI. Tôi có thể giúp gì?',    status: 'Trực tuyến',   suggest: ['Cách hoạt động?', 'Giá cả', 'Báo lỗi', 'Mẹo học tập'],      escalate: '⚠️ Nói chuyện với người thật?',   ticket: 'Gửi yêu cầu',         error: 'Đã xảy ra lỗi. Kiểm tra kết nối.' },
    hi:    { welcome: 'नमस्ते! 👋 मैं Studio हूँ, StudyAI का सहायक। कैसे मदद कर सकता हूँ?',     status: 'ऑनलाइन',       suggest: ['यह कैसे काम करता है?', 'कीमत', 'बग रिपोर्ट', 'पढ़ाई के टिप्स'], escalate: '⚠️ किसी व्यक्ति से बात करें?', ticket: 'टिकट भेजें',           error: 'त्रुटि हुई। अपना कनेक्शन जाँचें।' },
    'pt-BR': { welcome: 'Olá! 👋 Sou o Studio, assistente do StudyAI. Como posso ajudar?',        status: 'Online',       suggest: ['Como funciona?', 'Preços', 'Bug', 'Dicas de estudo'],           escalate: '⚠️ Falar com uma pessoa?',        ticket: 'Enviar ticket',        error: 'Ocorreu um erro. Verifique sua conexão.' },
    uk:    { welcome: 'Привіт! 👋 Я Studio, асистент StudyAI. Чим можу допомогти?',               status: 'Онлайн',        suggest: ['Як це працює?', 'Ціни', 'Помилка', 'Поради з навчання'],     escalate: '⚠️ Поговорити з людиною?',        ticket: 'Надіслати тікет',      error: 'Сталася помилка. Перевір з\'єднання.' },
  };

  function _getLang() {
    try { return localStorage.getItem('lang') || 'fr'; } catch (_) { return 'fr'; }
  }
  function _ui() { return _UI[_getLang()] || _UI['fr']; }

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
      _appendBotMsg(_ui().welcome);
      _renderSuggestions(_ui().suggest);
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
            '<div class="support-header-status" id="support-header-status">En ligne</div>' +
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

    // Set status label in current language
    var statusEl = document.getElementById('support-header-status');
    if (statusEl) statusEl.textContent = _ui().status;
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
      _ui().escalate +
      '<button id="support-escalate-btn">' + _ui().ticket + '</button>';
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
        _appendBotMsg('🎫 #' + data.ticketId + ' ✓');
      })
      .catch(function () {
        _appendBotMsg('❌');
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
        language: _getLang(),
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

        var reply = data.reply || _ui().welcome;
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
        _appendBotMsg('❌ ' + _ui().error);
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
