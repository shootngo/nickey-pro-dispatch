/* =============================================================================
 * Nickey Dispatch — Service Worker
 * Cache version: bump CACHE_VERSION to force cache refresh on next visit.
 * Strategy:
 *   App shell (HTML/CSS/JS/icons) → Cache-first, stale-while-revalidate
 *   Google Fonts CSS              → Cache-first, 24-hour TTL
 *   Google Fonts files (.woff2)   → Cache-first, permanent
 *   Gemini / Drive / OAuth APIs   → Network-only (never cached)
 * ============================================================================= */

'use strict';

const CACHE_VERSION = 'nickey-v8.1';
const CACHE_NAME    = 'nickey-shell-' + CACHE_VERSION;
const FONT_CACHE    = 'nickey-fonts-' + CACHE_VERSION;

// App shell — all files needed to load the UI offline
const PRECACHE_URLS = [
  './',
  './index.html',
  './earnings.html',
  './inspection.html',
  './intermodal.html',
  './sds.html',
  './nickey-shared.css',
  './nickey-shared.js',
  './ndsync.js',
  './manifest.json',
  './icon-192.png',
  './icon-512-2.png'
];

// API origins that must NEVER be served from cache
const NETWORK_ONLY_ORIGINS = [
  'generativelanguage.googleapis.com',
  'oauth2.googleapis.com',
  'accounts.google.com',
  'www.googleapis.com'
];

// ── INSTALL: precache app shell ───────────────────────────────────────────────
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(PRECACHE_URLS);
    }).then(function() {
      console.log('[SW] App shell precached:', CACHE_NAME);
    }).catch(function(err) {
      console.error('[SW] Precache failed:', err);
    })
  );
  // Don't skipWaiting here — new SW waits until user taps update banner
});

// ── ACTIVATE: delete stale caches ────────────────────────────────────────────
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) {
          // Delete any cache whose name starts with our prefix but isn't current
          return (key.startsWith('nickey-shell-') || key.startsWith('nickey-fonts-'))
              && key !== CACHE_NAME && key !== FONT_CACHE;
        }).map(function(key) {
          console.log('[SW] Deleting old cache:', key);
          return caches.delete(key);
        })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// ── MESSAGE: skipWaiting on demand (triggered by update banner) ───────────────
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('[SW] skipWaiting requested');
    self.skipWaiting();
  }
});

// ── FETCH: routing logic ──────────────────────────────────────────────────────
self.addEventListener('fetch', function(event) {
  const req = event.request;
  const url = new URL(req.url);

  // Ignore non-http(s) requests (chrome-extension://, data:, etc.)
  if (!url.protocol.startsWith('http')) return;

  // Network-only: API calls that require a live connection
  if (NETWORK_ONLY_ORIGINS.includes(url.hostname)) {
    event.respondWith(fetch(req));
    return;
  }

  // Google Fonts CSS — cache-first with 24h max-age network refresh
  if (url.hostname === 'fonts.googleapis.com') {
    event.respondWith(handleFontCSS(req));
    return;
  }

  // Google Fonts files — cache-first, permanent (font binaries are immutable)
  if (url.hostname === 'fonts.gstatic.com') {
    event.respondWith(handleFontFile(req));
    return;
  }

  // App shell — cache-first, serve cached then refresh in background
  event.respondWith(handleAppShell(req));
});

// ── CACHE STRATEGIES ──────────────────────────────────────────────────────────

// Cache-first for app shell; stale-while-revalidate in background
function handleAppShell(req) {
  return caches.open(CACHE_NAME).then(function(cache) {
    return cache.match(req).then(function(cached) {
      var networkFetch = fetch(req).then(function(response) {
        if (response.ok) {
          cache.put(req, response.clone());
        }
        return response;
      }).catch(function() { return null; });

      // Serve cache immediately if available; otherwise wait for network
      return cached || networkFetch;
    });
  });
}

// Cache-first for font CSS; re-fetch from network after 24h
function handleFontCSS(req) {
  return caches.open(FONT_CACHE).then(function(cache) {
    return cache.match(req).then(function(cached) {
      if (cached) {
        var cachedDate = cached.headers.get('sw-cached-at');
        var age = cachedDate ? Date.now() - parseInt(cachedDate, 10) : Infinity;
        if (age < 86400000) return cached;  // < 24h, serve from cache
      }
      return fetch(req).then(function(response) {
        if (response.ok) {
          // Clone, inject timestamp header, store
          var headers = new Headers(response.headers);
          headers.append('sw-cached-at', String(Date.now()));
          var stamped = new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: headers
          });
          cache.put(req, stamped.clone());
          return stamped;
        }
        return response;
      }).catch(function() { return cached || new Response('', { status: 503 }); });
    });
  });
}

// Cache-first for font files; permanent once cached
function handleFontFile(req) {
  return caches.open(FONT_CACHE).then(function(cache) {
    return cache.match(req).then(function(cached) {
      if (cached) return cached;
      return fetch(req).then(function(response) {
        if (response.ok) cache.put(req, response.clone());
        return response;
      });
    });
  });
}
