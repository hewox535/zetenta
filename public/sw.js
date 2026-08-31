// Service worker de notificaciones push. Sin caché ni offline: solo recibe
// los push de la Edge Function 'notify' y los muestra; al tocarlos enfoca la
// app (o la abre) en la URL del evento.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { /* payload no-JSON */ }
  e.waitUntil(self.registration.showNotification(data.title || 'Notificación', {
    body: data.body || '',
    icon: data.icon || undefined,
    badge: data.icon || undefined,
    tag: data.tag || undefined,
    data: { url: data.url || '/' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if ('focus' in c) { c.navigate(url); return c.focus(); }
    }
    return self.clients.openWindow(url);
  }));
});
