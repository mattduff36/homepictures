import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = process.cwd();
const credentials = readFileSync(
  join(root, "app", "api", "setup", "credentials", "route.ts"),
  "utf8",
);
const windowsSignin = readFileSync(
  join(root, "app", "api", "setup", "windows-signin", "route.ts"),
  "utf8",
);
const setupPage = readFileSync(join(root, "app", "setup", "page.tsx"), "utf8");
const home = readFileSync(join(root, "app", "page.tsx"), "utf8");
const flow = readFileSync(join(root, "components", "setup-flow.tsx"), "utf8");
const installer = readFileSync(
  join(root, "public", "Install-CCTV-Tailscale.ps1"),
  "utf8",
);
const installerLauncher = readFileSync(
  join(root, "public", "Install-CCTV-Tailscale.cmd"),
  "utf8",
);

test("SEC-API-01: setup secret routes enforce session and no-store", () => {
  for (const source of [credentials, windowsSignin]) {
    assert.match(source, /hasValidSession/);
    assert.match(source, /isAllowedSameOriginRead/);
    assert.match(source, /jsonError\(401/);
    assert.match(source, /jsonError\(503/);
    assert.match(source, /private, no-store/);
    assert.doesNotMatch(source, /console\.(log|debug|error)/);
    assert.doesNotMatch(source, /NEXT_PUBLIC_/);
  }

  assert.match(credentials, /email: login.email/);
  assert.match(credentials, /password: login.password/);
  assert.match(credentials, /provider: login.provider/);
  assert.doesNotMatch(credentials, /authKey/);
  assert.match(windowsSignin, /buildWindowsSigninLauncher\(authKey\)/);
  assert.match(windowsSignin, /Content-Disposition/);
  assert.match(windowsSignin, /attachment/);
});

test("SEC-HTML-01: setup HTML paths do not embed shared password or auth key", () => {
  assert.match(setupPage, /getCameraUrl/);
  assert.match(setupPage, /<SetupFlow cameraUrl=\{cameraUrl\} \/>/);
  assert.doesNotMatch(setupPage, /getSharedLogin/);
  assert.doesNotMatch(setupPage, /getTailscaleAuthKey/);
  assert.doesNotMatch(setupPage, /getCapabilityUrls/);
  assert.doesNotMatch(setupPage, /shareUrl/);
  assert.doesNotMatch(flow, /TAILSCALE_AUTHKEY/);
  assert.doesNotMatch(flow, /TAILSCALE_SHARED_LOGIN_PASSWORD/);
  assert.match(flow, /\/api\/setup\/credentials/);
  assert.match(home, /getCameraUrl/);
  assert.doesNotMatch(home, /getSharedLogin/);
  assert.doesNotMatch(home, /getTailscaleAuthKey/);
  assert.doesNotMatch(home, /TAILSCALE_AUTHKEY/);
});

test("SEC-INSTALLER-01: public installer stays secret-free", () => {
  for (const source of [installer, installerLauncher]) {
    assert.doesNotMatch(source, /TAILSCALE_SHARED_LOGIN/);
    assert.doesNotMatch(source, /TAILSCALE_AUTHKEY/);
    assert.doesNotMatch(source, /tskey-/);
    assert.doesNotMatch(source, /Complete-CCTV-Tailscale-Signin/);
    assert.doesNotMatch(source, /--auth-key/);
    assert.doesNotMatch(source, /Invoke-Expression/);
    assert.doesNotMatch(source, /\biex\b/i);
  }
});
