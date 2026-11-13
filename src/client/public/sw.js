// The office's service worker (see src/client/mobile/pwa.ts): what makes /lite an app you install on a
// phone. It keeps the app's own files for when the network's gone, shows the office's push
// notifications (server/push/) with the app closed, and a tap on one opens the worker it's about.
// Plain JavaScript in public/, so it's served from the root as it is, with the whole site in its scope.

const CACHE = 'command-express-v2';
/** The pages the app opens on; the hashed files under /assets/ are kept as they're fetched. */
const SHELL = ['/lite', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/badge-96.png'];
/**
 * Every build hashes its files anew, so the old ones would pile up in the cache for good: each kept
 * file is stamped with when it was last used (STAMP), and one unused for a month is let go.
 */
const STAMP = 'x-sw-used';
const DAY = 24 * 60 * 60 * 1000;
const FORGET_AFTER = 30 * DAY;
/** A file used again is stamped anew at most this often, rather than rewritten on every hit. */
const RESTAMP_AFTER = 3 * DAY;
let prunedAt = 0;

/** A copy of `res` stamped as used now, to keep. */
async function stamped(res) {
  const headers = new Headers(res.headers);
  headers.set(STAMP, String(Date.now()));
  return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers });
}

/** Lets go of the kept files nobody has used for FORGET_AFTER (at most once an hour). */
async function prune() {
  if (Date.now() - prunedAt < 60 * 60 * 1000) return;
  prunedAt = Date.now();
  const cache = await caches.open(CACHE);
  for (const req of await cache.keys()) {
    if (!new URL(req.url).pathname.startsWith('/assets/')) continue;
    const res = await cache.match(req);
    const used = Number(res?.headers.get(STAMP)) || 0;
    if (Date.now() - used > FORGET_AFTER) await cache.delete(req);
  }
}

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  // The API, the sockets and anything live are the network's alone.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws') || url.pathname.startsWith('/files/')) return;
  // Hashed bundle files never change: from the cache, else fetched and kept.
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    e.respondWith(
      caches.match(req).then((hit) => {
        if (hit) {
          if (Date.now() - (Number(hit.headers.get(STAMP)) || 0) > RESTAMP_AFTER) {
            const copy = hit.clone();
            e.waitUntil(stamped(copy).then((s) => caches.open(CACHE).then((c) => c.put(req, s))).catch(() => {}));
          }
          return hit;
        }
        return fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            e.waitUntil(stamped(copy).then((s) => caches.open(CACHE).then((c) => c.put(req, s))).catch(() => {}));
          }
          return res;
        });
      }),
    );
    return;
  }
  // The app's page: the network first (always the newest version), the kept copy when offline.
  if (req.mode === 'navigate') e.waitUntil(prune().catch(() => {}));
  if (req.mode === 'navigate' && (url.pathname === '/lite' || url.pathname === '/lite.html')) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          // Not signed in sends you to /login: keep only the real page.
          if (res.ok && !res.redirected) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('/lite', copy));
          }
          return res;
        })
        .catch(() => caches.match('/lite').then((hit) => hit || Response.error())),
    );
  }
});

// ---- Push ---------------------------------------------------------------------------------------
self.addEventListener('push', (e) => {
  let data = {};
  try {
    data = e.data ? e.data.json() : {};
  } catch {
    data = { title: e.data ? e.data.text() : 'Command Express' };
  }
  e.waitUntil(
    (async () => {
      const title = data.title || 'Command Express';
      await self.registration.showNotification(title, {
        body: data.body || '',
        tag: data.tag || undefined,
        renotify: !!data.tag,
        requireInteraction: !!data.requireInteraction,
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-96.png',
        vibrate: data.kind === 'needs_input' ? [120, 60, 120] : [80],
        timestamp: Date.now(),
        data: { url: data.url || '/lite', workerId: data.workerId, floor: data.floor, kind: data.kind },
      });
      // How many are waiting, on the app's icon (the page keeps it right once it's open).
      if (typeof data.waiting === 'number' && self.navigator.setAppBadge) {
        try {
          if (data.waiting > 0) await self.navigator.setAppBadge(data.waiting);
          else await self.navigator.clearAppBadge();
        } catch {}
      }
      // An open app hears it too, to buzz and redraw.
      for (const c of await self.clients.matchAll({ type: 'window' })) c.postMessage({ t: 'push', data });
    })(),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const d = e.notification.data || {};
  const target = new URL(d.url || '/lite', location.origin).href;
  e.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // The app's already open: there, to the worker, rather than a second copy.
      const app = wins.find((w) => new URL(w.url).pathname.startsWith('/lite')) || wins[0];
      if (app) {
        await app.focus();
        app.postMessage({ t: 'open', url: target, workerId: d.workerId, floor: d.floor });
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});

// The push service changed this phone's subscription: hand the new one to the office.
self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil(
    (async () => {
      try {
        const key = await fetch('/api/push/key', { credentials: 'same-origin' }).then((r) => r.json());
        const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key.publicKey });
        await fetch('/api/push/subscribe', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ subscription: sub.toJSON(), lang: (self.navigator.language || 'en').startsWith('pt') ? 'pt-BR' : 'en' }),
        });
      } catch {}
    })(),
  );
});
