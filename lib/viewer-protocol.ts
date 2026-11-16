export const VIEWER_CAMERA = "back-garden";
export const VIEWER_COOKIE = "__Host-mpdee-viewer";
export const VIEWER_SESSION_SECONDS = 7 * 24 * 60 * 60;
export const VIEWER_PLAYBACK_MS = 15 * 60 * 1000;
export const VIEWER_MAX_JSON = 65536;
export const VIEWER_MAX_SDP = 48000;
export const VIEWER_GATEWAY_ORIGIN = "https://mpdee-vision.tail03543e.ts.net:10000";
export const VIEWER_ACTIONS = ["login", "session", "config", "offer", "stop", "logout"] as const;
export type ViewerAction = (typeof VIEWER_ACTIONS)[number];

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function exactFields(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key));
}

export function isViewerToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function isSdp(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("v=0\r\n") &&
    new TextEncoder().encode(value).length <= VIEWER_MAX_SDP;
}
