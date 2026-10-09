/* Service worker: shows push notifications and opens the matching job when tapped. */
self.addEventListener('push', (event) => {
  let d = {}; try { d = event.data.json(); } catch (_) { d = { title: 'Kother', body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(d.title || 'New job match', { body: d.body || '', data: { url: d.url || '/' }, tag: d.url || undefined }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => { for (const c of list) if ('focus' in c) { c.navigate(url); return c.focus(); } return self.clients.openWindow(url); }));
});
