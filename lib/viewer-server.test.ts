import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import { boundedJson, gatewaySignature, handleViewerRequest, viewerSameOrigin, viewerSource } from "./viewer-server";
import { VIEWER_CAMERA, VIEWER_COOKIE, VIEWER_GATEWAY_ORIGIN } from "./viewer-protocol";

const secret = "test-shared-secret-" + "s".repeat(32);
const session = "s".repeat(43);
const lease = "l".repeat(43);
const envKeys = ["VIEWER_ENABLED", "VIEWER_SHARED_SECRET", "VIEWER_GATEWAY_ORIGIN",
  "CF_TURN_KEY_ID", "CF_TURN_API_TOKEN", "VERCEL", "NODE_ENV"] as const;
const original = new Map(envKeys.map((key) => [key, process.env[key]]));
beforeEach(() => {
  Object.assign(process.env, {
    VIEWER_ENABLED: "true", VIEWER_SHARED_SECRET: secret, VIEWER_GATEWAY_ORIGIN,
    CF_TURN_KEY_ID: "test-key", CF_TURN_API_TOKEN: "test-provider-token", VERCEL: "1",
    NODE_ENV: "production",
  });
});
afterEach(() => {
  for (const key of envKeys) {
    const value = original.get(key);
    if (value === undefined) delete process.env[key]; else Object.assign(process.env, { [key]: value });
  }
});

function request(body: unknown = {}, headers: HeadersInit = {}, cookie = true) {
  return new Request("https://cctv.mpdee.uk/api/viewer/session", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "https://cctv.mpdee.uk",
      ...(cookie ? { Cookie: `${VIEWER_COOKIE}=${session}` } : {}), ...headers },
    body: JSON.stringify(body),
  });
}
function response(value: unknown, status = 200) {
  return Response.json(value, { status });
}
const noFetch: typeof fetch = async () => { throw new Error("must not call upstream"); };

test("viewer is off by default and missing/incorrect config fails closed with no-store", async () => {
  for (const [key, value] of [["VIEWER_ENABLED", ""], ["VIEWER_SHARED_SECRET", ""],
    ["VIEWER_GATEWAY_ORIGIN", "https://attacker.example"]] as const) {
    const previous = process.env[key];
    process.env[key] = value;
    const result = await handleViewerRequest(request(), "session", noFetch);
    assert.equal(result.status, 503);
    assert.equal(result.headers.get("Cache-Control"), "private, no-store");
    process.env[key] = previous;
  }
});

test("strict same-origin check rejects missing, cross-site and spoofed forwarding", async () => {
  assert.equal(viewerSameOrigin(request()), true);
  const cases: HeadersInit[] = [{ Origin: "https://evil.example" }, { Origin: "" },
    { "Sec-Fetch-Site": "same-site" }, { "Sec-Fetch-Site": "cross-site" },
    { Origin: "https://evil.example", "X-Forwarded-Host": "evil.example" }];
  for (const headers of cases) {
    const result = await handleViewerRequest(request({}, headers), "session", noFetch);
    assert.equal(result.status, 403);
  }
  assert.equal(viewerSameOrigin(new Request("https://evil.example/api/viewer/session", {
    headers: { Origin: "https://evil.example" },
  })), false);
});

test("setup cookie cannot authenticate and unknown actions or client-chosen sessions are rejected", async () => {
  const anonymous = request({}, { Cookie: "homepictures_session=setup-token" }, false);
  assert.equal((await handleViewerRequest(anonymous, "session", noFetch)).status, 401);
  assert.equal((await handleViewerRequest(request(), "admin", noFetch)).status, 404);
  assert.equal((await handleViewerRequest(request({ session }), "session", noFetch)).status, 400);
});

