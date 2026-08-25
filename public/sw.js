// Minimal service worker — exists only to satisfy PWA installability
// (Lighthouse/Chrome require a registered SW with a fetch handler).
// Deliberately does no caching yet. Real caching rules land with Portfolio
// (spec.md §7): app shell + map tiles + Learn content only, and explicitly
// never anything under /portfolio/* or Explore's live transaction data.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {
  // no-op: falls through to normal network behaviour
});
