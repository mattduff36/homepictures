export const WINDOWS_INSTALLER_FILENAME = "Install-CCTV-Tailscale.ps1";
export const WINDOWS_INSTALLER_PATH = `/${WINDOWS_INSTALLER_FILENAME}`;

export const WINDOWS_PRIMARY_HEADING_RECOMMENDED = "Windows — Recommended";
export const WINDOWS_PRIMARY_HEADING = "Windows";
export const WINDOWS_PRIMARY_ACTION = "Install Tailscale for Camera Access";
export const WINDOWS_PRIMARY_SUPPORTING =
  "Downloads the official Tailscale client and configures it for camera access without enabling subnet routing or changing your normal internet route.";

export const WINDOWS_INSTALLER_STEPS = [
  "Download the installer.",
  "Right-click it and choose Run with PowerShell.",
  "Approve the Windows administrator prompt.",
] as const;

export const WINDOWS_SECONDARY_ACTION = "I already have Tailscale";
export const WINDOWS_SECONDARY_SUPPORTING =
  "We'll leave your existing Tailscale configuration untouched.";

export const OTHER_PLATFORM_NOTE =
  "Camera access does not require an exit node or subnet routing.";

export const TAILSCALE_POLICY_KEY = "HKLM\\SOFTWARE\\Policies\\Tailscale";

export const CAMERA_SAFE_TAILSCALE_POLICIES = [
  { name: "UseTailscaleDNSSettings", value: "always" },
  { name: "UseTailscaleSubnets", value: "never" },
  { name: "AllowIncomingConnections", value: "never" },
  { name: "AdvertiseExitNode", value: "never" },
  { name: "ExitNodesPicker", value: "hide" },
] as const;

export const HOMEPICTURES_STATE_DIR = "C:\\ProgramData\\MPDEE\\HomePictures";
export const HOMEPICTURES_RECORD_FILENAME = "homepictures-tailscale-record.json";
export const HOMEPICTURES_RESTORE_FILENAME = "Restore-Tailscale-Defaults.ps1";

export const OTHER_PLATFORM_IDS = ["macos", "ios", "android", "linux"] as const;
