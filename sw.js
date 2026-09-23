'use strict';
const CACHE_VERSION='nickey-v9.6';
const CACHE_NAME='nickey-shell-'+CACHE_VERSION;
const PRECACHE_URLS=['./','./index.html','./nickey-shared.js','./sw.js'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(PRECACHE_URLS))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('nickey-shell-')&&k!==CACHE_NAME).map(k=>caches.delete(k))))));
self.addEventListener('fetch',event=>{if(new URL(event.request.url).origin===self.location.origin)event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request)));});
