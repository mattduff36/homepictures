import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { GET as getCredentials, POST as postCredentials } from "../app/api/setup/credentials/route";
import { GET as getWindowsSignin, POST as postWindowsSignin } from "../app/api/setup/windows-signin/route";

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

test("SEC-API-01: obsolete secret and download routes are closed with no-store", async () => {
  for (const source of [credentials, windowsSignin]) {
    assert.match(source, /jsonError\(410/);
    assert.doesNotMatch(source, /getSharedLogin|getTailscaleAuthKey|buildWindowsSigninLauncher/);
    assert.doesNotMatch(source, /process\.env/);
    assert.doesNotMatch(source, /console\.(log|debug|error)/);
    assert.doesNotMatch(source, /NEXT_PUBLIC_/);
  }

  for (const handler of [getCredentials, getWindowsSignin]) {
    const response = handler();
    assert.equal(response.status, 410);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(response.headers.get("Content-Disposition"), null);
    const body = await response.json();
    assert.deepEqual(Object.keys(body), ["error"]);
    assert.match(body.error, /retired/);
    assert.doesNotMatch(JSON.stringify(body), /tskey-|@|https?:/);
  }
  for (const handler of [postCredentials, postWindowsSignin]) {
    assert.equal(handler().status, 405);
  }
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
  assert.doesNotMatch(flow, /\/api\/setup\/credentials|\/api\/setup\/windows-signin/);
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
