/* Public offline fallback only. Bump this version when changing any fallback asset. */
const CACHE_PREFIX = "mpdee-vision-offline-";
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const ASSETS = new Map([
  ["/offline.html", "text/html"],
  ["/offline.css", "text/css"],
  ["/icon.svg", "image/svg+xml"],
]);
const PAGES = new Set(["/", "/watch", "/setup"]);
const FALLBACK_CSP = "default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const EMERGENCY_PAGE = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Vision is unavailable</title><main><h1>Vision is unavailable</h1><p>Check your Wi-Fi or mobile data, then try again. Live cameras need a working connection.</p><p><a href="/watch">Try again</a></p><p><a href="/setup">Private access setup</a></p></main></html>';

async function fetchWithDeadline(request, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    return await fetch(request, {...options, signal: controller.signal});
  } finally { clearTimeout(timer); }
}

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    // Fetch only fixed public files, without sending cookies or accepting redirects.
    // Verify every response before publishing a complete new cache.
    const assets = await Promise.all([...ASSETS].map(async ([path, type]) => {
      const response = await fetchWithDeadline(path, {credentials: "omit", cache: "no-store", redirect: "error"});
      if (!response.ok || !response.headers.get("content-type")?.toLowerCase().startsWith(type)) {
        throw new Error("Offline fallback unavailable");
      }
      return [path, response];
    }));
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(assets.map(([path, response]) => cache.put(path, response)));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    // Other caches on this origin are not ours to remove.
    await Promise.all((await caches.keys()).filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function cachedAsset(path) {
  try { return await (await caches.open(CACHE_NAME)).match(path); }
  catch { return undefined; }
}

async function offlinePage() {
  const saved = await cachedAsset("/offline.html");
  return new Response(saved?.body ?? EMERGENCY_PAGE, {status: 503, headers: {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "private, no-store",
    "Content-Security-Policy": FALLBACK_CSP,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "X-Vision-Offline": "1",
  }});
}

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  // APIs, media, RSC/client navigations, uploads and all cross-origin traffic
  // are left entirely to the browser. No application response is ever cached.
  if (ASSETS.has(url.pathname) && !url.search) {
    event.respondWith((async () => (await cachedAsset(url.pathname)) ?? fetch(request))());
  } else if (request.mode === "navigate" && PAGES.has(url.pathname)) {
    event.respondWith((async () => {
      try {
        const response = await fetchWithDeadline(request, {cache: "no-store"});
        return [502, 503, 504].includes(response.status) ? offlinePage() : response;
      } catch { return offlinePage(); }
    })());
  }
});
