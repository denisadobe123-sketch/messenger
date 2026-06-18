import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst, CacheFirst } from 'workbox-strategies';

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST || []);

registerRoute(
  ({ request }) => request.mode === 'navigate',
  new NetworkFirst({ cacheName: 'html-cache', networkTimeoutSeconds: 5 })
);
registerRoute(
  ({ url }) => url.pathname.startsWith('/uploads/'),
  new CacheFirst({ cacheName: 'uploads-cache' })
);

self.skipWaiting();
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// ── Push Notifications ────────────────────────────────────────────────────────
self.addEventListener('push', e => {
  if (!e.data) return;
  let data;
  try { data = e.data.json(); } catch { data = { title: 'Nexora', body: e.data.text() }; }

  e.waitUntil(self.registration.showNotification(data.title || 'Nexora', {
    body: data.body || '',
    icon: data.icon || '/icon-192.png',
    badge: '/icon-192.png',
    tag: 'msg-' + (data.chatId || 'general'),
    renotify: true,
    vibrate: [100, 50, 100],
    data: { chatId: data.chatId, url: '/' },
    actions: [{ action: 'open', title: 'Открыть' }]
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const chatId = e.notification.data?.chatId;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      if (clients.length > 0) {
        const client = clients.find(c => c.focused) || clients[0];
        client.focus();
        if (chatId) client.postMessage({ type: 'NOTIFICATION_CLICK', chatId });
        return;
      }
      return self.clients.openWindow('/');
    })
  );
});

// ── Background Sync — deliver queued messages when network returns ─────────────
const IDB_NAME    = 'messenger-offline';
const IDB_STORE   = 'queue';
const SYNC_TAG    = 'send-queued';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(IDB_STORE, { keyPath: 'clientId' });
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = () => reject(req.error);
  });
}

async function getAllQueued(db) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror   = () => reject(req.error);
  });
}

async function deleteQueued(db, clientId) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(IDB_STORE, 'readwrite');
    const req = tx.objectStore(IDB_STORE).delete(clientId);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

self.addEventListener('sync', e => {
  if (e.tag === SYNC_TAG) {
    e.waitUntil(flushQueue());
  }
});

async function flushQueue() {
  let db, msgs;
  try {
    db   = await openDB();
    msgs = await getAllQueued(db);
  } catch { return; }

  if (!msgs.length) return;

  // Get token from clients
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  let token = null;
  for (const client of clients) {
    try {
      const channel = new MessageChannel();
      client.postMessage({ type: 'GET_TOKEN' }, [channel.port2]);
      token = await new Promise(res => {
        channel.port1.onmessage = e => res(e.data?.token);
        setTimeout(() => res(null), 1000);
      });
      if (token) break;
    } catch {}
  }

  if (!token) return; // Can't send without auth token

  // Get server URL from clients or use default
  const serverUrl = self.location.origin;

  const sent = [];
  for (const msg of msgs) {
    try {
      const res = await fetch(`${serverUrl}/messages/queued`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(msg)
      });
      if (res.ok) {
        sent.push(msg.clientId);
        await deleteQueued(db, msg.clientId);
      }
    } catch {}
  }

  // Notify all clients that messages were flushed
  if (sent.length > 0) {
    for (const client of clients) {
      client.postMessage({ type: 'QUEUE_FLUSHED', clientIds: sent });
    }
    // Show notification if app is not focused
    const focused = clients.some(c => c.focused);
    if (!focused) {
      await self.registration.showNotification('Nexora', {
        body: `${sent.length} сообщ. отправлено`,
        icon: '/icon-192.png',
        tag: 'queue-flush',
        silent: true
      });
    }
  }
}
