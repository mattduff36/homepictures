import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const source = readFileSync(join(process.cwd(), "lib", "env.ts"), "utf8");

test("getCameraUrl depends only on CAMERA_URL and capabilities still require both URLs", () => {
  assert.match(source, /export function getCameraUrl/);
  assert.match(source, /parseCameraUrl\(readEnv\("CAMERA_URL"\)\)/);
  assert.match(source, /export function getCapabilityUrls/);
  assert.match(source, /const cameraUrl = getCameraUrl\(\)/);
  assert.match(source, /readEnv\("TAILSCALE_SHARE_URL"\)/);
  assert.match(source, /isHttpsUrl\(shareUrl\)/);
  assert.doesNotMatch(source, /NEXT_PUBLIC_/);
  assert.doesNotMatch(source, /console\.(log|info|debug|error)/);
});
