import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getExpectedOrigin,
  isAllowedOrigin,
  isAllowedSameOriginRead,
} from "./origin";

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

test("same-origin GET reads may omit Origin in production", () => {
  const sameOrigin = makeRequest({
    host: "cameras.example",
    "x-forwarded-proto": "https",
    "sec-fetch-site": "same-origin",
  });
  assert.equal(isAllowedSameOriginRead(sameOrigin, true), true);
  assert.equal(isAllowedOrigin(sameOrigin, true), false);

  const omittedSite = makeRequest({
    host: "cameras.example",
    "x-forwarded-proto": "https",
  });
  assert.equal(isAllowedSameOriginRead(omittedSite, true), true);

  const crossSite = makeRequest({
    host: "cameras.example",
    "x-forwarded-proto": "https",
    "sec-fetch-site": "cross-site",
  });
  assert.equal(isAllowedSameOriginRead(crossSite, true), false);

  const evil = makeRequest({
    host: "cameras.example",
    "x-forwarded-proto": "https",
    origin: "https://evil.example",
  });
  assert.equal(isAllowedSameOriginRead(evil, true), false);
});
