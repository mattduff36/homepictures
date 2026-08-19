import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getCameraHealthUrl,
  getCameraOrigin,
  isHttpsUrl,
  parseCameraUrl,
} from "./camera-url";

const valid = "https://canary-camera.example.ts.net/";
const validWithPath = "https://canary-camera.example.ts.net/cameras?x=1#hash";

test("rejects missing, malformed, non-HTTPS, and credential-bearing camera URLs", () => {
  assert.equal(parseCameraUrl(null), null);
  assert.equal(parseCameraUrl(undefined), null);
  assert.equal(parseCameraUrl(""), null);
  assert.equal(parseCameraUrl("   "), null);
  assert.equal(parseCameraUrl("not-a-url"), null);
  assert.equal(parseCameraUrl("http://canary-camera.example.ts.net/"), null);
  assert.equal(parseCameraUrl("https://user:secret@canary-camera.example.ts.net/"), null);
  assert.equal(parseCameraUrl("https://user@canary-camera.example.ts.net/"), null);
  assert.equal(isHttpsUrl("http://example.com"), false);
  assert.equal(isHttpsUrl("https://user:pass@example.com"), false);
  assert.equal(parseCameraUrl(valid), valid);
});

test("derives the exact camera origin without path, query, fragment, or wildcard", () => {
  assert.equal(getCameraOrigin(valid), "https://canary-camera.example.ts.net");
  assert.equal(getCameraOrigin(validWithPath), "https://canary-camera.example.ts.net");
  assert.equal(getCameraOrigin("http://canary-camera.example.ts.net/"), null);
  assert.equal(getCameraOrigin("https://user:pass@canary-camera.example.ts.net/"), null);
  assert.doesNotMatch(getCameraOrigin(valid) ?? "", /\*/);
  assert.doesNotMatch(getCameraOrigin(valid) ?? "", /\/cameras/);
});

test("derives origin-root /healthz including when CAMERA_URL has a path", () => {
  assert.equal(getCameraHealthUrl(valid), "https://canary-camera.example.ts.net/healthz");
  assert.equal(
    getCameraHealthUrl(validWithPath),
    "https://canary-camera.example.ts.net/healthz",
  );
  assert.equal(getCameraHealthUrl("not-a-url"), null);
  assert.equal(getCameraHealthUrl("http://canary-camera.example.ts.net/"), null);
});
