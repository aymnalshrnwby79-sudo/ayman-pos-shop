// ════════════════════════════════════════════════
// sw.js — Service Worker v5.0
// أيمن الشرنوبى — نظام البيع الذهبي
// Offline 100% + Auto Update + Clean Cache
// ════════════════════════════════════════════════

const CACHE_NAME = 'ayman-gold-v5.1';

// All app assets to cache
const STATIC_ASSETS = [
  './index.html',
  './style.css',
  './app.js',
  './storage.js',
  './invoice.js',
  './settings.js',
  './manifest.json',
  './icon.png',
  './logo-192.png',
  './logo-512.png',
  './apple-touch-icon.png',
  './favicon.ico',
  'https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
];

// ══ INSTALL — pre-cache everything
self.addEventListener('install', event => {
  console.log('[SW] Installing v5.1...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        // Cache assets one by one — don't fail if one is missing
        return Promise.allSettled(
          STATIC_ASSETS.map(url =>
            cache.add(url).catch(err => console.warn('[SW] Failed to cache:', url, err))
          )
        );
      })
      .then(() => {
        console.log('[SW] Install complete');
        return self.skipWaiting();
      })
  );
});

// ══ ACTIVATE — delete all old caches
self.addEventListener('activate', event => {
  console.log('[SW] Activating v5.1...');
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      ))
      .then(() => {
        console.log('[SW] Activated — claiming clients');
        return self.clients.claim();
      })
  );
});

// ══ FETCH — Cache First, Network Fallback
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Skip Firebase realtime connections
  if (url.hostname.includes('firebaseio.com') ||
      url.hostname.includes('googleapis.com') && url.pathname.includes('/firestore/')) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(cached => {
        if (cached) {
          // Serve from cache + update in background (stale-while-revalidate)
          fetch(event.request)
            .then(response => {
              if (response && response.ok) {
                caches.open(CACHE_NAME)
                  .then(cache => cache.put(event.request, response));
              }
            })
            .catch(() => {});
          return cached;
        }

        // Not in cache — fetch from network
        return fetch(event.request)
          .then(response => {
            if (response && response.ok) {
              const clone = response.clone();
              caches.open(CACHE_NAME)
                .then(cache => cache.put(event.request, clone));
            }
            return response;
          })
          .catch(() => {
            // Offline fallback
            if (event.request.mode === 'navigate') {
              return caches.match('./index.html');
            }
          });
      })
  );
});

// ══ MESSAGE — handle commands from app
self.addEventListener('message', event => {
  if (!event.data) return;

  if (event.data.type === 'SKIP_WAITING') {
    console.log('[SW] Skip waiting — updating now');
    self.skipWaiting();
  }

  if (event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }

  if (event.data.type === 'CLEAR_CACHE') {
    caches.delete(CACHE_NAME)
      .then(() => event.ports[0].postMessage({ cleared: true }));
  }
});
