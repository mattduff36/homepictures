import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = process.cwd();

test("root is the connection gateway and setup stays password-protected", () => {
  const home = readFileSync(join(root, "app", "page.tsx"), "utf8");
  const setup = readFileSync(join(root, "app", "setup", "page.tsx"), "utf8");

  assert.match(home, /getCameraUrl/);
  assert.match(home, /ConnectionGateway/);
  assert.match(home, /redirect\("\/setup"\)/);
  assert.doesNotMatch(home, /PasswordGate/);
  assert.doesNotMatch(home, /getCapabilityUrls/);
  assert.doesNotMatch(home, /getSharedLogin/);
  assert.doesNotMatch(home, /TAILSCALE_SHARE_URL/);
  assert.doesNotMatch(home, /TAILSCALE_AUTHKEY/);

  assert.match(setup, /hasValidSession/);
  assert.match(setup, /PasswordGate/);
  assert.match(setup, /SetupFlow/);
  assert.match(setup, /getCameraUrl/);
  assert.doesNotMatch(setup, /getCapabilityUrls/);
});

test("login and lock return to /setup and Open MPDEE Vision still assigns CAMERA_URL", () => {
  const gate = readFileSync(join(root, "components", "password-gate.tsx"), "utf8");
  const flow = readFileSync(join(root, "components", "setup-flow.tsx"), "utf8");

  assert.match(gate, /window\.location\.replace\("\/setup"\)/);
  assert.doesNotMatch(gate, /window\.location\.replace\("\/"\)/);
  assert.match(flow, /window\.location\.replace\("\/setup"\)/);
  assert.match(flow, /window\.location\.assign\(cameraUrl\)/);
});
