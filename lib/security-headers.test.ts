import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildContentSecurityPolicy,
  shouldDisableStore,
} from "./security-headers";

test("production CSP includes framing and object restrictions without third-party script hosts", () => {
  const csp = buildContentSecurityPolicy("abc123", false);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'self'/);
  assert.match(csp, /form-action 'self'/);
  assert.match(csp, /nonce-abc123/);
  assert.doesNotMatch(csp, /tailscale.com/);
  assert.doesNotMatch(csp, /unsafe-eval/);
});

test("only HTML and auth routes disable store", () => {
  assert.equal(shouldDisableStore("/"), true);
  assert.equal(shouldDisableStore("/api/login"), true);
  assert.equal(shouldDisableStore("/_next/static/chunk.js"), false);
  assert.equal(shouldDisableStore("/Install-CCTV-Tailscale.ps1"), false);
});
