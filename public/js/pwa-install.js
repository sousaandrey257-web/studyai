'use strict';
/* StudyAI — PWA install banner (Android/Chrome) + iOS hint */
(function () {
  var _prompt = null;

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    _prompt = e;
    setTimeout(_showBanner, 2500);
  });

  function _dismissed() {
    try {
      var t = parseInt(localStorage.getItem('pwa_dismissed') || '0', 10);
      return t && (Date.now() - t < 7 * 24 * 60 * 60 * 1000);
    } catch { return false; }
  }

  function _showBanner() {
    if (document.getElementById('pwa-install-banner')) return;
    if (_dismissed()) return;
    if (window.matchMedia('(display-mode: standalone)').matches) return;

    var el = document.createElement('div');
    el.id = 'pwa-install-banner';
    el.className = 'pwa-install-banner';
    el.innerHTML =
      '<div class="pwa-banner-left">' +
        '<div class="pwa-banner-icon">⚡</div>' +
        '<div class="pwa-banner-text">' +
          '<strong>Installer StudyAI</strong>' +
          '<span>Accès rapide depuis ton écran d\'accueil</span>' +
        '</div>' +
      '</div>' +
      '<div class="pwa-banner-btns">' +
        '<button class="pwa-install-btn" id="pwa-btn-ok">Installer</button>' +
        '<button class="pwa-dismiss-btn" id="pwa-btn-no">Plus tard</button>' +
      '</div>';

    document.body.appendChild(el);

    el.querySelector('#pwa-btn-ok').addEventListener('click', function () {
      if (!_prompt) return;
      _prompt.prompt();
      _prompt.userChoice.then(function () { _prompt = null; el.remove(); });
    });

    el.querySelector('#pwa-btn-no').addEventListener('click', function () {
      try { localStorage.setItem('pwa_dismissed', Date.now()); } catch {}
      el.classList.add('pwa-banner-hide');
      setTimeout(function () { el.remove(); }, 350);
    });
  }

  /* iOS: "Add to Home Screen" hint (shown once) */
  var isIOS       = /iphone|ipad|ipod/i.test(navigator.userAgent);
  var isStandalone = window.matchMedia('(display-mode: standalone)').matches;
  if (isIOS && !isStandalone) {
    setTimeout(function () {
      try { if (localStorage.getItem('ios_pwa_seen')) return; } catch {}
      var hint = document.createElement('div');
      hint.className = 'ios-pwa-hint';
      hint.innerHTML =
        '📲 Installe StudyAI : appuie sur <strong>Partager ↑</strong> → <strong>Sur l\'écran d\'accueil</strong>';
      document.body.appendChild(hint);
      setTimeout(function () {
        hint.style.opacity = '0';
        setTimeout(function () { hint.remove(); }, 500);
      }, 6000);
      try { localStorage.setItem('ios_pwa_seen', '1'); } catch {}
    }, 4500);
  }
}());
