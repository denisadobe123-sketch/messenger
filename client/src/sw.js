import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { NetworkFirst, CacheFirst } from 'workbox-strategies';

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST || []);

// Navigation: always fresh from network
registerRoute(
  ({ request }) => request.mode === 'navigate',
  new NetworkFirst({ cacheName: 'html-cache', networkTimeoutSeconds: 5 })
);

// Uploads: cache
registerRoute(
  ({ url }) => url.pathname.startsWith('/uploads/'),
  new CacheFirst({ cacheName: 'uploads-cache' })
);

self.skipWaiting();
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// ── Push notifications ────────────────────────────────────────────────────────
self.addEventListener('push', e => {
  if (!e.data) return;
  let data;
  try { data = e.data.json(); } catch { data = { title: 'Messenger', body: e.data.text() }; }

  const options = {
    body: data.body || '',
    icon: data.icon || '/icon-192.png',
    badge: '/icon-192.png',
    tag: 'msg-' + (data.chatId || 'general'),
    renotify: true,
    vibrate: [100, 50, 100],
    data: { chatId: data.chatId, url: '/' },
    actions: [
      { action: 'open', title: 'Открыть' }
    ]
  };

  e.waitUntil(self.registration.showNotification(data.title || 'Messenger', options));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const chatId = e.notification.data?.chatId;

  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      // If app is open — focus and send message
      if (clients.length > 0) {
        const client = clients.find(c => c.focused) || clients[0];
        client.focus();
        if (chatId) client.postMessage({ type: 'NOTIFICATION_CLICK', chatId });
        return;
      }
      // App closed — open it
      return self.clients.openWindow('/');
    })
  );
});
