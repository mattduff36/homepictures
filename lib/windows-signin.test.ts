import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  WINDOWS_SIGNIN_FILENAME,
  buildWindowsSigninScript,
} from "./windows-signin";

const authKey = "tskey-auth-CANARYHELPERKEY123";
const savedProfile = JSON.stringify([
  {
    id: "1ab3",
    nickname: "work",
    tailnet: "example.com",
    account: "family@example.com",
    selected: true,
  },
]);

function runGeneratedProfileCheck(json: string): string {
  const script = buildWindowsSigninScript(authKey);
  const start = script.indexOf("#region HomePictures-ProfilesJson");
  const end = script.indexOf("#endregion HomePictures-ProfilesJson");
  assert.ok(start >= 0 && end > start, "generated helper is missing the profile JSON function");
  const fn = script.slice(start, end + "#endregion HomePictures-ProfilesJson".length);
  const encoded = Buffer.from(json, "utf8").toString("base64");
  const dir = mkdtempSync(join(tmpdir(), "hp-signin-"));
  const file = join(dir, "check-profiles.ps1");
  writeFileSync(
    file,
    [
      fn,
      `$json = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))`,
      "if (Test-ProfilesJsonLookUnconfigured -Json $json) {",
      "  Write-Output 'UNCONFIGURED'",
      "} else {",
      "  Write-Output 'CONFIGURED'",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file],
    {
      encoding: "utf8",
      windowsHide: true,
    },
  );
  rmSync(dir, { recursive: true, force: true });
  assert.equal(
    result.status,
    0,
    result.stderr || result.stdout || "PowerShell profile check failed",
  );
  return (result.stdout || "").trim().split(/\r?\n/).at(-1) ?? "";
}

test("WIN-FRESH-01: helper uses a protected key file and never puts the key on the CLI", () => {
  const script = buildWindowsSigninScript(authKey);
  assert.equal(WINDOWS_SIGNIN_FILENAME, "Complete-CCTV-Tailscale-Signin.ps1");
  assert.match(script, /\$AuthKeyMaterial = 'tskey-auth-CANARYHELPERKEY123'/);
  assert.match(script, /Protect-AuthKeyFile/);
  assert.match(script, /SetAccessRuleProtection\(\$true, \$false\)/);
  assert.match(script, /&\s*\$exe up --auth-key=\$fileArg/);
  assert.match(script, /Remove-Item -LiteralPath \$keyPath/);
  assert.match(script, /Delete this downloaded script after use/);
  assert.doesNotMatch(script, /up --auth-key=tskey/);
  assert.doesNotMatch(script, /--authkey=/i);
  assert.doesNotMatch(script, /Write-Host \$AuthKeyMaterial/);
  assert.doesNotMatch(script, /Write-Info \$AuthKeyMaterial/);
});

test("WIN-SAFE-01: generated PowerShell treats official saved profiles as configured", () => {
  const script = buildWindowsSigninScript(authKey);
  const configuredBranch = script.slice(
    script.indexOf("if (Test-TailscaleAlreadyConfigured"),
    script.indexOf("$keyPath = Join-Path"),
  );
  assert.match(script, /Test-StatusLooksUnconfigured/);
  assert.match(script, /Test-PrefsLookUnconfigured/);
  assert.match(script, /debug prefs/);
  assert.match(script, /switch --list --json/);
  assert.match(script, /Test-ProfilesJsonLookUnconfigured/);
  assert.match(script, /id, nickname, tailnet, account, selected/);
  assert.match(script, /Test-ProfilesJsonLookUnconfigured -Json \$raw/);
  assert.match(script, /\$trimmed -eq '\[\]'/);
  assert.match(script, /return -not \(\$statusFresh -and \$prefsFresh -and \$profilesFresh\)/);
  assert.doesNotMatch(script, /switch --id/);
  assert.match(configuredBranch, /already has an account/);
  assert.match(configuredBranch, /will not switch, log out, reset/);
  assert.match(configuredBranch, /exit 2/);
  assert.doesNotMatch(configuredBranch, /&\s*\$exe up/);
  assert.doesNotMatch(script, /&\s*\$exe login/);
  assert.doesNotMatch(script, /&\s*\$exe logout/);
  assert.doesNotMatch(script, /&\s*\$exe reset/);
  assert.doesNotMatch(script, /--reset/);
  assert.doesNotMatch(script, /--exit-node/);
  assert.doesNotMatch(script, /--advertise-routes/);
  assert.doesNotMatch(script, /--accept-routes/);
  assert.equal(runGeneratedProfileCheck("[]"), "UNCONFIGURED");
  assert.equal(runGeneratedProfileCheck(savedProfile), "CONFIGURED");
  assert.equal(runGeneratedProfileCheck('{"id":"1ab3","account":"family@example.com"}'), "CONFIGURED");
  assert.equal(runGeneratedProfileCheck("not-json"), "CONFIGURED");
});
