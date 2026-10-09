// ============================================================================
// APEX — Service Worker
// Стратегия: cache-first для статики, network-first для основного документа
// ============================================================================

const APP_VERSION = 'apex-v1.0.0';
const CORE_CACHE = 'apex-core-' + APP_VERSION;
const RUNTIME_CACHE = 'apex-runtime-' + APP_VERSION;

// Обязательные ресурсы для офлайн-режима
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  // Three.js подгрузится по требованию через runtime cache
];

// ---------- Install ----------
self.addEventListener('install', (event) => {
  console.log('[SW] Install');
  event.waitUntil(
    caches.open(CORE_CACHE)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
      .catch((err) => console.warn('[SW] install error:', err))
  );
});

// ---------- Activate ----------
self.addEventListener('activate', (event) => {
  console.log('[SW] Activate');
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== CORE_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

// ---------- Fetch ----------
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Пропускаем Chrome DevTools и прочие служебные
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Основной документ — network-first (свежая версия), fallback на кэш
  if (req.mode === 'navigate' || (req.destination === 'document')) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Шрифты, JS, CSS, изображения, 3D-модели — cache-first
  if (
    req.destination === 'script' ||
    req.destination === 'style' ||
    req.destination === 'image' ||
    req.destination === 'font' ||
    url.pathname.match(/\.(js|css|png|jpg|jpeg|webp|svg|woff2?|glb|gltf|bin|hdr|ktx2|basis)$/i) ||
    url.hostname.includes('unpkg.com') ||
    url.hostname.includes('cdn.jsdelivr.net') ||
    url.hostname.includes('threejs.org')
  ) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // Всё остальное — stale-while-revalidate
  event.respondWith(staleWhileRevalidate(req));
});

// ---------- Стратегии ----------
async function networkFirst(req) {
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.status === 200) {
      const cache = await caches.open(CORE_CACHE);
      cache.put(req, fresh.clone());
    }
    return fresh;
  } catch (err) {
    const cached = await caches.match(req);
    if (cached) return cached;
    // Fallback: главная страница
    const fallback = await caches.match('./index.html');
    if (fallback) return fallback;
    return new Response('Офлайн — ресурс недоступен', { status: 503, statusText: 'Offline' });
  }
}

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.status === 200) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(req, fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch (err) {
    return new Response('Офлайн — ресурс недоступен', { status: 503 });
  }
}

async function staleWhileRevalidate(req) {
  const cached = await caches.match(req);
  const fetchPromise = fetch(req).then((fresh) => {
    if (fresh && fresh.status === 200) {
      caches.open(RUNTIME_CACHE).then((cache) => cache.put(req, fresh.clone())).catch(() => {});
    }
    return fresh;
  }).catch(() => null);
  return cached || (await fetchPromise) || new Response('Офлайн', { status: 503 });
}

// ---------- Сообщения от клиента ----------
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
  }
});

// ---------- Push (заготовка) ----------
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'Apex';
  const options = {
    body: data.body || 'Новое событие в Aethelgard',
    icon: data.icon || undefined,
    badge: data.badge || undefined,
    tag: data.tag || 'apex',
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes('index.html') && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./');
    })
  );
});