// ============================================================
//  StudyAI Service Worker — PWA offline support + asset cache
//  Strategy:
//    - Static assets (CSS/JS/fonts) → Cache-first
//    - Navigation requests         → Network-first, offline fallback
//    - /api/* routes               → Network-only (never cache)
// ============================================================

const CACHE_VERSION = 'studyai-v5';
const OFFLINE_URL   = '/offline.html';

const PRECACHE_URLS = [
  '/',
  '/offline.html',
  '/css/style.css',
  '/css/app.css?v=5',
  '/css/upload.css',
  '/css/brain.css',
  '/css/battle.css',
  '/css/gamification.css',
  '/css/premium.css',
  '/js/fingerprint.js',
  '/js/pow.js',
  '/js/i18n.js',
  '/js/auth.js?v=5',
  '/js/app.js?v=16',
  '/js/workspace.js?v=5',
  '/js/upload.js?v=5',
  '/js/brain.js?v=5',
  '/js/battle.js?v=5',
  '/manifest.json',
  '/icons/icon.svg',
];

// ── Install: pre-cache critical assets ───────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()) // don't block install if a precache file is missing
  );
});

// ── Activate: clean up old caches ────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: route-based strategy ───────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Never intercept non-GET or cross-origin or /api/
  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // 2. Navigation requests (HTML pages) → network-first, offline fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }

  // 3. Static assets → cache-first, then network
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        // Only cache successful same-origin responses
        if (!response || response.status !== 200 || response.type !== 'basic') return response;
        const clone = response.clone();
        caches.open(CACHE_VERSION).then(cache => cache.put(request, clone));
        return response;
      }).catch(() => null);
    })
  );
});
