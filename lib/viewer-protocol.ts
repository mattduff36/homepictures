export const VIEWER_CAMERA = "back-garden";
export const VIEWER_CAMERAS = [
  { id: "back-garden", label: "Back Garden", kind: "swann" },
  { id: "front-door", label: "Front Door", kind: "swann" },
  { id: "shed", label: "Shed", kind: "swann" },
  { id: "front-caravan", label: "Front Caravan", kind: "swann" },
  { id: "back-door", label: "Back Door", kind: "swann" },
  { id: "ring-doorbell", label: "Doorbell", kind: "ring" },
  { id: "ring-front", label: "Front", kind: "ring" },
  { id: "ring-side", label: "Side", kind: "ring" },
  { id: "ring-garden", label: "Garden", kind: "ring" },
  { id: "ring-back", label: "Back", kind: "ring" },
] as const;
export type ViewerCamera = (typeof VIEWER_CAMERAS)[number];
export type CameraId = ViewerCamera["id"];
export type LiveMode = "live" | "manual";
export const VIEWER_COOKIE = "__Host-mpdee-viewer";
export const VIEWER_SESSION_SECONDS = 7 * 24 * 60 * 60;
export const VIEWER_PLAYBACK_MS = 15 * 60 * 1000;
export const VIEWER_MAX_JSON = 65536;
export const VIEWER_MAX_SDP = 48000;
export const VIEWER_GATEWAY_ORIGIN = "https://mpdee-vision.tail03543e.ts.net:10000";
export const VIEWER_MAX_SNAPSHOT_JSON = 1004096;
export const VIEWER_FAILURE_MESSAGES = {
  session_limit: "This account has reached its three saved sign-ins. Sign out an old session from another signed-in device, then try again.",
  login_rate_limit: "Too many sign-in attempts. Please wait up to 15 minutes before trying again.",
  stream_capacity: "The camera viewing capacity is in use. Stop another viewing session, then retry.",
  start_rate_limit: "The hourly camera-start allowance has been reached. Please try again later.",
  snapshot_rate_limit: "The snapshot refresh limit has been reached. Please wait before refreshing. Existing snapshots remain available.",
  request_rate_limit: "The service is busy. Please wait before trying again.",
} as const;
export type ViewerFailureCode = keyof typeof VIEWER_FAILURE_MESSAGES;
export function isViewerFailureCode(value: unknown): value is ViewerFailureCode {
  return typeof value === "string" && Object.hasOwn(VIEWER_FAILURE_MESSAGES, value);
}
export const VIEWER_ACTIONS = [
  "login", "session", "sessions", "revoke-session", "config", "offer", "poll", "heartbeat", "snapshot", "stop", "logout",
] as const;
export type ViewerAction = (typeof VIEWER_ACTIONS)[number];
export type SavedSession = { id: string; issuedAt: number; expires: number; current: boolean };

export function validSavedSessions(value: unknown): value is { sessions: SavedSession[]; limit: number } {
  if (!exactFields(value, ["sessions", "limit"]) || value.limit !== 3 || !Array.isArray(value.sessions) ||
      value.sessions.length > 3) return false;
  return value.sessions.every((entry) => exactFields(entry, ["id", "issuedAt", "expires", "current"]) &&
    typeof entry.id === "string" && /^[0-9a-f]{64}$/.test(entry.id) &&
    Number.isSafeInteger(entry.issuedAt) && Number.isSafeInteger(entry.expires) &&
    Number(entry.issuedAt) > 0 && Number(entry.expires) > Number(entry.issuedAt) &&
    typeof entry.current === "boolean") &&
    value.sessions.filter((entry) => entry.current).length === 1 &&
    new Set(value.sessions.map((entry) => entry.id)).size === value.sessions.length;
}

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

export function isCameraId(value: unknown): value is CameraId {
  return typeof value === "string" && VIEWER_CAMERAS.some((camera) => camera.id === value);
}

export function isLiveMode(camera: CameraId, mode: unknown): mode is LiveMode {
  return camera.startsWith("ring-") ? mode === "manual" : mode === "live";
}

export function validCameras(value: unknown): value is ViewerCamera[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 10 &&
    value.every((entry) => exactFields(entry, ["id", "label", "kind"]) &&
      VIEWER_CAMERAS.some((camera) => camera.id === entry.id &&
        camera.label === entry.label && camera.kind === entry.kind)) &&
    new Set(value.map((camera: ViewerCamera) => camera.id)).size === value.length;
}

export function validPoll(value: unknown): value is {
  events: Array<{ candidate: string; sdpMLineIndex: number }>; closed: boolean;
} {
  return exactFields(value, ["events", "closed"]) && typeof value.closed === "boolean" &&
    Array.isArray(value.events) && value.events.length <= 48 &&
    value.events.every((event) => exactFields(event, ["candidate", "sdpMLineIndex"]) &&
      typeof event.candidate === "string" && event.candidate.startsWith("candidate:") &&
      event.candidate.length <= 2048 && (event.sdpMLineIndex === 0 || event.sdpMLineIndex === 1));
}

export type ViewerSnapshot = { camera: CameraId; image: string; capturedAt: number | null; stale: boolean };
export function validSnapshot(value: unknown): value is ViewerSnapshot {
  return exactFields(value, ["camera", "image", "capturedAt", "stale"]) &&
    isCameraId(value.camera) && value.camera.startsWith("ring-") &&
    typeof value.image === "string" && value.image.length >= 8 && value.image.length <= 1000000 &&
    value.image.length % 4 === 0 && /^\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(value.image) &&
    (value.capturedAt === null || (Number.isSafeInteger(value.capturedAt) &&
      Number(value.capturedAt) >= 0 && Number(value.capturedAt) <= Date.now() / 1000 + 30)) &&
    typeof value.stale === "boolean";
}

export function isSdp(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("v=0\r\n") &&
    new TextEncoder().encode(value).length <= VIEWER_MAX_SDP;
}
