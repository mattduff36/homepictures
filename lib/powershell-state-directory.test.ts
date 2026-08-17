import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  HOMEPICTURES_LEGACY_STATE_DIR,
  HOMEPICTURES_STATE_DIR,
} from "./windows-installer";

const root = process.cwd();
const installer = readFileSync(
  join(root, "public", "Install-CCTV-Tailscale.ps1"),
  "utf8",
);
const restore = readFileSync(
  join(root, "scripts", "windows", "Restore-Tailscale-Defaults.ps1"),
  "utf8",
);

test("the dedicated HomePictures state path is MPDEE-HomePictures and the old MPDEE tree is unused", () => {
  assert.equal(HOMEPICTURES_STATE_DIR, "C:\\ProgramData\\MPDEE-HomePictures");
  assert.match(installer, /Join-Path \$env:ProgramData 'MPDEE-HomePictures'/);
  assert.match(restore, /Join-Path \$env:ProgramData 'MPDEE-HomePictures'/);
  assert.doesNotMatch(installer, /MPDEE\\HomePictures/);
  assert.doesNotMatch(restore, /MPDEE\\HomePictures/);
  assert.doesNotMatch(
    installer,
    new RegExp(HOMEPICTURES_LEGACY_STATE_DIR.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  assert.doesNotMatch(installer, /Join-Path \$env:ProgramData 'MPDEE'/);
});

test("PowerShell installer and restore scripts parse cleanly", () => {
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      join(root, "scripts", "windows", "parse-check.ps1"),
    ],
    {
      encoding: "utf8",
      windowsHide: true,
    },
  );

  assert.equal(
    result.status,
    0,
    result.stderr || result.stdout || "PowerShell parse checks failed",
  );
  assert.match(result.stdout, /POWERSHELL_PARSE_CHECKS_PASSED/);
});

test("state-directory ACL, rollback, and legacy-path isolation hold under StrictMode", () => {
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      join(root, "scripts", "windows", "state-directory.test.ps1"),
    ],
    {
      encoding: "utf8",
      windowsHide: true,
    },
  );

  assert.equal(
    result.status,
    0,
    result.stderr || result.stdout || "PowerShell state-directory tests failed",
  );
  assert.match(result.stdout, /STATE_DIRECTORY_TESTS_PASSED/);
});
