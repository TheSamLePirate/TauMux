// τ-mux web mirror — service worker.
//
// Two responsibilities:
//
//   1. Cache the offline shell — the index page, the bundled CSS, the
//      JetBrainsMono fonts. When the network drops, the user still
//      sees the chrome and a "disconnected" status pill while the
//      transport keeps trying to reconnect.
//
//   2. Bypass cache for the WebSocket upgrade and any API-style
//      route. The state stream MUST hit the live server.
//
// The build pipeline injects the bundle hash into CACHE_NAME via a
// `__BUILD_VERSION__` placeholder (see scripts/build-web-client.ts).
// Two service workers with different cache names coexist briefly
// during a deploy; the old one is GC'd by the browser once the new
// one activates.

/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope;

const CACHE_NAME = "tau-mux-mirror-__BUILD_VERSION__";

// Pre-cache only the small, stable shell. Everything else (xterm
// addons, fonts, audio, etc.) is large enough that we should let the
// runtime cache fetch them on demand.
const SHELL_PATHS = ["/", "/manifest.json"];

self.addEventListener("install", (event: ExtendableEvent) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_PATHS)),
  );
  // Activate immediately so the next reload picks up the new bundle
  // without waiting for every tab to close.
  self.skipWaiting();
});

self.addEventListener("activate", (event: ExtendableEvent) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME && k.startsWith("tau-mux-mirror-"))
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event: FetchEvent) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Same-origin only — bail on cross-origin so we don't accidentally
  // intercept an analytics request or something else the page made.
  if (url.origin !== self.location.origin) return;

  // Never serve cached HTML for the root: it embeds the bundled JS,
  // and a stale shell crashes the dispatcher when the protocol moves.
  // Network-first with a cached fallback means offline shows the last
  // known shell; online always serves fresh.
  if (url.pathname === "/" || url.pathname === "/index.html") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          if (fresh && fresh.status === 200) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(req, fresh.clone()).catch(() => {});
          }
          return fresh;
        } catch {
          const cached = await caches.match(req, { ignoreVary: true });
          if (cached) return cached;
          return new Response(
            "<h1>Offline</h1><p>τ-mux mirror is offline. Reconnecting…</p>",
            {
              status: 503,
              headers: { "content-type": "text/html; charset=utf-8" },
            },
          );
        }
      })(),
    );
    return;
  }

  // Static, content-addressed assets (fonts, audio): cache-first.
  if (
    url.pathname.startsWith("/fonts/") ||
    url.pathname.startsWith("/audio/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.json"
  ) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        try {
          const fresh = await fetch(req);
          if (fresh && fresh.status === 200) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(req, fresh.clone()).catch(() => {});
          }
          return fresh;
        } catch {
          return new Response("offline", { status: 503 });
        }
      })(),
    );
    return;
  }

  // Everything else (the WebSocket upgrade, sourcemap requests) goes
  // straight to the network — never intercept.
});
