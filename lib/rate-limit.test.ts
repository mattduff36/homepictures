import assert from "node:assert/strict";
import { test } from "node:test";
import { createRateLimiter } from "./rate-limit";

test("allows attempts under the threshold and blocks the next", () => {
  const limiter = createRateLimiter({ windowMs: 1000, maxAttempts: 3, maxKeys: 10 });
  const start = 1_000_000;
  assert.equal(limiter.check("10.0.0.1", start).ok, true);
  assert.equal(limiter.check("10.0.0.1", start + 10).ok, true);
  assert.equal(limiter.check("10.0.0.1", start + 20).ok, true);
  assert.equal(limiter.check("10.0.0.1", start + 30).ok, false);
});

test("expires attempts after the window", () => {
  const limiter = createRateLimiter({ windowMs: 100, maxAttempts: 2, maxKeys: 10 });
  const start = 1_000_000;
  assert.equal(limiter.check("10.0.0.1", start).ok, true);
  assert.equal(limiter.check("10.0.0.1", start + 10).ok, true);
  assert.equal(limiter.check("10.0.0.1", start + 20).ok, false);
  assert.equal(limiter.check("10.0.0.1", start + 130).ok, true);
});

test("isolates keys from each other", () => {
  const limiter = createRateLimiter({ windowMs: 1000, maxAttempts: 1, maxKeys: 10 });
  const start = 1_000_000;
  assert.equal(limiter.check("10.0.0.1", start).ok, true);
  assert.equal(limiter.check("10.0.0.1", start + 1).ok, false);
  assert.equal(limiter.check("10.0.0.2", start + 1).ok, true);
});

test("prunes stale keys and stays within the memory bound", () => {
  const limiter = createRateLimiter({ windowMs: 50, maxAttempts: 1, maxKeys: 3 });
  const start = 1_000_000;
  limiter.check("a", start);
  limiter.check("b", start);
  limiter.check("c", start);
  assert.equal(limiter.size() <= 3, true);
  limiter.prune(start + 80);
  assert.equal(limiter.size(), 0);
  limiter.check("d", start + 90);
  limiter.check("e", start + 91);
  limiter.check("f", start + 92);
  limiter.check("g", start + 93);
  assert.equal(limiter.size() <= 3, true);
});
