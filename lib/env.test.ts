import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { CAMERA_URL } from "./constants";
import { getCameraHealthUrl, getCameraOrigin } from "./camera-url";
import { buildContentSecurityPolicy } from "./security-headers";

const source = readFileSync(join(process.cwd(), "lib", "env.ts"), "utf8");
const example = readFileSync(join(process.cwd(), ".env.example"), "utf8");
const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");

test("ENV-BOUNDARY-01: Dell URL is canonical and obsolete secrets are never read", () => {
  assert.match(source, /export function getCameraUrl/);
  assert.match(source, /return CAMERA_URL/);
  assert.doesNotMatch(source, /getSharedLogin|getTailscaleAuthKey|TAILSCALE_/);
  assert.doesNotMatch(source, /readEnv\("CAMERA_URL"\)/);
  assert.doesNotMatch(source, /getCapabilityUrls/);
  assert.doesNotMatch(source, /TAILSCALE_SHARE_URL/);
  assert.doesNotMatch(source, /TAILSCALE_API_KEY/);
  assert.doesNotMatch(source, /NEXT_PUBLIC_/);
  assert.doesNotMatch(source, /console\.(log|info|debug|error)/);
  assert.doesNotMatch(example, /TAILSCALE_SHARE_URL/);
  assert.doesNotMatch(example, /TAILSCALE_API_KEY/);
  assert.doesNotMatch(example, /NEXT_PUBLIC_/);
  assert.match(readme, /CAMERA_URL.*ignored/);
  assert.doesNotMatch(source, /process\.env\.TAILSCALE_SHARE_URL/);
  assert.equal(CAMERA_URL, "https://mpdee-vision.tail03543e.ts.net/");
  assert.equal(getCameraHealthUrl(CAMERA_URL), `${CAMERA_URL}healthz`);
  const csp = buildContentSecurityPolicy("test", false, getCameraOrigin(CAMERA_URL));
  assert.match(csp, /connect-src 'self' https:\/\/mpdee-vision\.tail03543e\.ts\.net(?:;|$)/);
  const proxy = readFileSync(join(process.cwd(), "proxy.ts"), "utf8");
  assert.match(proxy, /getCameraOrigin\(CAMERA_URL\)/);
  assert.doesNotMatch(proxy, /process\.env\.CAMERA_URL/);
});
