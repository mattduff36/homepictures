import assert from "node:assert/strict";
import { test } from "node:test";
import { getExpectedOrigin, isAllowedOrigin } from "./origin";

function makeRequest(headers: Record<string, string>) {
  return new Request("https://example.test/api/login", { headers });
}

test("builds the expected origin from forwarded headers", () => {
  const request = makeRequest({
    host: "internal.local",
    "x-forwarded-host": "cameras.example",
    "x-forwarded-proto": "https",
  });
  assert.equal(getExpectedOrigin(request), "https://cameras.example");
});

test("rejects a missing origin in production", () => {
  const request = makeRequest({
    host: "cameras.example",
    "x-forwarded-proto": "https",
  });
  assert.equal(isAllowedOrigin(request, true), false);
});

test("rejects a mismatched origin in production", () => {
  const request = makeRequest({
    host: "cameras.example",
    "x-forwarded-proto": "https",
    origin: "https://evil.example",
  });
  assert.equal(isAllowedOrigin(request, true), false);
});

test("accepts a matching origin in production", () => {
  const request = makeRequest({
    host: "cameras.example",
    "x-forwarded-proto": "https",
    origin: "https://cameras.example",
  });
  assert.equal(isAllowedOrigin(request, true), true);
});

test("allows a missing origin in development", () => {
  const request = makeRequest({
    host: "localhost:3000",
  });
  assert.equal(isAllowedOrigin(request, false), true);
});

test("rejects a malformed origin", () => {
  const request = makeRequest({
    host: "cameras.example",
    "x-forwarded-proto": "https",
    origin: "not a url",
  });
  assert.equal(isAllowedOrigin(request, true), false);
});
