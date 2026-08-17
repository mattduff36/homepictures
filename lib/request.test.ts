import assert from "node:assert/strict";
import { test } from "node:test";
import { hasJsonContentType, readJsonBody, readPasswordField } from "./request";

test("accepts application/json with a charset suffix", () => {
  const request = new Request("https://example.test/api/login", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: "{}",
  });
  assert.equal(hasJsonContentType(request), true);
});

test("rejects a non-json content type", () => {
  const request = new Request("https://example.test/api/login", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "{}",
  });
  assert.equal(hasJsonContentType(request), false);
});

test("rejects an oversized body", async () => {
  const request = new Request("https://example.test/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "x".repeat(2000) }),
  });
  const result = await readJsonBody(request);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 413);
  }
});

test("rejects malformed json", async () => {
  const request = new Request("https://example.test/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not-json",
  });
  const result = await readJsonBody(request);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 400);
  }
});

test("rejects a body that only exceeds 1024 bytes after several chunks", async () => {
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode('{"password":"'));
      controller.enqueue(encoder.encode("x".repeat(500)));
      controller.enqueue(encoder.encode("x".repeat(500)));
      controller.enqueue(encoder.encode("x".repeat(200)));
      controller.enqueue(encoder.encode('"}'));
      controller.close();
    },
  });
  const request = new Request("https://example.test/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: stream,
    duplex: "half",
  } as RequestInit);
  const result = await readJsonBody(request);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 413);
  }
});

test("rejects a multibyte body that is over 1024 bytes but under 1024 characters", async () => {
  const password = "é".repeat(600);
  const request = new Request("https://example.test/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const result = await readJsonBody(request);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 413);
  }
});

test("reads a password string and rejects other shapes", () => {
  assert.equal(readPasswordField({ password: "secret" }), "secret");
  assert.equal(readPasswordField({ password: 12 }), null);
  assert.equal(readPasswordField(null), null);
  assert.equal(readPasswordField(["secret"]), null);
});
