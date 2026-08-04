// PWA disabled for public website — Capacitor native app is the installable app.
// This file unregisters itself if any old client still has it active.
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (event) {
  event.waitUntil(
    self.registration.unregister().then(function () {
      return self.clients.matchAll();
    }).then(function (clients) {
      clients.forEach(function (c) { if (c.url) c.navigate(c.url); });
    })
  );
});

