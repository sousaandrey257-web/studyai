// Browser signal collector — sends headless/automation detection signals as request headers.
// All signals are best-effort; missing signals are handled gracefully server-side.
// Collected ONCE on page load; stored in window._fpSignals for auth.js to include.

(function () {
  'use strict';

  async function sha8(str) {
    try {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 8);
    } catch { return ''; }
  }

  async function collect() {
    const signals = {};

    // Webdriver / automation property detection
    try {
      signals['x-webdriver']  = String(!!navigator.webdriver);
      const automation = !!(window._phantom || window.__nightmare || window.callPhantom ||
        window._selenium || window.domAutomation || window.__webdriverFunc);
      signals['x-automation'] = String(automation);
    } catch {}

    // WebGL renderer hash
    try {
      const canvas = document.createElement('canvas');
      const gl     = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (gl) {
        const dbg      = gl.getExtension('WEBGL_debug_renderer_info');
        const renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
        signals['x-webgl-hash'] = await sha8(renderer || '');
      }
    } catch {}

    // Canvas pixel data hash (font/rendering fingerprint)
    try {
      const canvas  = document.createElement('canvas');
      canvas.width  = 200; canvas.height = 50;
      const ctx     = canvas.getContext('2d');
      ctx.fillStyle = '#f0f0f0'; ctx.fillRect(0, 0, 200, 50);
      ctx.fillStyle = '#333'; ctx.font = '14px Arial';
      ctx.fillText('StudyAI fingerprint 🎯', 10, 30);
      signals['x-canvas-hash'] = await sha8(canvas.toDataURL());
    } catch {}

    // AudioContext fingerprint
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        const ac   = new AudioCtx();
        const osc  = ac.createOscillator();
        const dest = ac.createMediaStreamDestination();
        osc.connect(dest);
        osc.type = 'triangle'; osc.frequency.setValueAtTime(440, ac.currentTime);
        osc.start();
        await new Promise(r => setTimeout(r, 50));
        osc.stop();
        await ac.close();
        signals['x-audio-hash'] = await sha8(String(ac.sampleRate));
      }
    } catch {}

    // Mouse entropy — accumulated after first interaction
    let _mousePoints = [];
    function _onMove(e) {
      _mousePoints.push([e.clientX, e.clientY]);
      if (_mousePoints.length > 50) document.removeEventListener('mousemove', _onMove);
    }
    document.addEventListener('mousemove', _onMove, { passive: true });

    window._fpSignals = signals;
    window._getMouseEntropy = function () {
      if (_mousePoints.length < 5) return '';
      const diffs = [];
      for (let i = 1; i < _mousePoints.length; i++) {
        const dx = _mousePoints[i][0] - _mousePoints[i-1][0];
        const dy = _mousePoints[i][1] - _mousePoints[i-1][1];
        diffs.push(Math.sqrt(dx * dx + dy * dy));
      }
      const mean = diffs.reduce((s, d) => s + d, 0) / diffs.length;
      const vari = diffs.reduce((s, d) => s + (d - mean) ** 2, 0) / diffs.length;
      const cv   = mean > 0 ? Math.sqrt(vari) / mean : 0;
      return cv.toFixed(3);
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', collect);
  } else {
    collect();
  }
})();
