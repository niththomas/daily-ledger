/* Cache-first app shell. Bump CACHE on every deploy or clients keep stale files. */
const CACHE = "ledger-v1";
const ASSETS = [
  "./", "./index.html", "./styles.css", "./app.js", "./manifest.json",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-512-maskable.png",
  "./icons/apple-touch-icon-180.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then((r) => r || fetch(e.request).catch(() => {
      // Only a navigation deserves the shell as a fallback; anything else
      // would get HTML where it expected CSS, JS, or a PNG.
      if (e.request.mode === "navigate") return caches.match("./index.html");
      return Response.error();
    }))
  );
});
