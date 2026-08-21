import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  CAMERA_SAFE_TAILSCALE_POLICIES,
  HOMEPICTURES_LEGACY_STATE_DIR,
  HOMEPICTURES_RECORD_PATH,
  HOMEPICTURES_RESTORE_PATH,
  HOMEPICTURES_STATE_DIR,
} from "./windows-installer";

const root = process.cwd();
const installer = readFileSync(
  join(root, "public", "Install-CCTV-Tailscale.ps1"),
  "utf8",
);
const installerLauncher = readFileSync(
  join(root, "public", "Install-CCTV-Tailscale.cmd"),
  "utf8",
);
const restore = readFileSync(
  join(root, "scripts", "windows", "Restore-Tailscale-Defaults.ps1"),
  "utf8",
);

const SECRET_MARKERS = [
  "SETUP_PASSWORD",
  "SESSION_SECRET",
  "TAILSCALE_SHARE_URL",
  "TAILSCALE_SHARED_LOGIN_EMAIL",
  "TAILSCALE_SHARED_LOGIN_PASSWORD",
  "TAILSCALE_AUTHKEY",
  "CAMERA_URL",
  "TS_AUTHKEY",
  "TS_LOGINURL",
  "LoginURL",
  "--authkey",
  "--exit-node",
  "--advertise-routes",
  "--advertise-exit-node",
  "--accept-routes",
  "NEXT_PUBLIC_",
  "process.env",
];

test("the public installer contains no secrets or capability URLs", () => {
  for (const source of [installer, installerLauncher]) {
    for (const marker of SECRET_MARKERS) {
      assert.doesNotMatch(
        source,
        new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
        `installer must not contain ${marker}`,
      );
    }
    assert.doesNotMatch(source, /ts\.net/);
    assert.doesNotMatch(source, /192\.168\./);
    assert.doesNotMatch(source, /authkey/i);
    assert.doesNotMatch(source, /Invoke-Expression/);
    assert.doesNotMatch(source, /\biex\b/i);
  }
});

