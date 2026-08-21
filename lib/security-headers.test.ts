import assert from "node:assert/strict";
import { test } from "node:test";
import {
  STATIC_SECURITY_HEADERS,
  buildContentSecurityPolicy,
  shouldDisableStore,
} from "./security-headers";

const cameraOrigin = "https://canary-camera.example.ts.net";

test("production CSP includes framing and object restrictions without third-party script hosts", () => {
  const csp = buildContentSecurityPolicy("abc123", false);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'self'/);
  assert.match(csp, /form-action 'self'/);
  assert.match(csp, /nonce-abc123/);
  assert.match(csp, /connect-src 'self'/);
  assert.doesNotMatch(csp, /tailscale\.com/);
  assert.doesNotMatch(csp, /unsafe-eval/);
  assert.doesNotMatch(csp, /connect-src \*/);
  assert.doesNotMatch(csp, /\*\.ts\.net/);
});

test("production CSP permits only the exact validated camera origin in connect-src", () => {
  const csp = buildContentSecurityPolicy("abc123", false, cameraOrigin);
  assert.match(csp, /connect-src 'self' https:\/\/canary-camera\.example\.ts\.net/);
  assert.doesNotMatch(csp, /connect-src \*/);
  assert.doesNotMatch(csp, /\*\.ts\.net/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'self'/);
  assert.match(csp, /form-action 'self'/);
});

test("invalid camera origins are ignored without throwing", () => {
  const fallback = "connect-src 'self'";
  assert.match(buildContentSecurityPolicy("abc123", false, null), new RegExp(fallback));
  assert.match(buildContentSecurityPolicy("abc123", false, "not a url"), new RegExp(fallback));
  assert.match(
    buildContentSecurityPolicy("abc123", false, "http://canary-camera.example.ts.net"),
    new RegExp(fallback),
  );
  assert.match(
    buildContentSecurityPolicy(
      "abc123",
      false,
      "https://user:pass@canary-camera.example.ts.net",
    ),
    new RegExp(fallback),
  );
  assert.match(
    buildContentSecurityPolicy("abc123", false, "https://canary-camera.example.ts.net/path"),
    new RegExp(fallback),
  );
});

test("Permissions-Policy is unchanged and does not disable local-network", () => {
  const permissions = STATIC_SECURITY_HEADERS.find(
    (header) => header.key === "Permissions-Policy",
  );
  assert.equal(
    permissions?.value,
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), accelerometer=(), gyroscope=(), magnetometer=()",
  );
  assert.doesNotMatch(permissions?.value ?? "", /local-network/);
});

test("HTML, setup, and auth routes disable store", () => {
  assert.equal(shouldDisableStore("/"), true);
  assert.equal(shouldDisableStore("/setup"), true);
  assert.equal(shouldDisableStore("/api/login"), true);
  assert.equal(shouldDisableStore("/api/setup/credentials"), true);
  assert.equal(shouldDisableStore("/api/setup/windows-signin"), true);
  assert.equal(shouldDisableStore("/_next/static/chunk.js"), false);
  assert.equal(shouldDisableStore("/Install-CCTV-Tailscale.ps1"), false);
  assert.equal(shouldDisableStore("/Install-CCTV-Tailscale.cmd"), false);
});
