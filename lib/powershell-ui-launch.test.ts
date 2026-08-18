import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = process.cwd();
const installer = readFileSync(
  join(root, "public", "Install-CCTV-Tailscale.ps1"),
  "utf8",
);
const startClient = installer.slice(
  installer.indexOf("function Test-TailscaleUiIsRunning"),
  installer.indexOf("function Remove-TempDirectory"),
);
const main = installer.slice(installer.indexOf("#region HomePictures-Main"));

test("Start-TailscaleClient waits for an existing tailscale-ipn UI and never launches tailscale.exe", () => {
  assert.match(startClient, /function Test-TailscaleUiIsRunning/);
  assert.match(startClient, /Get-Process -Name 'tailscale-ipn'/);
  assert.match(startClient, /Start-Sleep -Milliseconds \$pollDelayMs/);
  assert.match(startClient, /\$pollAttempts = 10/);
  assert.match(startClient, /\$pollDelayMs = 500/);
  assert.match(startClient, /Tailscale client is already open/);
  assert.match(startClient, /Opened the Tailscale client/);
  assert.match(
    startClient,
    /Join-Path \$env:ProgramFiles 'Tailscale\\tailscale-ipn\.exe'/,
  );
  assert.doesNotMatch(startClient, /tailscale\.exe/);
  assert.match(
    startClient,
    /could not be opened automatically\. Open Tailscale from the Start menu/,
  );
});

test("post-install UI launch is non-fatal and the success message still follows", () => {
  const rollbackTry = main.indexOf("Install-OfficialTailscale");
  const rollbackCatch = main.indexOf("Undo-HomePicturesPolicies");
  const startClientCall = main.indexOf("Start-TailscaleClient");
  const success = main.indexOf("Show-SuccessMessage");

  assert.ok(rollbackTry >= 0);
  assert.ok(rollbackCatch > rollbackTry);
  assert.ok(startClientCall > rollbackCatch);
  assert.ok(success > startClientCall);
  assert.match(startClient, /try \{/);
  assert.match(startClient, /catch \{/);
});

test("Start-TailscaleClient runtime behaviour holds under StrictMode", () => {
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      join(root, "scripts", "windows", "start-tailscale-client.test.ps1"),
    ],
    {
      encoding: "utf8",
      windowsHide: true,
    },
  );

  assert.equal(
    result.status,
    0,
    result.stderr || result.stdout || "PowerShell UI-launch tests failed",
  );
  assert.match(result.stdout, /START_TAILSCALE_CLIENT_TESTS_PASSED/);
});