test("the public installer only downloads from the official stable package host", () => {
  assert.match(installer, /https:\/\/pkgs\.tailscale\.com\/stable\//);
  assert.match(installer, /AllowAutoRedirect = \$false/);
  assert.match(installer, /pkgs\.tailscale\.com/);
  assert.doesNotMatch(installer, /https:\/\/tailscale\.com\/download\//);
  assert.doesNotMatch(installer, /Invoke-WebRequest/);
});

test("the public installer verifies checksum and Tailscale Authenticode before install", () => {
  assert.match(installer, /Get-FileHash -LiteralPath \$Path -Algorithm SHA256/);
  assert.match(installer, /Get-AuthenticodeSignature/);
  assert.match(installer, /Tailscale Inc\./);
  assert.match(installer, /Status -ne 'Valid'/);
  assert.match(installer, /No fallback that weakens these checks will be used/);
});

test("the public installer leaves existing Tailscale installs and managed policies untouched", () => {
  assert.match(installer, /function Test-TailscaleAlreadyInstalled/);
  assert.match(installer, /Show-ExistingInstallMessage/);
  assert.match(installer, /left your existing Tailscale installation untouched/);
  assert.match(installer, /function Get-ManagedPolicyInspection/);
  assert.match(installer, /will not overwrite a managed configuration/);
  assert.match(installer, /Return to the Camera Access setup wizard and continue with sign in/);
  assert.match(installer, /function Test-IsTailscaleUninstallDisplayName/);
  assert.match(installer, /PSObject\.Properties\['DisplayName'\]/);
});

test("the public installer applies only the camera-safe registry policies", () => {
  assert.match(installer, /HKLM:\\SOFTWARE\\Policies\\Tailscale/);
  for (const policy of CAMERA_SAFE_TAILSCALE_POLICIES) {
    assert.match(installer, new RegExp(policy.name));
    assert.match(
      installer,
      new RegExp(`Name = '${policy.name}'; Value = '${policy.value}'`),
    );
  }
  assert.doesNotMatch(installer, /TS_ENABLEDNS/);
  assert.doesNotMatch(installer, /TS_AUTHKEY/);
});

test("the public installer can roll back only policies it wrote", () => {
  assert.match(installer, /function Undo-HomePicturesPolicies/);
  assert.match(installer, /C:\\ProgramData\\MPDEE-HomePictures/);
  assert.match(installer, /Restore-Tailscale-Defaults\.ps1/);
  assert.match(installer, /homepictures-tailscale-record\.json/);
  assert.match(installer, /\$script:CreatedStateDir/);
  assert.match(installer, /\$script:WroteStateFiles/);
  assert.match(
    installer,
    /try \{\s*Install-CameraSafePolicies\s*Install-OfficialTailscale[\s\S]*Undo-HomePicturesPolicies/,
  );
});

test("trusted installer state uses only the dedicated MPDEE-HomePictures directory", () => {
  const legacyPattern = new RegExp(
    HOMEPICTURES_LEGACY_STATE_DIR.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );

  assert.equal(HOMEPICTURES_STATE_DIR, "C:\\ProgramData\\MPDEE-HomePictures");
  assert.match(installer, /Join-Path \$env:ProgramData 'MPDEE-HomePictures'/);
  assert.match(restore, /Join-Path \$env:ProgramData 'MPDEE-HomePictures'/);
  assert.match(
    installer,
    new RegExp(HOMEPICTURES_RECORD_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  assert.match(
    installer,
    new RegExp(HOMEPICTURES_RESTORE_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  assert.match(
    restore,
    new RegExp(HOMEPICTURES_RECORD_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  assert.doesNotMatch(installer, legacyPattern);
  assert.doesNotMatch(restore, legacyPattern);
  assert.doesNotMatch(installer, /Join-Path \$env:ProgramData 'MPDEE'/);
  assert.doesNotMatch(restore, /Join-Path \$env:ProgramData 'MPDEE'/);
  assert.doesNotMatch(installer, /C:\\ProgramData\\MPDEE exists/);
  assert.doesNotMatch(installer, /C:\\ProgramData\\MPDEE\\HomePictures/);
  assert.doesNotMatch(restore, /C:\\ProgramData\\MPDEE\\HomePictures/);
});

test("the dedicated state directory is created only after elevation and verified before use", () => {
  const protect = installer.slice(
    installer.indexOf("function Protect-HomePicturesStateDir"),
    installer.indexOf("function Show-ManagedPolicyMessage"),
  );
  const existingBranch = protect.slice(0, protect.indexOf("New-Item"));
  const createBranch = protect.slice(protect.indexOf("New-Item"));
  const main = installer.slice(installer.indexOf("#region HomePictures-Main"));

  assert.match(installer, /function Protect-HomePicturesStateDir/);
  assert.match(installer, /function Assert-ExistingHomePicturesStateDir/);
  assert.match(installer, /function Assert-ProtectedStateAcl/);
  assert.match(installer, /function Test-DirectoryOwnerIsPrivileged/);
  assert.match(installer, /function Assert-TrustedStateFile/);
  assert.match(installer, /function Protect-HomePicturesStateFile/);
  assert.match(installer, /function New-AdminOnlyFileAcl/);
  assert.match(installer, /was not empty after creation/);
  assert.match(installer, /AreAccessRulesProtected/);
  assert.match(installer, /SetAccessRuleProtection\(\$true, \$false\)/);
  assert.match(installer, /SetOwner\(\$adminSid\)/);
  assert.doesNotMatch(existingBranch, /Set-Acl/);
  assert.doesNotMatch(existingBranch, /New-AdminOnlyDirectoryAcl/);
  assert.match(createBranch, /Set-Acl/);
  assert.match(createBranch, /Assert-ProtectedStateAcl/);
  assert.match(createBranch, /Test-NotReparsePoint/);
  assert.ok(main.indexOf("Restart-Elevated") < main.indexOf("Install-CameraSafePolicies"));
  assert.ok(
    installer.indexOf("Protect-HomePicturesStateDir") <
      installer.indexOf("$script:WroteStateFiles = $true"),
  );
});

test("the restore script refuses to delete unrelated Tailscale policies", () => {
  for (const marker of SECRET_MARKERS) {
    assert.doesNotMatch(
      restore,
      new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }
  assert.match(restore, /homepictures-tailscale-record\.json/);
  assert.match(restore, /will not change Tailscale policies without that record/);
  assert.match(restore, /value changed since HomePictures installed it/);
  assert.match(restore, /never uninstalls Tailscale/);
  assert.match(restore, /\$AllowedCameraPolicies/);
  assert.match(restore, /not a HomePictures camera policy/);
  assert.match(restore, /camera-viewing-client/);
});

test("the public launcher double-clicks into the auditable script and does not invoke it in memory", () => {
  assert.match(installerLauncher, /Start-Process -FilePath '%~f0' -Verb RunAs/);
  assert.match(installerLauncher, /curl\.exe -fsS --proto =https --max-redirs 0/);
  assert.match(installerLauncher, /https:\/\/cctv\.mpdee\.uk\/Install-CCTV-Tailscale\.ps1/);
  assert.match(installerLauncher, /powershell\.exe -NoProfile -ExecutionPolicy Bypass -File "%PS1%"/);
  assert.match(installerLauncher, /-ReturnUrl "%RETURN_URL%" -ReturnFlag "installed"/);
  assert.doesNotMatch(installerLauncher, /Invoke-WebRequest/);
  assert.doesNotMatch(installerLauncher, /Invoke-Expression/);
});

test("the public installer opens setup on success and waits only after an error", () => {
  assert.match(installer, /function Complete-InstallerSuccess/);
  assert.match(installer, /windows=' \+ \$Flag/);
  assert.match(installer, /Start-Process \$target\.AbsoluteUri/);
  assert.match(installer, /\$script:SkipWait = \$true/);
  assert.match(installer, /Show-ExistingInstallMessage\s+Complete-InstallerSuccess/);
  assert.match(installer, /Show-SuccessMessage\s+Complete-InstallerSuccess/);
  const errorBranch = installer.slice(installer.indexOf("Installation stopped. No fallback"));
  assert.match(errorBranch, /exit 1/);
  assert.match(installer, /if \(-not \$script:SkipWait\) \{\s*Wait-ForReader/);
});

test("the public installer quotes paths and checks managed policies before UAC", () => {
  assert.match(installer, /-File `"\$PSCommandPath`"/);
  assert.match(installer, /\/i `"\$InstallerPath`"/);
  assert.match(installer, /function Protect-HomePicturesStateDir/);
  const main = installer.slice(
    installer.indexOf("HomePictures camera-safe Tailscale installer"),
  );
  const alreadyInstalled = main.indexOf("if (Test-TailscaleAlreadyInstalled)");
  const managedCheck = main.indexOf("$readablePolicies = Get-ManagedPolicyInspection");
  const unreadable = main.indexOf("Show-UnreadablePolicyMessage");
  const elevate = main.indexOf("Restart-Elevated");
  assert.ok(alreadyInstalled >= 0);
  assert.ok(managedCheck > alreadyInstalled);
  assert.ok(unreadable > managedCheck);
  assert.ok(elevate > unreadable);
  assert.match(installer, /function New-AdminOnlyDirectoryAcl/);
  assert.match(installer, /Refusing to use a reparse point/);
  assert.match(installer, /will not request administrator permission or change settings/);
});
