// ============================================================
//  StudyAI Service Worker — PWA offline support + asset cache
//  Strategy:
//    - Versioned static assets (CSS/JS)  → Cache-first
//    - Unversioned assets (images, fonts) → Stale-while-revalidate
//    - Navigation requests (HTML pages)  → Network-first, offline fallback
//    - /api/* routes                     → Network-only (never cache)
// ============================================================

const CACHE_VERSION = 'studyai-v6';
const STATIC_CACHE  = `${CACHE_VERSION}-static`;
const FONT_CACHE    = `${CACHE_VERSION}-fonts`;
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
  '/js/perf.js?v=1',
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
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

// ── Activate: clean up old caches ────────────────────────────
self.addEventListener('activate', event => {
  const validCaches = [STATIC_CACHE, FONT_CACHE];
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => !validCaches.includes(k)).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: route-based strategy ───────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Never intercept non-GET, cross-origin, or /api/
  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // 2. Navigation requests (HTML pages) → network-first, offline fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }

  // 3. Versioned assets (URL contains ?v=) → cache-first (they're immutable by version)
  if (url.search.includes('v=')) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          if (!response || response.status !== 200 || response.type !== 'basic') return response;
          const clone = response.clone();
          caches.open(STATIC_CACHE).then(cache => cache.put(request, clone));
          return response;
        }).catch(() => null);
      })
    );
    return;
  }

  // 4. Fonts → stale-while-revalidate (cached but refreshed in background)
  if (url.pathname.match(/\.(woff2?|ttf|otf)$/)) {
    event.respondWith(
      caches.open(FONT_CACHE).then(cache =>
        cache.match(request).then(cached => {
          const fetchPromise = fetch(request).then(response => {
            if (response && response.status === 200) cache.put(request, response.clone());
            return response;
          }).catch(() => null);
          return cached || fetchPromise;
        })
      )
    );
    return;
  }

  // 5. Other static assets → cache-first, then network
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (!response || response.status !== 200 || response.type !== 'basic') return response;
        const clone = response.clone();
        caches.open(STATIC_CACHE).then(cache => cache.put(request, clone));
        return response;
      }).catch(() => null);
    })
  );
});
