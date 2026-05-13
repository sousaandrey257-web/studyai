// ============================================================
//  StudyAI — SFX v1
//  Système sonore Web Audio API (aucun fichier MP3)
//  Sons générés en temps réel via oscillateurs.
//  Activation : window.SFX.toggle() ou clic sur #sfx-toggle-btn
// ============================================================
(function () {
  'use strict';

  var _ctx      = null;
  var _STORE_KEY = 'studyai_sfx';

  // ── Contexte audio (lazy init, résout la politique autoplay) ──
  function _getCtx() {
    if (!_ctx) {
      try {
        _ctx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (_) { return null; }
    }
    if (_ctx.state === 'suspended') _ctx.resume();
    return _ctx;
  }

  function _isOn() {
    try { return localStorage.getItem(_STORE_KEY) !== 'off'; }
    catch (_) { return true; }
  }

  // ── Bip de base ───────────────────────────────────────────────
  // params : { freq, freqEnd?, type?, vol?, duration?, delay? }
  function _beep(params) {
    if (!_isOn()) return;
    var ctx = _getCtx();
    if (!ctx) return;

    var now  = ctx.currentTime + (params.delay || 0) / 1000;
    var dur  = params.duration || 0.12;
    var osc  = ctx.createOscillator();
    var gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = params.type || 'sine';
    osc.frequency.setValueAtTime(params.freq || 440, now);
    if (params.freqEnd) {
      osc.frequency.exponentialRampToValueAtTime(params.freqEnd, now + dur);
    }

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(params.vol || 0.22, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    osc.start(now);
    osc.stop(now + dur + 0.05);
  }

  // ── Sons ──────────────────────────────────────────────────────

  // Bonne réponse : deux notes montantes claires
  function _correct() {
    _beep({ freq: 523, freqEnd: 659, type: 'sine',     vol: 0.2,  duration: 0.11 });
    _beep({ freq: 784,              type: 'sine',     vol: 0.18, duration: 0.13, delay: 110 });
  }

  // Mauvaise réponse : chute grave courte
  function _wrong() {
    _beep({ freq: 220, freqEnd: 110, type: 'triangle', vol: 0.18, duration: 0.22 });
  }

  // Gain XP : chirp montant
  function _xp() {
    _beep({ freq: 440, freqEnd: 880, type: 'sine',     vol: 0.18, duration: 0.11 });
  }

  // Level-up : gamme ascendante C-E-G-C
  function _levelup() {
    var notes = [523, 659, 784, 1047];
    notes.forEach(function (f, i) {
      _beep({ freq: f, type: 'sine', vol: i === 3 ? 0.28 : 0.22,
              duration: i === 3 ? 0.28 : 0.11, delay: i * 135 });
    });
  }

  // Badge débloqué : carillon descendant-montant
  function _badge() {
    [1047, 1319, 1568].forEach(function (f, i) {
      _beep({ freq: f, type: 'sine', vol: i === 2 ? 0.22 : 0.18,
              duration: i === 2 ? 0.22 : 0.09, delay: i * 95 });
    });
  }

  // Streak comeback : note unique chaleureuse
  function _streak() {
    _beep({ freq: 349, freqEnd: 698, type: 'sine', vol: 0.2, duration: 0.28 });
  }

  // ── API publique ──────────────────────────────────────────────
  var SFX = {
    correct:  _correct,
    wrong:    _wrong,
    xp:       _xp,
    levelup:  _levelup,
    badge:    _badge,
    streak:   _streak,

    get enabled() { return _isOn(); },

    toggle: function () {
      var next = !_isOn();
      try { localStorage.setItem(_STORE_KEY, next ? 'on' : 'off'); }
      catch (_) {}
      _updateBtn();
      // Son de confirmation au moment d'activer
      if (next) setTimeout(_xp, 0);
      return next;
    },
  };

  window.SFX = SFX;

  // ── Bouton toggle UI ─────────────────────────────────────────
  function _updateBtn() {
    var btn = document.getElementById('sfx-toggle-btn');
    if (!btn) return;
    btn.textContent  = _isOn() ? '🔊' : '🔇';
    btn.title        = _isOn() ? 'Sons activés — cliquer pour désactiver'
                               : 'Sons désactivés — cliquer pour activer';
    btn.setAttribute('aria-label', btn.title);
    btn.setAttribute('aria-pressed', String(_isOn()));
  }

  document.addEventListener('DOMContentLoaded', function () {
    _updateBtn();
    var btn = document.getElementById('sfx-toggle-btn');
    if (btn) btn.addEventListener('click', function () { SFX.toggle(); _updateBtn(); });
  });
}());
