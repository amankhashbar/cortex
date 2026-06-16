/* =============================================================
   NeuroReadiness — service worker
   Makes the app installable + offline. Strategy:
   - App shell (same-origin core files) is precached on install so a
     cold, offline launch works.
   - Same-origin requests: cache-first, fall back to network, and
     cache anything new we fetch (covers files added later).
   - Cross-origin (Google Fonts): stale-while-revalidate so type
     still renders offline after the first online visit.
   Bump CACHE on any shell change to retire the old cache.
   ============================================================= */
const CACHE = "nr-shell-v4";

// Paths are relative to the SW scope, so this works under a Pages subpath.
const SHELL = [
  "./",
  "./index.html",      // marketing landing
  "./sensor-setup.html",
  "./app.html",        // the instrument app
  "./manifest.webmanifest",
  "./css/landing.css",
  "./js/landing.js",
  "./css/styles.css",
  "./js/util.js",
  "./js/sensor.js",
  "./js/ppg.js",
  "./js/motion.js",
  "./js/tasks.js",
  "./js/scores.js",
  "./js/csv.js",
  "./js/store.js",
  "./js/history.js",
  "./js/app.js",
  "./icons/icon.svg",
  "./icons/icon-maskable.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  if (sameOrigin) {
    // Cache-first for the shell; populate the cache with anything new.
    event.respondWith(
      caches.match(req, { ignoreSearch: true }).then((hit) =>
        hit ||
        fetch(req)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          })
          .catch(() => caches.match("./index.html")) // SPA-ish offline fallback
      )
    );
  } else {
    // Cross-origin (fonts): stale-while-revalidate.
    event.respondWith(
      caches.match(req).then((hit) => {
        const fetched = fetch(req)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          })
          .catch(() => hit);
        return hit || fetched;
      })
    );
  }
});
