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

test("the installer inspects DisplayName through PSObject.Properties", () => {
  assert.match(installer, /function Get-StrictProperty/);
  assert.match(installer, /function Test-IsTailscaleUninstallDisplayName/);
  assert.match(installer, /\$App\.PSObject\.Properties\['DisplayName'\]/);
  assert.match(installer, /\$Object\.PSObject\.Properties\[\$Name\]/);
  assert.doesNotMatch(
    installer,
    /Where-Object \{[\s\S]*\$_\.DisplayName/,
  );
});

test("uninstall-registry objects without DisplayName are skipped under StrictMode", () => {
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      join(root, "scripts", "windows", "strict-mode-properties.test.ps1"),
    ],
    {
      encoding: "utf8",
      windowsHide: true,
    },
  );

  assert.equal(
    result.status,
    0,
    result.stderr || result.stdout || "PowerShell StrictMode property tests failed",
  );
  assert.match(result.stdout, /STRICT_MODE_PROPERTY_TESTS_PASSED/);
});
