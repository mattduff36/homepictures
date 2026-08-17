import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { CAMERA_SAFE_TAILSCALE_POLICIES } from "./windows-installer";

const root = process.cwd();
const installer = readFileSync(
  join(root, "public", "Install-CCTV-Tailscale.ps1"),
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
  for (const marker of SECRET_MARKERS) {
    assert.doesNotMatch(
      installer,
      new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `installer must not contain ${marker}`,
    );
  }
  assert.doesNotMatch(installer, /ts\.net/);
  assert.doesNotMatch(installer, /192\.168\./);
  assert.doesNotMatch(installer, /authkey/i);
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
  assert.match(installer, /Connect Camera Access/);
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
  assert.match(installer, /C:\\ProgramData\\MPDEE\\HomePictures/);
  assert.match(installer, /Restore-Tailscale-Defaults\.ps1/);
  assert.match(installer, /homepictures-tailscale-record\.json/);
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
