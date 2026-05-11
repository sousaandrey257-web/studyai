// Proof-of-Work client — invisible friction for bots.
// Pre-solves a server challenge in the background using SubtleCrypto.
// Exposes window.getPowHeader() used by auth.js before register/login.

(function () {
  'use strict';

  let _pending = null; // { challengeId, nonce } — ready to attach

  async function sha256hex(str) {
    const buf  = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function solve(prefix, difficulty) {
    const target = '0'.repeat(difficulty);
    // Yield to event loop every 200 iterations to keep UI responsive
    for (let n = 0; n < 2_000_000; n++) {
      if (n % 200 === 0) await new Promise(r => setTimeout(r, 0));
      const hash = await sha256hex(prefix + n);
      if (hash.startsWith(target)) return String(n);
    }
    return null; // give up after 2M attempts
  }

  async function prefetch() {
    try {
      const res = await fetch('/api/challenge', { cache: 'no-store' });
      if (!res.ok) return;
      const { challengeId, prefix, difficulty } = await res.json();
      const nonce = await solve(prefix, difficulty);
      if (nonce) _pending = { challengeId, nonce };
    } catch {}
  }

  // Called by auth.js _clientHints() — returns header object, clears pending & pre-fetches next
  window.getPowHeader = function () {
    if (!_pending) return {};
    const header = { 'x-pow-solution': `${_pending.challengeId}:${_pending.nonce}`, 'x-pow-solved': 'true' };
    _pending = null;
    prefetch(); // kick off next solve so it's ready for the next form submission
    return header;
  };

  // Start solving on page load (background, non-blocking)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', prefetch);
  } else {
    prefetch();
  }
})();
