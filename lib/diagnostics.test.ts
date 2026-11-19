import assert from "node:assert/strict";
import { test } from "node:test";
import { createIncident, validIncident, safeLocation, normalizeBrowserIncident, isBrowserIncident } from "./diagnostics";
import { createIncidentReporter } from "./diagnostics-client";
import { requestDeadline } from "./client-request";

test("incident construction retains only fixed metadata and strips private exception material", () => {
  const sensitive = "private-password-cookie-sdp";
  const error = new TypeError(sensitive);
  error.stack = `TypeError: ${sensitive}\n at render (https://example.test/private/viewer-player.ts:22:3)\n at ${sensitive}`;
  const event = createIncident({code: "client_exception", operation: "render", error,
    location: `https://example.test/${sensitive}.js:9:1`, release: "abcdef012345", reference: "not-an-id"}, "browser");
  assert.equal(validIncident(event), true);
  assert.equal(event.location, "viewer-player.ts:22:3");
  assert.equal(event.errorName, "TypeError");
  assert.equal(event.reference, "");
  assert.doesNotMatch(JSON.stringify(event), /private-password|cookie|sdp|https:|example\.test/);
  assert.equal(safeLocation("https://example.test/secret-file.js:1:1"), "");
  assert.equal(safeLocation("https://example.test/abcdef123456.js:17:2"), "abcdef123456.js:17:2");
  assert.equal(safeLocation("viewer-player.ts?password=hidden:1:1"), "");
});

test("schema rejects extra fields and unsafe values; browser trust fields are overwritten", () => {
  const original = createIncident({code: "viewer_timeout", operation: "session", release: "abcdef0", severity: "error",
    traceId: "a".repeat(32), status: 502}, "browser", 1000000);
  assert.equal(validIncident({...original, password: "should-not-persist"}), false);
  assert.equal(validIncident({...original, location: "/private/full/path/viewer-player.ts:1:1"}), false);
  assert.equal(validIncident({...original, code: "attacker-label"}), false);
  assert.equal(validIncident({...original, camera: "unknown camera"}), false);
  assert.equal(validIncident({...original, status: 200}), false);
  const clean = normalizeBrowserIncident(original, "fedcba0", 2000000);
  assert.equal(clean.id, original.id);
  assert.equal(clean.time, 2000);
  assert.equal(clean.source, "browser");
  assert.equal(clean.release, "fedcba0");
  assert.equal(clean.traceId, "");
  assert.equal(clean.severity, "warning");
  assert.equal(isBrowserIncident(createIncident({code: "server_exception"}, "browser")), false);
});

test("unusual exception getters cannot break the incident builder", () => {
  const error = Object.defineProperties({}, {name: {get() {throw new Error("private");}}, stack: {get() {throw new Error("private");}}});
  assert.equal(validIncident(createIncident({code: "client_exception", error}, "browser")), true);
});

test("report queue deduplicates, caps memory and stops after three failed attempts", async () => {
  let attempts = 0;
  const sizes: number[] = [];
  const reporter = createIncidentReporter({online: () => true, now: () => 1000,
    schedule: () => 1 as unknown as ReturnType<typeof setTimeout>, cancel: () => undefined,
    send: async events => { attempts++; sizes.push(events.length); throw new Error("logging itself failed"); },
  });
  const original = createIncident({code: "viewer_request_failed", status: 500}, "browser");
  assert.equal(reporter.add(original), original.id);
  assert.equal(reporter.add({...original, id: "b".repeat(32)}), original.id);
  assert.equal(reporter.size(), 1);
  await reporter.flush(); await reporter.flush(); await reporter.flush();
  assert.equal(attempts, 3); assert.equal(reporter.size(), 0);
  for (let status = 400; status < 430; status++) reporter.add(createIncident({code: "viewer_request_failed", status}, "browser"));
  assert.equal(reporter.size(), 20);
  await reporter.flush();
  assert.ok(sizes.every(size => size <= 5));
  reporter.dispose(); assert.equal(reporter.size(), 0);
});

test("offline events wait, successful delivery clears only the delivered batch", async () => {
  let online = false;
  let calls = 0;
  const reporter = createIncidentReporter({online: () => online,
    schedule: () => 1 as unknown as ReturnType<typeof setTimeout>, cancel: () => undefined,
    send: async () => {calls++; return true;},
  });
  for (let status = 500; status < 506; status++) reporter.add(createIncident({code: "viewer_request_failed", status}, "browser"));
  await reporter.flush(); assert.equal(calls, 0); assert.equal(reporter.size(), 6);
  online = true; await reporter.flush(); assert.equal(calls, 1); assert.equal(reporter.size(), 1);
  await reporter.flush(); assert.equal(reporter.size(), 0); reporter.dispose();
});

test("request deadline expires and parent cancellation remains distinguishable", async () => {
  const deadline = requestDeadline(undefined, 5);
  await new Promise(resolve => setTimeout(resolve, 12));
  assert.equal(deadline.signal.aborted, true); assert.equal(deadline.timedOut(), true); deadline.dispose();
  const parent = new AbortController(); const cancelled = requestDeadline(parent.signal, 1000);
  parent.abort(); assert.equal(cancelled.signal.aborted, true); assert.equal(cancelled.timedOut(), false); cancelled.dispose();
});
