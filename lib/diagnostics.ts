import { exactFields, isCameraId, type CameraId } from "./viewer-protocol";

/** Deliberately closed vocabulary: never put exception text, URLs or user data in an event. */
export const INCIDENT_CODES = ["client_exception", "unhandled_rejection", "render_failed", "asset_failed",
  "viewer_request_failed", "viewer_response_invalid", "viewer_timeout", "viewer_network_failed",
  "playback_failed", "playback_stalled", "snapshot_failed", "session_check_failed", "setup_request_failed",
  "unsupported_browser", "server_exception", "gateway_unavailable", "gateway_rejected", "turn_unavailable",
  "invalid_upstream_response", "lease_cleanup_failed"] as const;
export const INCIDENT_OPERATIONS = ["login", "logout", "session", "config", "offer", "poll", "heartbeat",
  "snapshot", "stop", "sessions", "revoke-session", "recording", "render", "bootstrap", "setup-login",
  "setup-logout", "playback", "asset", "unknown"] as const;
const PAGES = ["home", "watch", "setup", "unknown"] as const;
const NAMES = ["", "Error", "TypeError", "ReferenceError", "SyntaxError", "RangeError", "TimeoutError",
  "AbortError", "NetworkError", "NotSupportedError", "NotAllowedError", "Other"] as const;
const CODE_MODULES = ["camera-viewer", "viewer-player", "viewer-server", "viewer-protocol", "saved-sessions",
  "password-gate", "setup-flow", "vision-settings", "vision-startup", "connection-gateway", "camera-health",
  "runtime-recovery", "error-fallback", "camera-boundary", "error", "global-error", "layout", "page",
  "diagnostics", "diagnostics-client", "diagnostics-server", "client-request", "instrumentation-client",
  "instrumentation"];
export type IncidentCode = typeof INCIDENT_CODES[number];
export type IncidentOperation = typeof INCIDENT_OPERATIONS[number];
export type Incident = {
  version: 1; id: string; time: number; source: "browser" | "server"; code: IncidentCode;
  page: typeof PAGES[number]; operation: IncidentOperation; severity: "warning" | "error";
  status: number; camera: CameraId | ""; errorName: typeof NAMES[number]; location: string;
  release: string; traceId: string; reference: string;
};
export type IncidentInput = Partial<Omit<Incident, "version" | "source" | "id" | "time" | "errorName">> & {
  code: IncidentCode; error?: unknown; errorName?: unknown;
};
const KEYS = ["version", "id", "time", "source", "code", "page", "operation", "severity", "status",
  "camera", "errorName", "location", "release", "traceId", "reference"] as const;
export const INCIDENT_BATCH_MAX = 5;
export const INCIDENT_BODY_MAX = 16384;
export const isIncidentId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{32}$/.test(value);

function includes<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}
export function incidentPage(path: unknown): Incident["page"] {
  if (typeof path !== "string") return "unknown";
  const clean = path.split(/[?#]/, 1)[0];
  return clean === "/" ? "home" : clean === "/watch" ? "watch" : clean === "/setup" ? "setup" : "unknown";
}
export function incidentOperation(value: unknown): IncidentOperation {
  return includes(INCIDENT_OPERATIONS, value) ? value : "unknown";
}
export function safeRelease(value: unknown): string {
  return typeof value === "string" && /^(?:local|unknown|[0-9a-f]{7,40})$/.test(value) ? value : "unknown";
}
export function safeErrorName(error: unknown): Incident["errorName"] {
  try {
    const name = typeof error === "string" ? error : error && typeof error === "object" ? (error as {name?: unknown}).name : "";
    return includes(NAMES, name) ? name : name ? "Other" : "";
  } catch { return "Other"; }
}
export function safeLocation(value: unknown): string {
  if (typeof value !== "string") return "";
  // Match only known source modules or generated hex chunks. Queries, user filenames and directories disappear.
  const filename = `(?:${CODE_MODULES.join("|")})\\.(?:js|ts|tsx)|[0-9a-f]{8,32}(?:\\.[0-9a-f]{8,32})?\\.js`;
  const match = new RegExp(`(?:^|[\\s/(\\\\])(${filename}):(\\d{1,7}):(\\d{1,6})(?=$|[\\s)])`).exec(value.slice(0, 4096));
  return match && Number(match[2]) > 0 && Number(match[3]) > 0 ? `${match[1]}:${Number(match[2])}:${Number(match[3])}` : "";
}
function errorLocation(error: unknown) {
  try { return safeLocation(error && typeof error === "object" ? (error as {stack?: unknown}).stack : ""); }
  catch { return ""; }
}
export function incidentId(): string {
  const bytes = new Uint8Array(16);
  try { globalThis.crypto.getRandomValues(bytes); }
  catch { for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256); }
  return Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
}
export function createIncident(input: IncidentInput, source: Incident["source"], now = Date.now()): Incident {
  return {
    version: 1, id: incidentId(), time: Math.floor(now / 1000), source,
    code: includes(INCIDENT_CODES, input.code) ? input.code : source === "browser" ? "client_exception" : "server_exception",
    page: includes(PAGES, input.page) ? input.page : "unknown", operation: incidentOperation(input.operation),
    severity: input.severity === "warning" ? "warning" : "error",
    status: Number.isInteger(input.status) && Number(input.status) >= 400 && Number(input.status) <= 599 ? Number(input.status) : 0,
    camera: isCameraId(input.camera) ? input.camera : "", errorName: safeErrorName(input.errorName ?? input.error),
    location: safeLocation(input.location) || errorLocation(input.error), release: safeRelease(input.release),
    traceId: isIncidentId(input.traceId) ? input.traceId : "", reference: isIncidentId(input.reference) ? input.reference : "",
  };
}
export function validIncident(value: unknown): value is Incident {
  return exactFields(value, KEYS) && value.version === 1 && isIncidentId(value.id) &&
    Number.isSafeInteger(value.time) && Number(value.time) > 0 && (value.source === "browser" || value.source === "server") &&
    includes(INCIDENT_CODES, value.code) && includes(PAGES, value.page) && includes(INCIDENT_OPERATIONS, value.operation) &&
    (value.severity === "warning" || value.severity === "error") && Number.isInteger(value.status) &&
    (value.status === 0 || Number(value.status) >= 400 && Number(value.status) <= 599) &&
    (value.camera === "" || isCameraId(value.camera)) && includes(NAMES, value.errorName) &&
    typeof value.location === "string" && value.location.length <= 120 && (value.location === "" || safeLocation(value.location) === value.location) &&
    typeof value.release === "string" && safeRelease(value.release) === value.release &&
    (value.traceId === "" || isIncidentId(value.traceId)) && (value.reference === "" || isIncidentId(value.reference));
}
export function incidentFingerprint(event: Incident): string {
  return [event.source, event.code, event.page, event.operation, event.status, event.camera, event.errorName, event.location].join("|");
}
export function normalizeBrowserIncident(event: Incident, release: string, now = Date.now()): Incident {
  const normalized = createIncident({...event, severity: event.code === "client_exception" || event.code === "unhandled_rejection" ||
    event.code === "render_failed" ? "error" : "warning", release, traceId: ""}, "browser", now);
  // ID is an opaque correlation reference, never authority. All metadata is reconstructed from the allowlist.
  normalized.id = event.id;
  return normalized;
}
export function isBrowserIncident(event: Incident): boolean {
  return event.source === "browser" && !["server_exception", "gateway_unavailable", "gateway_rejected", "turn_unavailable",
    "invalid_upstream_response"].includes(event.code);
}
