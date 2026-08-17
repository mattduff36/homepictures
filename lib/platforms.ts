import {
  OTHER_PLATFORM_IDS,
  WINDOWS_INSTALLER_PATH,
} from "@/lib/windows-installer";

export type PlatformId = "windows" | "macos" | "ios" | "android" | "linux";

export const TAILSCALE_DOWNLOADS: Record<
  PlatformId,
  { label: string; href: string }
> = {
  windows: {
    label: "Windows",
    href: WINDOWS_INSTALLER_PATH,
  },
  macos: {
    label: "macOS",
    href: "https://tailscale.com/download/mac",
  },
  ios: {
    label: "iPhone / iPad",
    href: "https://apps.apple.com/app/tailscale/id1470499037",
  },
  android: {
    label: "Android",
    href: "https://play.google.com/store/apps/details?id=com.tailscale.ipn",
  },
  linux: {
    label: "Linux",
    href: "https://tailscale.com/download/linux",
  },
};

export const PLATFORM_ORDER: PlatformId[] = [
  "windows",
  "macos",
  "ios",
  "android",
  "linux",
];

export const OTHER_PLATFORM_ORDER: Exclude<PlatformId, "windows">[] = [
  ...OTHER_PLATFORM_IDS,
];

export function detectPlatform(): PlatformId | null {
  if (typeof navigator === "undefined") {
    return null;
  }

  const userAgent = navigator.userAgent;
  const platform = navigator.platform;
  const maxTouchPoints = navigator.maxTouchPoints ?? 0;

  if (
    /iPhone|iPad|iPod/i.test(userAgent) ||
    (platform === "MacIntel" && maxTouchPoints > 1)
  ) {
    return "ios";
  }

  if (/Android/i.test(userAgent)) {
    return "android";
  }

  if (/Win/i.test(userAgent)) {
    return "windows";
  }

  if (/Mac/i.test(userAgent)) {
    return "macos";
  }

  if (/Linux/i.test(userAgent)) {
    return "linux";
  }

  return null;
}
