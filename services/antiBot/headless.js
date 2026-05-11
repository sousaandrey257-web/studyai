'use strict';
// Advanced headless/automation detection via browser signal headers.
// Receives optional signals sent by public/js/fingerprint.js.
// Additive to detector.js score — never hard-blocks alone.
//
// Headers (all optional, sent best-effort by frontend):
//   x-webgl-hash   : 8-char hash of WebGL renderer string
//   x-canvas-hash  : 8-char hash of canvas pixel data
//   x-audio-hash   : 8-char hash of AudioContext output
//   x-webdriver    : 'true' if navigator.webdriver === true
//   x-automation   : 'true' if automation object properties found
//   x-pow-solved   : 'true' when PoW was solved client-side (positive signal)

function scoreHeadlessSignals(req) {
  let score = 0;
  const signals = [];

  const webgl      = req.headers['x-webgl-hash']  || '';
  const canvas     = req.headers['x-canvas-hash'] || '';
  const audio      = req.headers['x-audio-hash']  || '';
  const webdriver  = req.headers['x-webdriver']   || '';
  const automation = req.headers['x-automation']  || '';
  const powSolved  = req.headers['x-pow-solved']  || '';
  const ua         = req.headers['user-agent']     || '';

  // Hard signals (automation properties exposed in DOM)
  if (webdriver  === 'true') { score += 40; signals.push('webdriver_prop'); }
  if (automation === 'true') { score += 30; signals.push('automation_props'); }

  // Soft signals — only meaningful when UA is present (implies a browser)
  if (ua) {
    if (!canvas) { score += 15; signals.push('no_canvas'); }
    if (!webgl)  { score += 10; signals.push('no_webgl'); }
    if (!audio && webgl) { score += 10; signals.push('no_audio_ctx'); }
  }

  // Replay attack: all three hashes identical (copied fingerprint)
  if (webgl && canvas && audio && webgl === canvas) {
    score += 20; signals.push('hash_replay');
  }

  // PoW solved client-side is a weak human signal (reduces score slightly)
  if (powSolved === 'true' && score > 0) score = Math.max(0, score - 10);

  return { headlessScore: Math.min(100, score), signals };
}

// Merge headless signals into an existing { score, reasons } from detector.js.
// headless contributes at 50% weight to avoid over-penalising unusual environments.
function enrichBotScore(baseScore, baseReasons, req) {
  const { headlessScore, signals } = scoreHeadlessSignals(req);
  const combined = Math.min(100, baseScore + Math.round(headlessScore * 0.5));
  return { score: combined, reasons: [...baseReasons, ...signals], isBot: combined >= 95 };
}

// Map enriched score to adaptive response tier
function adaptiveTier(score) {
  if (score >= 90) return 'block';      // hard block
  if (score >= 70) return 'degraded';   // 50% XP
  if (score >= 40) return 'shadow';     // 20% XP
  return 'normal';
}

module.exports = { scoreHeadlessSignals, enrichBotScore, adaptiveTier };
