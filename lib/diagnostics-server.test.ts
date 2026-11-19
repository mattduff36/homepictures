import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { test } from "node:test";
import { createIncident, validIncident, type Incident } from "./diagnostics";
import { deliverIncidents, handleDiagnosticRequest, reportServerIncident } from "./diagnostics-server";
import { VIEWER_GATEWAY_ORIGIN } from "./viewer-protocol";

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://cctv.mpdee.uk/api/diagnostics", {method: "POST",
    headers: {"Content-Type": "application/json", Origin: "https://cctv.mpdee.uk", "Sec-Fetch-Site": "same-origin", ...headers},
    body: JSON.stringify(body)});
}

test("collector rejects cross-origin, oversized, extra-field and server-spoofed requests without delivery", async () => {
  let calls = 0;
  const deps = {check: () => true, emit: () => undefined, deliver: async () => {calls++; return true;}};
  const event = createIncident({code: "client_exception"}, "browser");
  assert.equal((await handleDiagnosticRequest(request({events: [event]}, {Origin: "https://other.test"}), deps)).status, 403);
  assert.equal((await handleDiagnosticRequest(request({events: [event]}, {"Content-Length": "999999"}), deps)).status, 413);
  assert.equal((await handleDiagnosticRequest(request({events: [{...event, password: "private"}]}), deps)).status, 400);
  assert.equal((await handleDiagnosticRequest(request({events: [{...event, source: "server"}]}), deps)).status, 400);
  assert.equal((await handleDiagnosticRequest(request({events: [{...event, code: "server_exception"}]}), deps)).status, 400);
  assert.equal((await handleDiagnosticRequest(request({events: Array(6).fill(event)}), deps)).status, 400);
  assert.equal((await handleDiagnosticRequest(request({events: [event]}), {...deps, check: () => false})).status, 429);
  assert.equal(calls, 0);
});

test("collector revalidates browser metadata and retains a safe console fallback when storage is unavailable", async () => {
  const logs: Incident[] = [];
  const event = createIncident({code: "viewer_timeout", release: "a".repeat(40), traceId: "b".repeat(32)}, "browser");
  const response = await handleDiagnosticRequest(request({events: [event]}), {
    check: () => true, now: () => 1900000000000, emit: incident => logs.push(incident), deliver: async () => false,
  });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(logs.length, 1); assert.equal(logs[0].id, event.id); assert.equal(logs[0].time, 1900000000);
  assert.equal(logs[0].traceId, ""); assert.equal(logs[0].severity, "warning"); assert.equal(validIncident(logs[0]), true);
  const saved = await handleDiagnosticRequest(request({events: [event]}), {check: () => true,
    emit: () => {throw new Error("console failed");}, deliver: async () => true});
  assert.equal(saved.status, 200);
  const rejected = await handleDiagnosticRequest(request({events: [event]}), {check: () => true,
    emit: () => undefined, deliver: async () => {throw new Error("sink failed");}});
  assert.equal(rejected.status, 503);
});

test("diagnostic delivery signs only the fixed path and sanitized body and checks acknowledgement", async () => {
  const secret = randomBytes(32).toString("hex");
  const previous = {secret: process.env.VIEWER_SHARED_SECRET, origin: process.env.VIEWER_GATEWAY_ORIGIN};
  process.env.VIEWER_SHARED_SECRET = secret; process.env.VIEWER_GATEWAY_ORIGIN = VIEWER_GATEWAY_ORIGIN;
  try {
    const event = createIncident({code: "server_exception", error: new Error("private exception text")}, "server");
    assert.equal(await deliverIncidents([event], async (url, init) => {
      assert.equal(String(url), `${VIEWER_GATEWAY_ORIGIN}/v1/diagnostics`);
      const headers = new Headers(init?.headers); const raw = String(init?.body);
      const expected = createHmac("sha256", secret).update(`${headers.get("x-viewer-timestamp")}\n${headers.get("x-viewer-nonce")}\nPOST\n/v1/diagnostics\n${raw}`).digest("hex");
      assert.equal(headers.get("x-viewer-signature"), expected);
      assert.doesNotMatch(raw, /private exception|password|session|credential/);
      return Response.json({ok: true});
    }), true);
    assert.equal(await deliverIncidents([event], async () => Response.json({ok: false})), false);
    assert.equal(await deliverIncidents([event], async () => {throw new Error("network");}), false);
  } finally {
    if (previous.secret === undefined) delete process.env.VIEWER_SHARED_SECRET; else process.env.VIEWER_SHARED_SECRET = previous.secret;
    if (previous.origin === undefined) delete process.env.VIEWER_GATEWAY_ORIGIN; else process.env.VIEWER_GATEWAY_ORIGIN = previous.origin;
  }
});

test("server reporter survives absent request context and throwing console without exposing an error", () => {
  const original = console.error;
  const records: string[] = [];
  try {
    console.error = record => { records.push(String(record)); };
    const id = reportServerIncident({code: "server_exception", error: new Error("private-token")});
    assert.match(id, /^[0-9a-f]{32}$/);
    assert.doesNotMatch(records.join(""), /private-token/);
    assert.equal(JSON.parse(records[0]).incident.id, id);
    assert.equal(reportServerIncident({code: "server_exception", error: new Error("another-private-token")}), id);
    assert.equal(records.length, 1);
    console.error = () => {throw new Error("console failed");};
    assert.doesNotThrow(() => reportServerIncident({code: "turn_unavailable", status: 502}));
  } finally {console.error = original;}
});
