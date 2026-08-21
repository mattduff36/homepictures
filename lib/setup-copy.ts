import type { PlatformId } from "./platforms";

export const SETUP_STAGE_TITLES = [
  "Install Tailscale",
  "Sign in to Camera Access",
  "Connect and verify camera access",
  "Open Cameras",
  "Add Cameras to your Home Screen",
] as const;

export type HomeScreenKind = "ios" | "android" | "desktop" | "linux" | "choose";

export function homeScreenKind(platform: PlatformId | null): HomeScreenKind {
  if (platform === "ios") {
    return "ios";
  }
  if (platform === "android") {
    return "android";
  }
  if (platform === "windows" || platform === "macos") {
    return "desktop";
  }
  if (platform === "linux") {
    return "linux";
  }
  return "choose";
}

export function usesWindowsInstaller(platform: PlatformId | null): boolean {
  return platform === "windows";
}

export function usesWindowsSigninHelper(platform: PlatformId | null): boolean {
  return platform === "windows";
}

export function usesAppStoreInstall(platform: PlatformId | null): boolean {
  return platform === "ios";
}
