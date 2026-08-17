import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import { test } from "node:test";
import { SESSION_MAX_AGE_SECONDS } from "./constants";
import { createSessionToken, verifySessionToken } from "./session";

const SECRET = "canary-session-secret-32b-min-ok";
const OTHER_SECRET = "other-session-secret-32-bytes!!";

test("accepts a freshly issued token", () => {
  const now = Date.UTC(2026, 7, 17, 12, 0, 0);
  const token = createSessionToken(SECRET, now);
  assert.equal(verifySessionToken(token, SECRET, now), true);
});

test("rejects a tampered payload", () => {
  const now = Date.UTC(2026, 7, 17, 12, 0, 0);
  const token = createSessionToken(SECRET, now);
  const [body, signature] = token.split(".");
  const tampered = `${body!.slice(0, -2)}ab.${signature}`;
  assert.equal(verifySessionToken(tampered, SECRET, now), false);
});

test("rejects a token signed with a different secret", () => {
  const now = Date.UTC(2026, 7, 17, 12, 0, 0);
  const token = createSessionToken(SECRET, now);
  assert.equal(verifySessionToken(token, OTHER_SECRET, now), false);
});

test("rejects an expired token", () => {
  const issued = Date.UTC(2026, 7, 17, 12, 0, 0);
  const token = createSessionToken(SECRET, issued);
  const later = issued + (SESSION_MAX_AGE_SECONDS + 1) * 1000;
  assert.equal(verifySessionToken(token, SECRET, later), false);
});

test("rejects a future-issued token", () => {
  const now = Date.UTC(2026, 7, 17, 12, 0, 0);
  const token = createSessionToken(SECRET, now + 10 * 60 * 1000);
  assert.equal(verifySessionToken(token, SECRET, now), false);
});

test("rejects an unknown version", () => {
  const now = Date.UTC(2026, 7, 17, 12, 0, 0);
  const iat = Math.floor(now / 1000);
  const body = Buffer.from(
    JSON.stringify({ v: 99, iat, exp: iat + SESSION_MAX_AGE_SECONDS }),
  ).toString("base64url");
  const signature = createHmac("sha256", SECRET).update(body).digest("base64url");
  assert.equal(verifySessionToken(`${body}.${signature}`, SECRET, now), false);
});

test("rejects oversized tokens", () => {
  const now = Date.UTC(2026, 7, 17, 12, 0, 0);
  const token = `${"a".repeat(400)}.${"b".repeat(200)}`;
  assert.equal(verifySessionToken(token, SECRET, now), false);
});

test("rejects malformed tokens", () => {
  const now = Date.UTC(2026, 7, 17, 12, 0, 0);
  assert.equal(verifySessionToken("", SECRET, now), false);
  assert.equal(verifySessionToken("noperiod", SECRET, now), false);
  assert.equal(verifySessionToken("too.many.parts", SECRET, now), false);
  assert.equal(verifySessionToken("%%%notbase64.url", SECRET, now), false);
});

function signedToken(payload: { v: number; iat: number; exp: number }) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", SECRET).update(body).digest("base64url");
  return `${body}.${signature}`;
}

test("accepts an exact 24-hour lifetime and rejects one extra second", () => {
  const now = Date.UTC(2026, 7, 17, 12, 0, 0);
  const iat = Math.floor(now / 1000);
  assert.equal(
    verifySessionToken(
      signedToken({ v: 1, iat, exp: iat + SESSION_MAX_AGE_SECONDS }),
      SECRET,
      now,
    ),
    true,
  );
  assert.equal(
    verifySessionToken(
      signedToken({ v: 1, iat, exp: iat + SESSION_MAX_AGE_SECONDS + 1 }),
      SECRET,
      now,
    ),
    false,
  );
});

test("rejects inverted or empty lifetimes", () => {
  const now = Date.UTC(2026, 7, 17, 12, 0, 0);
  const iat = Math.floor(now / 1000);
  assert.equal(
    verifySessionToken(signedToken({ v: 1, iat, exp: iat }), SECRET, now),
    false,
  );
  assert.equal(
    verifySessionToken(signedToken({ v: 1, iat, exp: iat - 1 }), SECRET, now),
    false,
  );
});
