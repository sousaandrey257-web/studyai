'use strict';
/* ============================================================
   StudyAI — Audio / Podcast Mode  (Sprint 3)
   Uses Web Speech API — zero dependencies, zero backend calls.
   Works on upload.html results AND index.html results.
   ============================================================ */
(function () {
  if (!window.speechSynthesis) return; // not supported

  var synth   = window.speechSynthesis;
  var _state  = { playing: false, utt: null, rate: 1, playerEl: null };

  /* ── Inject "🎵 Écouter" button in the results header ── */
  function _tryInject() {
    /* upload.html: .results-header */
    var header = document.querySelector('.results-header .results-actions') ||
                 document.querySelector('.results-header');
    /* index.html: .result-card-header of summary */
    var cardHeader = document.querySelector('#tab-summary .result-card-header');

    var target = header || cardHeader;
    if (!target || target.querySelector('.audio-study-btn')) return;

    var btn = document.createElement('button');
    btn.className = 'audio-study-btn btn-secondary-small';
    btn.innerHTML = '🎵 Écouter';
    btn.title = 'Mode podcast — écoute ton cours en audio';
    btn.addEventListener('click', _onListen);
    target.appendChild(btn);
  }

  /* ── Gather readable text from the page ── */
  function _getText() {
    var parts = [];

    /* upload.html sources */
    var exec     = document.getElementById('sum-executive');
    var sections = document.getElementById('sum-sections');
    var memo     = document.getElementById('memo-content');
    var title    = document.getElementById('res-title');

    if (title?.textContent.trim())    parts.push('Pack d\'étude : ' + title.textContent.trim() + '.');
    if (exec?.textContent.trim())     parts.push(exec.textContent.trim());
    if (sections?.textContent.trim()) parts.push(sections.textContent.trim());
    if (memo?.textContent.trim())     parts.push('Mémo express : ' + memo.textContent.trim());

    /* index.html source */
    var summaryText = document.getElementById('summary-text');
    if (summaryText?.textContent.trim()) {
      parts.push('Résumé de ton cours. ' + summaryText.textContent.trim());
    }

    var raw = parts.join(' ').replace(/\s+/g, ' ').trim();

    /* Add podcast-style wrapper */
    if (!raw) return '';
    return 'Bienvenue sur StudyAI. ' + raw + ' Fin du résumé. Bonne révision !';
  }

  /* ── Start / stop player ── */
  function _onListen() {
    if (_state.playing) { _stop(); return; }
    var text = _getText();
    if (!text) { alert('Aucun contenu disponible à lire.'); return; }
    _start(text);
  }

  function _start(text) {
    synth.cancel();
    var utt = new SpeechSynthesisUtterance(text);
    utt.lang = document.documentElement.lang || 'fr-FR';
    utt.rate = _state.rate;
    utt.pitch = 1;

    utt.onstart = function () {
      _state.playing = true;
      _updatePlayer();
    };
    utt.onend = utt.onerror = function () {
      _state.playing = false;
      _updatePlayer();
    };

    _state.utt = utt;
    synth.speak(utt);
    _state.playing = true;
    _showPlayer();
  }

  function _stop() {
    synth.cancel();
    _state.playing = false;
    _updatePlayer();
  }

  /* ── Floating player UI ── */
  function _showPlayer() {
    if (_state.playerEl) { _updatePlayer(); return; }

    var p = document.createElement('div');
    p.id = 'audio-player';
    p.className = 'audio-player';
    p.innerHTML =
      '<div class="audio-player-left">' +
        '<div class="audio-player-icon">🎵</div>' +
        '<div class="audio-player-info">' +
          '<span class="audio-player-title">Mode Podcast</span>' +
          '<span class="audio-player-sub">Lecture en cours…</span>' +
        '</div>' +
      '</div>' +
      '<div class="audio-player-controls">' +
        '<button class="audio-ctrl-btn" id="audio-btn-playpause">⏸</button>' +
        '<div class="audio-speed-btns">' +
          '<button class="audio-speed-btn' + (_state.rate === 0.8 ? ' active' : '') + '" data-rate="0.8">0.8×</button>' +
          '<button class="audio-speed-btn' + (_state.rate === 1   ? ' active' : '') + '" data-rate="1">1×</button>' +
          '<button class="audio-speed-btn' + (_state.rate === 1.25? ' active' : '') + '" data-rate="1.25">1.25×</button>' +
          '<button class="audio-speed-btn' + (_state.rate === 1.5 ? ' active' : '') + '" data-rate="1.5">1.5×</button>' +
        '</div>' +
        '<button class="audio-ctrl-btn audio-close-btn" id="audio-btn-close">✕</button>' +
      '</div>';

    document.body.appendChild(p);
    _state.playerEl = p;

    p.querySelector('#audio-btn-playpause').addEventListener('click', function () {
      if (_state.playing) { synth.pause(); _state.playing = false; }
      else { synth.resume(); _state.playing = true; }
      _updatePlayer();
    });

    p.querySelector('#audio-btn-close').addEventListener('click', function () {
      _stop();
      p.remove();
      _state.playerEl = null;
    });

    p.querySelectorAll('.audio-speed-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        _state.rate = parseFloat(this.getAttribute('data-rate'));
        p.querySelectorAll('.audio-speed-btn').forEach(function (b) { b.classList.remove('active'); });
        this.classList.add('active');
        /* Restart at new speed */
        if (_state.utt) {
          var remaining = _getText(); /* simplification: restart from beginning */
          _start(remaining);
        }
      });
    });
  }

  function _updatePlayer() {
    if (!_state.playerEl) return;
    var pp = _state.playerEl.querySelector('#audio-btn-playpause');
    if (pp) pp.textContent = _state.playing ? '⏸' : '▶';
    var sub = _state.playerEl.querySelector('.audio-player-sub');
    if (sub) sub.textContent = _state.playing ? 'Lecture en cours…' : 'En pause';
  }

  /* ── Watch for results sections becoming visible ── */
  function _watchResults() {
    /* upload.html — section-results */
    var uploadResults = document.getElementById('section-results');
    if (uploadResults) {
      new MutationObserver(function () {
        if (!uploadResults.classList.contains('hidden')) setTimeout(_tryInject, 300);
      }).observe(uploadResults, { attributes: true, attributeFilter: ['class'] });
    }

    /* index.html — tab-summary content */
    var indexSummary = document.getElementById('tab-summary');
    if (indexSummary) {
      new MutationObserver(function () {
        if (indexSummary.classList.contains('active')) setTimeout(_tryInject, 300);
      }).observe(indexSummary, { attributes: true, attributeFilter: ['class'] });
    }

    /* Also try immediately (in case results already visible) */
    setTimeout(_tryInject, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _watchResults);
  } else {
    _watchResults();
  }

}());
