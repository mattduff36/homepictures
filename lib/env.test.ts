import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const source = readFileSync(join(process.cwd(), "lib", "env.ts"), "utf8");
const example = readFileSync(join(process.cwd(), ".env.example"), "utf8");
const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");

test("ENV-BOUNDARY-01: camera URL is independent and share URL is gone", () => {
  assert.match(source, /export function getCameraUrl/);
  assert.match(source, /parseCameraUrl\(readEnv\("CAMERA_URL"\)\)/);
  assert.match(source, /export function getSharedLogin/);
  assert.match(source, /export function getTailscaleAuthKey/);
  assert.match(source, /TAILSCALE_SHARED_LOGIN_EMAIL/);
  assert.match(source, /TAILSCALE_SHARED_LOGIN_PASSWORD/);
  assert.match(source, /TAILSCALE_SHARED_LOGIN_PROVIDER/);
  assert.match(source, /TAILSCALE_AUTHKEY/);
  assert.doesNotMatch(source, /getCapabilityUrls/);
  assert.doesNotMatch(source, /TAILSCALE_SHARE_URL/);
  assert.doesNotMatch(source, /TAILSCALE_API_KEY/);
  assert.doesNotMatch(source, /NEXT_PUBLIC_/);
  assert.doesNotMatch(source, /console\.(log|info|debug|error)/);
  assert.doesNotMatch(example, /TAILSCALE_SHARE_URL/);
  assert.doesNotMatch(example, /TAILSCALE_API_KEY/);
  assert.doesNotMatch(example, /NEXT_PUBLIC_/);
  assert.match(readme, /TAILSCALE_SHARE_URL` is obsolete/);
  assert.doesNotMatch(source, /process\.env\.TAILSCALE_SHARE_URL/);
});
