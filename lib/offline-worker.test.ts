import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../public/offline-worker.js", import.meta.url), "utf8");
const origin = "https://cctv.mpdee.uk";
type Fetcher = (request: RequestInfo | URL, options?: RequestInit) => Promise<Response>;
type Event = {request?: Request; waitUntil?: (promise: Promise<unknown>) => void; respondWith?: (promise: Promise<Response>) => void};

function fixture() {
  const handlers = new Map<string, (event: Event) => void>();
  const stores = new Map<string, Map<string, Response>>();
  const writes: string[] = [];
  const fetched: Array<{url: string; options?: RequestInit}> = [];
  const timers = new Map<number, () => void>();
  let timerId = 0, claimed = 0, skipped = 0;
  let fetcher: Fetcher = async request => {
    const url = new URL(typeof request === "string" ? request : request instanceof URL ? request.href : request.url, origin);
    const types: Record<string, string> = {"/offline.html":"text/html", "/offline.css":"text/css", "/icon.svg":"image/svg+xml"};
    return new Response(url.pathname === "/offline.html" ? "<h1>Vision is unavailable</h1>" : "public asset", {headers:{"content-type":types[url.pathname] ?? "text/html"}});
  };
  const cacheStorage = {
    async open(name: string) {
      const entries = stores.get(name) ?? new Map<string, Response>(); stores.set(name, entries);
      return {
        async put(path: string, response: Response) {writes.push(path); entries.set(path, response.clone());},
        async match(path: string) {return entries.get(path)?.clone();},
      };
    },
    async keys() {return [...stores.keys()];},
    async delete(name: string) {return stores.delete(name);},
  };
  vm.runInNewContext(source, {
    self: {location:{origin}, addEventListener:(name: string, handler: (event: Event) => void) => handlers.set(name, handler),
      skipWaiting:async () => {skipped++;}, clients:{claim:async () => {claimed++;}}},
    caches:cacheStorage, URL, Response, AbortController,
    fetch: (request: RequestInfo | URL, options?: RequestInit) => {
      fetched.push({url:typeof request === "string" ? request : request instanceof URL ? request.href : request.url, options});
      return fetcher(request, options);
    },
    setTimeout: (callback: () => void) => {const id = ++timerId; timers.set(id, callback); return id;},
    clearTimeout: (id: number) => timers.delete(id),
  });
  return {
    stores, writes, fetched, timers,
    get claimed() {return claimed;}, get skipped() {return skipped;},
    fetchWith(value: Fetcher) {fetcher = value;},
    async lifecycle(name: string) {
      let pending: Promise<unknown> | undefined;
      handlers.get(name)!({waitUntil: promise => {pending = promise;}});
      await pending;
    },
    request(path: string, mode = "navigate", method = "GET") {
      let response: Promise<Response> | undefined;
      const request = {url:new URL(path, origin).href, mode, method} as Request;
      handlers.get("fetch")!({request, respondWith: promise => {response = promise;}});
      return response;
    },
  };
}

test("installation caches only three fixed public files without credentials", async () => {
  const f = fixture(); await f.lifecycle("install");
  assert.deepEqual(f.writes.sort(), ["/icon.svg", "/offline.css", "/offline.html"]);
  assert.equal(f.skipped, 1);
  assert.equal(f.timers.size, 0);
  for (const call of f.fetched) {
    assert.equal(call.options?.credentials, "omit");
    assert.equal(call.options?.cache, "no-store");
    assert.equal(call.options?.redirect, "error");
  }
});

test("an invalid asset prevents installation instead of caching an error page", async () => {
  const f = fixture(); f.fetchWith(async () => new Response("login response", {headers:{"content-type":"application/json"}}));
  await assert.rejects(f.lifecycle("install"), /Offline fallback unavailable/);
  assert.equal(f.writes.length, 0); assert.equal(f.skipped, 0);
});

test("API, media, POST, cross-origin and RSC requests are never intercepted or cached", async () => {
  const f = fixture(); await f.lifecycle("install"); const writes = [...f.writes]; f.fetched.length = 0;
  for (const [path, mode, method] of [
    ["/api/viewer/session", "navigate", "GET"], ["/api/viewer/snapshot", "cors", "GET"],
    ["/api/diagnostics", "cors", "POST"], ["/watch", "navigate", "POST"],
    ["/watch?_rsc=test", "cors", "GET"], ["/setup", "same-origin", "GET"],
    ["/private-image.jpg", "no-cors", "GET"], ["/_next/static/chunk.js", "no-cors", "GET"],
    ["https://camera.example/watch", "navigate", "GET"], ["/offline.html?account=test", "cors", "GET"],
  ]) assert.equal(f.request(path, mode, method), undefined, path);
  assert.deepEqual(f.fetched, []); assert.deepEqual(f.writes, writes);
});

test("offline navigation serves public recovery with no stored application response", async () => {
  const f = fixture(); await f.lifecycle("install"); const writes = [...f.writes];
  f.fetchWith(async () => {throw new TypeError("offline");});
  for (const path of ["/", "/watch", "/setup", "/watch?private=not-persisted"]) {
    const response = await f.request(path)!;
    assert.equal(response.status, 503); assert.equal(response.headers.get("x-vision-offline"), "1");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.match(await response.text(), /Vision is unavailable/);
  }
  assert.deepEqual(f.writes, writes);
});

test("normal navigation including authentication/404 errors returns unchanged and uncached", async () => {
  const f = fixture(); await f.lifecycle("install"); const writes = [...f.writes];
  for (const status of [200, 307, 401, 403, 404, 500]) {
    f.fetchWith(async () => new Response("private response", {status}));
    const response = await f.request("/watch")!;
    assert.equal(response.status, status); assert.equal(await response.text(), "private response");
  }
  for (const status of [502, 503, 504]) {
    f.fetchWith(async () => new Response("upstream unavailable", {status}));
    assert.equal((await f.request("/watch")!).headers.get("x-vision-offline"), "1");
  }
  assert.deepEqual(f.writes, writes);
});

test("a navigation deadline falls back, and a later explicit retry reaches the network", async () => {
  const f = fixture(); await f.lifecycle("install");
  f.fetchWith((_request, options) => new Promise((_resolve, reject) => options?.signal?.addEventListener("abort", () => reject(new Error("timeout")))));
  const pending = f.request("/watch")!;
  assert.equal(f.timers.size, 1); [...f.timers.values()][0]();
  assert.equal((await pending).headers.get("x-vision-offline"), "1");
  assert.equal(f.timers.size, 0);
  f.fetchWith(async () => new Response("fresh sign-in"));
  assert.equal(await (await f.request("/watch")!).text(), "fresh sign-in");
});

test("cache eviction still leaves a minimal recovery page", async () => {
  const f = fixture(); f.fetchWith(async () => {throw new TypeError("offline");});
  assert.match(await (await f.request("/watch")!).text(), /Try again/);
});

test("activation removes only old owned caches and claims pages without navigation", async () => {
  const f = fixture(); await f.lifecycle("install");
  f.stores.set("mpdee-vision-offline-old", new Map()); f.stores.set("unrelated-cache", new Map());
  await f.lifecycle("activate");
  assert.equal(f.stores.has("mpdee-vision-offline-old"), false);
  assert.equal(f.stores.has("unrelated-cache"), true);
  assert.equal(f.stores.has("mpdee-vision-offline-v1"), true); assert.equal(f.claimed, 1);
});
