import assert from "node:assert/strict";
import { test } from "node:test";
import { passwordsMatch } from "./password";

test("matches identical passwords", () => {
  assert.equal(passwordsMatch("correct-horse-battery", "correct-horse-battery"), true);
});

test("rejects different passwords of equal length", () => {
  assert.equal(passwordsMatch("correct-horse-battery", "correct-horse-batterx"), false);
});

test("rejects different passwords of different length", () => {
  assert.equal(passwordsMatch("short", "a-much-longer-password"), false);
});