test("login signs the exact path and bytes, trusts only Vercel IP and sets a separate secure cookie", async () => {
  const fetchImpl: typeof fetch = async (url, init) => {
    assert.equal(url, `${VIEWER_GATEWAY_ORIGIN}/v1/login`);
    assert.equal(init?.redirect, "error");
    assert.equal(init?.cache, "no-store");
    assert.ok(init?.signal);
    const headers = new Headers(init?.headers);
    const raw = String(init?.body);
    assert.equal(headers.get("X-Viewer-Signature"), gatewaySignature(secret,
      headers.get("X-Viewer-Timestamp")!, headers.get("X-Viewer-Nonce")!, "/v1/login", raw));
    const body = JSON.parse(raw);
    assert.deepEqual(Object.keys(body), ["username", "password", "source"]);
    assert.equal(body.source, createHmac("sha256", secret).update("viewer-source\n203.0.113.5").digest("hex"));
    return response({ session, expires: Math.floor(Date.now() / 1000) + 604800 });
  };
  const result = await handleViewerRequest(request({ username: "owner", password: "test-password" },
    { "X-Vercel-Forwarded-For": "203.0.113.5", "X-Real-IP": "attacker" }, false), "login", fetchImpl);
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { ok: true });
  const cookie = result.headers.get("Set-Cookie")!;
  assert.match(cookie, new RegExp(`^${VIEWER_COOKIE}=`));
  for (const part of ["HttpOnly", "Secure", "SameSite=strict", "Path=/", "Max-Age=604800"]) {
    assert.ok(cookie.includes(part), part);
  }
  assert.doesNotMatch(cookie, /Domain=/);
});

test("signature binds exact bytes and action and shares the Python protocol", () => {
  const raw = '{"session":"test"}';
  const expected = createHmac("sha256", "s".repeat(32))
    .update(`1800000000\n${"0".repeat(32)}\nPOST\n/v1/session\n${raw}`).digest("hex");
  assert.equal(expected, "f8ca3d4836870079053ec0a46e4364a143be296be9a290aba501f08b677679df");
  assert.equal(gatewaySignature("s".repeat(32), "1800000000", "0".repeat(32), "/v1/session", raw), expected);
  assert.notEqual(gatewaySignature(secret, "1800000000", "0".repeat(32), "/v1/session", raw),
    gatewaySignature(secret, "1800000000", "0".repeat(32), "/v1/logout", raw));
});

test("source grouping ignores untrusted forwarding and collapses unavailable or malformed platform IP", () => {
  const a = request({}, { "X-Real-IP": "1.2.3.4", "X-Forwarded-For": "5.6.7.8" });
  assert.equal(viewerSource(a, secret), viewerSource(request(), secret));
  assert.equal(viewerSource(request({}, { "X-Vercel-Forwarded-For": "1.2.3.4, 5.6.7.8" }), secret),
    viewerSource(request(), secret));
  delete process.env.VERCEL;
  assert.equal(viewerSource(request({}, { "X-Vercel-Forwarded-For": "1.2.3.4" }), secret),
    viewerSource(request(), secret));
});

test("Dell authorization precedes TURN issuance and only filtered short-lived credentials reach browser", async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push(String(url));
    if (calls.length === 1) {
      assert.deepEqual(JSON.parse(String(init?.body)), { session, camera: VIEWER_CAMERA });
      return response({ lease, expires: Math.floor(Date.now() / 1000) + 900, camera: VIEWER_CAMERA });
    }
    assert.match(String(url), /^https:\/\/rtc.live.cloudflare.com\/v1\/turn\/keys\/test-key\//);
    assert.deepEqual(JSON.parse(String(init?.body)), { ttl: 1200 });
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-provider-token");
    return response({ iceServers: [
      { urls: ["stun:stun.cloudflare.com:3478"] },
      { urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turn:evil.example:3478"],
        username: "short-lived", credential: "temporary" },
    ] });
  };
  const result = await handleViewerRequest(request(), "config", fetchImpl);
  assert.equal(result.status, 200);
  const text = await result.text();
  assert.doesNotMatch(text, /test-provider-token|test-key|evil|stun:|ssssssss/);
  assert.deepEqual(JSON.parse(text).iceServers, [{
    urls: ["turn:turn.cloudflare.com:3478?transport=udp"], username: "short-lived", credential: "temporary",
  }]);
  assert.equal(calls.length, 2);
});

