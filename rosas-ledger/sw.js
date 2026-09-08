/* =============================================================================
 * Rosa's Ledger — Service Worker
 * Owns only /rosas-ledger/ (this script's directory). That longer scope beats
 * Nickey's repo-root SW so the two apps do not share a controller.
 * Bump CACHE_VERSION after manifest / icon / shell changes.
 * ============================================================================= */

'use strict';

const CACHE_VERSION = 'rosa-v1';
const CACHE_NAME = 'rosa-shell-' + CACHE_VERSION;

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css',
  './js/app.js',
  './js/core.js',
  './js/store.js',
  './js/config.js',
  './js/demo-data.js',
  './js/xlsx-lite.js',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/apple-touch-icon.png',
  './assets/icon-maskable-192.png',
  './assets/icon-maskable-512.png',
  './assets/icon.jpg',
  './assets/icon.svg'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return Promise.all(PRECACHE_URLS.map(function(url) {
        return cache.add(url).catch(function(err) {
          console.warn('[Rosa SW] skip precache', url, err);
        });
      }));
    }).then(function() {
      console.log('[Rosa SW] App shell precached:', CACHE_NAME);
      return self.skipWaiting();
    }).catch(function(err) {
      console.error('[Rosa SW] Precache failed:', err);
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) {
          return key.startsWith('rosa-shell-') && key !== CACHE_NAME;
        }).map(function(key) {
          console.log('[Rosa SW] Deleting old cache:', key);
          return caches.delete(key);
        })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function(event) {
  const req = event.request;
  const url = new URL(req.url);

  if (!url.protocol.startsWith('http')) return;

  // Never cache Firebase / Google backends.
  if (url.hostname !== self.location.hostname) {
    event.respondWith(fetch(req));
    return;
  }

  // Stay inside this folder even if a parent SW is still registered.
  if (url.pathname.indexOf('/rosas-ledger/') === -1) {
    return;
  }

  event.respondWith(handleShell(req));
});

function handleShell(req) {
  return caches.open(CACHE_NAME).then(function(cache) {
    return cache.match(req).then(function(cached) {
      var networkFetch = fetch(req).then(function(response) {
        if (response.ok) {
          cache.put(req, response.clone());
        }
        return response;
      }).catch(function() { return null; });

      return cached || networkFetch;
    });
  });
}
