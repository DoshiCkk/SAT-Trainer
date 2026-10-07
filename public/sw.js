/*
 * Offline cache for SAT Train.
 *
 * Two caches with different lifetimes: the shell (HTML, JS, CSS, icons) is
 * replaced whenever a new build is deployed, while the material (questions.json
 * and the ~30 MB of PDF crops) is keyed by content and kept across deployments
 * so a bus ride never re-downloads it.
 *
 * Hand-written rather than generated, because the whole thing is one page with
 * two kinds of request and a plugin would hide which is which.
 */

const VERSION = "v1";
const SHELL = `shell-${VERSION}`;
const DATA = "material-v1";
const FONTS = "fonts-v1";

/** Everything needed to boot with no network at all. */
const SHELL_URLS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png",
  "./icons/favicon-64.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      // One miss (a stale icon name, say) must not abort the whole install.
      await Promise.allSettled(SHELL_URLS.map((u) => cache.add(new Request(u, { cache: "reload" }))));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL, DATA, FONTS]);
      await Promise.all(
        (await caches.keys()).filter((k) => !keep.has(k)).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

/** Which cache a request belongs to, or null if it is not ours to keep. */
function bucket(url) {
  if (url.origin === self.location.origin) {
    if (url.pathname.includes("/img/")) return DATA;
    if (url.pathname.includes("/assets/")) return SHELL;
    if (url.pathname.includes("/icons/")) return SHELL;
    return null;
  }
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    return FONTS;
  }
  return null;
}

/**
 * Serve the old copy at once, then replace it.
 *
 * For questions.json: a crop is named after its question id and never changes
 * under it, but the base itself grows every time a new PDF is parsed, and
 * cache-first would pin the phone to whatever it downloaded first.
 */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request, { ignoreVary: true });
  const update = fetch(request).then((res) => {
    if (res.ok) cache.put(request, res.clone()).catch(() => {});
    return res;
  });
  if (!hit) return update;
  update.catch(() => {});
  return hit;
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request, { ignoreVary: true });
  if (hit) return hit;
  const res = await fetch(request);
  // Opaque cross-origin responses (the fonts) have status 0 and are still worth
  // keeping; a real error page is not.
  if (res && (res.ok || res.type === "opaque")) {
    cache.put(request, res.clone()).catch(() => {});
  }
  return res;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // Desmos has to come off the network: its bundle pulls further scripts at
  // run time, so a half-cached calculator would be worse than an absent one.
  if (url.hostname.endsWith("desmos.com")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(SHELL);
          cache.put("./index.html", fresh.clone()).catch(() => {});
          return fresh;
        } catch {
          const cache = await caches.open(SHELL);
          return (
            (await cache.match("./index.html")) ??
            (await cache.match("./")) ??
            new Response("Офлайн и нет сохранённой копии.", {
              status: 503,
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            })
          );
        }
      })()
    );
    return;
  }

  if (url.origin === self.location.origin && url.pathname.endsWith("/questions.json")) {
    event.respondWith(staleWhileRevalidate(request, DATA));
    return;
  }

  const target = bucket(url);
  if (target) event.respondWith(cacheFirst(request, target));
});

/** Fetch a list of URLs into the material cache, reporting progress back. */
async function precache(urls, client) {
  const cache = await caches.open(DATA);
  const total = urls.length;
  let done = 0;
  let failed = 0;
  const post = () => client?.postMessage({ type: "precache-progress", done, failed, total });

  // Six at a time: enough to saturate a phone connection without opening so
  // many sockets that the browser starts queueing them anyway.
  const queue = urls.slice();
  const worker = async () => {
    for (let next = queue.pop(); next; next = queue.pop()) {
      try {
        if (!(await cache.match(next, { ignoreVary: true }))) {
          const res = await fetch(next, { cache: "no-cache" });
          if (!res.ok) throw new Error(String(res.status));
          await cache.put(next, res);
        }
      } catch {
        failed += 1;
      }
      done += 1;
      if (done % 10 === 0 || done === total) post();
    }
  };
  post();
  await Promise.all(Array.from({ length: 6 }, worker));
  client?.postMessage({ type: "precache-done", done, failed, total });
}

/** How much of a list is already on disk, so the UI can say "готово". */
async function status(urls, client) {
  const cache = await caches.open(DATA);
  let cached = 0;
  for (const u of urls) {
    if (await cache.match(u, { ignoreVary: true })) cached += 1;
  }
  client?.postMessage({ type: "precache-status", cached, total: urls.length });
}

self.addEventListener("message", (event) => {
  const msg = event.data;
  if (!msg || typeof msg !== "object") return;
  const client = event.source;
  if (msg.type === "precache") event.waitUntil(precache(msg.urls ?? [], client));
  if (msg.type === "status") event.waitUntil(status(msg.urls ?? [], client));
  if (msg.type === "clear") {
    event.waitUntil(
      caches.delete(DATA).then(() => client?.postMessage({ type: "precache-status", cached: 0, total: msg.urls?.length ?? 0 }))
    );
  }
});