test("revoked session and rate limits never request TURN credentials", async () => {
  for (const status of [401, 403, 429]) {
    let calls = 0;
    const result = await handleViewerRequest(request(), "config", async () => {
      ++calls;
      return response({ error: "sensitive backend text" }, status);
    });
    assert.equal(result.status, status);
    assert.equal(calls, 1);
    assert.doesNotMatch(await result.text(), /sensitive/);
  }
});

test("TURN failure releases reservation and returns only a generic error", async () => {
  const paths: string[] = [];
  const result = await handleViewerRequest(request(), "config", async (url) => {
    paths.push(String(url));
    if (paths.length === 1) return response({ lease, camera: VIEWER_CAMERA, expires: Math.floor(Date.now() / 1000) + 900 });
    if (paths.length === 2) return response({ error: "provider details" }, 500);
    return response({ ok: true });
  });
  assert.equal(result.status, 502);
  assert.ok(paths[2].endsWith("/v1/stop"));
  assert.doesNotMatch(await result.text(), /provider details/);
});

test("invalid, oversized and unexpected inputs cannot reach upstream", async () => {
  for (const body of [{ camera: "front-door", lease, sdp: "v=0\r\n" },
    { camera: VIEWER_CAMERA, lease, sdp: "v=0\r\n", url: "http://localhost" },
    { camera: VIEWER_CAMERA, lease, sdp: "v=0\r\n" + "x".repeat(48000) }]) {
    assert.equal((await handleViewerRequest(request(body), "offer", noFetch)).status, 400);
  }
  assert.equal((await handleViewerRequest(request({}, { "Content-Length": "999999" }), "session", noFetch)).status, 413);
  const oversized = new Response("x".repeat(65537), { headers: { "Content-Type": "application/json" } });
  await assert.rejects(boundedJson(oversized), /viewer_body_too_large/);
  await assert.rejects(boundedJson(new Response("{", { headers: { "Content-Type": "application/json" } })), /viewer_invalid_json/);
});

test("a stalled JSON body hits its actual read deadline and cancels the stream", { timeout: 8000 }, async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  await assert.rejects(boundedJson(new Response(body, {
    headers: { "Content-Type": "application/json" },
  })), /viewer_body_timeout/);
  assert.equal(cancelled, true);
});

test("malformed TURN credentials fail closed and release the Dell reservation", async () => {
  for (const credential of ["", null]) {
    let calls = 0;
    const result = await handleViewerRequest(request(), "config", async () => {
      ++calls;
      if (calls === 1) return response({ lease, camera: VIEWER_CAMERA, expires: Math.floor(Date.now() / 1000) + 900 });
      if (calls === 2) return response({ iceServers: [{
        urls: ["turn:turn.cloudflare.com:3478"], username: "temporary", credential,
      }] });
      return response({ ok: true });
    });
    assert.equal(result.status, 502);
    assert.equal(calls, 3);
  }
});

test("gateway timeout, redirect failure and malformed answers fail generically", async () => {
  for (const failure of [new DOMException("private upstream", "TimeoutError"),
    new TypeError("private redirect target")]) {
    const result = await handleViewerRequest(request(), "session", async () => { throw failure; });
    assert.equal(result.status, 502);
    assert.doesNotMatch(await result.text(), /private|target/);
  }
  const result = await handleViewerRequest(request({ camera: VIEWER_CAMERA, lease, sdp: "v=0\r\n" }),
    "offer", async () => response({ type: "answer", sdp: "not-sdp" }));
  assert.equal(result.status, 502);
});

test("logout revokes at Dell and clears cookie, including upstream failure", async () => {
  for (const status of [200, 503]) {
    const result = await handleViewerRequest(request(), "logout", async (_url, init) => {
      assert.deepEqual(JSON.parse(String(init?.body)), { session });
      return response(status === 200 ? { ok: true } : { error: "unavailable" }, status);
    });
    assert.equal(result.status, status === 200 ? 200 : 502);
    assert.match(result.headers.get("Set-Cookie")!, /Max-Age=0/);
  }
});
