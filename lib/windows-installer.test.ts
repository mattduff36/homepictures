import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { TAILSCALE_DOWNLOADS } from "./platforms";
import {
  CAMERA_SAFE_TAILSCALE_POLICIES,
  HOMEPICTURES_LEGACY_STATE_DIR,
  HOMEPICTURES_RECORD_PATH,
  HOMEPICTURES_RESTORE_PATH,
  HOMEPICTURES_STATE_DIR,
  OTHER_PLATFORM_NOTE,
  TAILSCALE_POLICY_KEY,
  WINDOWS_INSTALLER_FILENAME,
  WINDOWS_INSTALLER_PATH,
  WINDOWS_INSTALLER_STEPS,
  WINDOWS_PRIMARY_ACTION,
  WINDOWS_PRIMARY_HEADING_RECOMMENDED,
  WINDOWS_PRIMARY_SUPPORTING,
  WINDOWS_SECONDARY_ACTION,
  WINDOWS_SECONDARY_SUPPORTING,
} from "./windows-installer";

const root = process.cwd();

test("Windows installer is a same-origin public download with no secrets", () => {
  assert.equal(WINDOWS_INSTALLER_FILENAME, "Install-CCTV-Tailscale.ps1");
  assert.equal(WINDOWS_INSTALLER_PATH, "/Install-CCTV-Tailscale.ps1");
  assert.equal(TAILSCALE_DOWNLOADS.windows.href, WINDOWS_INSTALLER_PATH);
  assert.doesNotMatch(WINDOWS_INSTALLER_PATH, /tailscale\.com/);
});

test("camera-safe policy contract matches the supported Tailscale registry values", () => {
  assert.equal(TAILSCALE_POLICY_KEY, "HKLM\\SOFTWARE\\Policies\\Tailscale");
  assert.deepEqual(
    CAMERA_SAFE_TAILSCALE_POLICIES.map((policy) => [policy.name, policy.value]),
    [
      ["UseTailscaleDNSSettings", "always"],
      ["UseTailscaleSubnets", "never"],
      ["AllowIncomingConnections", "never"],
      ["AdvertiseExitNode", "never"],
      ["ExitNodesPicker", "hide"],
    ],
  );
  assert.equal(HOMEPICTURES_STATE_DIR, "C:\\ProgramData\\MPDEE-HomePictures");
  assert.equal(
    HOMEPICTURES_RECORD_PATH,
    "C:\\ProgramData\\MPDEE-HomePictures\\homepictures-tailscale-record.json",
  );
  assert.equal(
    HOMEPICTURES_RESTORE_PATH,
    "C:\\ProgramData\\MPDEE-HomePictures\\Restore-Tailscale-Defaults.ps1",
  );
  assert.equal(HOMEPICTURES_LEGACY_STATE_DIR, "C:\\ProgramData\\MPDEE\\HomePictures");
  assert.notEqual(HOMEPICTURES_STATE_DIR, HOMEPICTURES_LEGACY_STATE_DIR);
});

test("Step 1 copy matches the Windows onboarding contract", () => {
  assert.equal(WINDOWS_PRIMARY_HEADING_RECOMMENDED, "Windows — Recommended");
  assert.equal(WINDOWS_PRIMARY_ACTION, "Install Tailscale for Camera Access");
  assert.match(WINDOWS_PRIMARY_SUPPORTING, /official Tailscale client/);
  assert.match(WINDOWS_PRIMARY_SUPPORTING, /without enabling subnet routing/);
  assert.match(WINDOWS_PRIMARY_SUPPORTING, /normal internet route/);
  assert.deepEqual(WINDOWS_INSTALLER_STEPS, [
    "Download the installer.",
    "Right-click it and choose Run with PowerShell.",
    "Approve the Windows administrator prompt.",
  ]);
  assert.equal(WINDOWS_SECONDARY_ACTION, "I already have Tailscale");
  assert.equal(
    WINDOWS_SECONDARY_SUPPORTING,
    "We'll leave your existing Tailscale configuration untouched.",
  );
  assert.equal(
    OTHER_PLATFORM_NOTE,
    "Camera access does not require an exit node or subnet routing.",
  );
});

test("setup flow uses the public installer download and Windows options", () => {
  const source = readFileSync(join(root, "components", "setup-flow.tsx"), "utf8");
  assert.match(source, /WINDOWS_INSTALLER_PATH/);
  assert.match(source, /download=\{WINDOWS_INSTALLER_FILENAME\}/);
  assert.match(source, /WINDOWS_PRIMARY_ACTION/);
  assert.match(source, /WINDOWS_SECONDARY_ACTION/);
  assert.match(source, /TAILSCALE_DOWNLOADS\[platform\]/);
  assert.doesNotMatch(source, /tailscale\.com\/download\/windows/);
  assert.doesNotMatch(source, /OTHER_PLATFORM_ORDER/);
});

test("other platforms keep official Tailscale install routes", () => {
  assert.equal(TAILSCALE_DOWNLOADS.macos.href, "https://tailscale.com/download/mac");
  assert.equal(
    TAILSCALE_DOWNLOADS.ios.href,
    "https://apps.apple.com/app/tailscale/id1470499037",
  );
  assert.equal(
    TAILSCALE_DOWNLOADS.android.href,
    "https://play.google.com/store/apps/details?id=com.tailscale.ipn",
  );
  assert.equal(TAILSCALE_DOWNLOADS.linux.href, "https://tailscale.com/download/linux");
});
