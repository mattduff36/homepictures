import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { after } from "next/server";
import { createRateLimiter } from "./rate-limit";
import { VIEWER_GATEWAY_ORIGIN, exactFields } from "./viewer-protocol";
import { createIncident, incidentId, incidentFingerprint, INCIDENT_BATCH_MAX, INCIDENT_BODY_MAX, validIncident, isBrowserIncident,
  normalizeBrowserIncident, safeRelease, type Incident, type IncidentInput } from "./diagnostics";

export const serverRelease = () => safeRelease(process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.NEXT_PUBLIC_APP_RELEASE ?? "local");
const state = globalThis as typeof globalThis & { __visionIncidentLimiter?: ReturnType<typeof createRateLimiter> };
const limiter = state.__visionIncidentLimiter ??= createRateLimiter({windowMs: 60000, maxAttempts: 12, maxKeys: 256});
const globalState = globalThis as typeof globalThis & { __visionIncidentGlobal?: ReturnType<typeof createRateLimiter> };
const globalLimiter = globalState.__visionIncidentGlobal ??= createRateLimiter({windowMs: 60000, maxAttempts: 120, maxKeys: 1});

type ReportState = {recent: Map<string, {id: string; at: number}>; windowStart: number; count: number; sinkBlockedUntil: number};
const reportGlobal = globalThis as typeof globalThis & {__visionIncidentReporting?: ReportState};
const reporting = reportGlobal.__visionIncidentReporting ??= {recent: new Map(), windowStart: 0, count: 0, sinkBlockedUntil: 0};

function writeIncident(event: Incident) {
  try { console.error(JSON.stringify({event: "website_incident", incident: event})); } catch { /* Console failure must be harmless. */ }
}
export async function deliverIncidents(events: Incident[], fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (Date.now() < reporting.sinkBlockedUntil) return false;
  const secret = process.env.VIEWER_SHARED_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32 || process.env.VIEWER_GATEWAY_ORIGIN !== VIEWER_GATEWAY_ORIGIN ||
      !events.length || events.length > INCIDENT_BATCH_MAX || !events.every(validIncident)) return false;
  const path = "/v1/diagnostics";
  const body = JSON.stringify({events});
  if (Buffer.byteLength(body) > INCIDENT_BODY_MAX) return false;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = incidentId();
  const signature = createHmac("sha256", secret).update(`${timestamp}\n${nonce}\nPOST\n${path}\n${body}`).digest("hex");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetchImpl(`${VIEWER_GATEWAY_ORIGIN}${path}`, {method: "POST", cache: "no-store", redirect: "error",
      signal: controller.signal, body, headers: {"Content-Type": "application/json", Accept: "application/json",
        "X-Viewer-Timestamp": timestamp, "X-Viewer-Nonce": nonce, "X-Viewer-Signature": signature}});
    if (response.status !== 200 || !response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      void response.body?.cancel().catch(() => undefined); reporting.sinkBlockedUntil = Date.now() + 30000; return false;
    }
    const responseText = await readTextLimited(response, 128, 3500);
    const value: unknown = JSON.parse(responseText);
    const accepted = exactFields(value, ["ok"]) && value.ok === true;
    if (!accepted) reporting.sinkBlockedUntil = Date.now() + 30000;
    return accepted;
  } catch { reporting.sinkBlockedUntil = Date.now() + 30000; return false; }
  finally { clearTimeout(timer); }
}

/** Console first, then request-scoped background delivery. Never waits on diagnostics in the viewing request. */
export function reportServerIncident(input: IncidentInput): string {
  try {
    const event = createIncident({...input, release: serverRelease()}, "server");
    const now = Date.now(); const key = incidentFingerprint(event); const previous = reporting.recent.get(key);
    if (previous && now - previous.at < 15000) return previous.id;
    if (now - reporting.windowStart >= 60000) {reporting.windowStart = now; reporting.count = 0;}
    if (reporting.count >= 60) return "";
    reporting.count++;
    reporting.recent.delete(key); reporting.recent.set(key, {id: event.id, at: now});
    while (reporting.recent.size > 256) reporting.recent.delete(reporting.recent.keys().next().value!);
    writeIncident(event);
    try { after(async () => { await deliverIncidents([event]); }); }
    catch { /* A test/non-request context cannot schedule after(); the safe console record remains. */ }
    return event.id;
  } catch { return ""; }
}

export class DiagnosticRequestError extends Error { constructor(public status: number) { super("Invalid diagnostic request"); } }
async function readTextLimited(input: Request | Response, limit: number, timeoutMs = 5000): Promise<string> {
  const length = input.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) throw new DiagnosticRequestError(413);
  if (!input.body) throw new DiagnosticRequestError(400);
  const reader = input.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new DiagnosticRequestError(408)), timeoutMs); });
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const {done, value} = await Promise.race([reader.read(), timeout]);
      if (done) break;
      size += value.length;
      if (size > limit) throw new DiagnosticRequestError(413);
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally { clearTimeout(timer); void reader.cancel().catch(() => undefined); }
}

type DiagnosticDependencies = { deliver?: (events: Incident[]) => Promise<boolean>; emit?: (event: Incident) => void;
  check?: (key: string) => boolean; now?: () => number };
function response(status: number) {
  return Response.json(status === 200 ? {ok: true} : {error: "Diagnostics could not be saved."}, {
    status, headers: {"Cache-Control": "private, no-store", ...(status === 429 ? {"Retry-After": "60"} : {})},
  });
}
export async function handleDiagnosticRequest(request: Request, deps: DiagnosticDependencies = {}): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (request.method !== "POST") return response(405);
    if (process.env.NODE_ENV === "production" && url.origin !== "https://cctv.mpdee.uk" ||
        request.headers.get("origin") !== url.origin ||
        request.headers.get("sec-fetch-site") && request.headers.get("sec-fetch-site") !== "same-origin") return response(403);
    if (request.headers.get("content-type")?.toLowerCase().split(";")[0].trim() !== "application/json") return response(415);
    const candidate = process.env.VERCEL === "1" ? request.headers.get("x-vercel-forwarded-for")?.trim() : undefined;
    const source = candidate && isIP(candidate) ? candidate : "unknown";
    // The limiter hashes and bounds keys in memory; raw addresses never enter incident records.
    if (!(deps.check ? deps.check(source) : globalLimiter.check("all").ok && limiter.check(source).ok)) return response(429);
    const value: unknown = JSON.parse(await readTextLimited(request, INCIDENT_BODY_MAX));
    if (!exactFields(value, ["events"]) || !Array.isArray(value.events) || !value.events.length ||
        value.events.length > INCIDENT_BATCH_MAX || !value.events.every(event => validIncident(event) && isBrowserIncident(event))) return response(400);
    const now = (deps.now ?? Date.now)();
    const events = value.events.map(event => normalizeBrowserIncident(event, serverRelease(), now));
    for (const event of events) { try { (deps.emit ?? writeIncident)(event); } catch { /* Independent fallback. */ } }
    // This endpoint may wait briefly for persistence; viewing APIs never wait for this endpoint.
    try { return response(await (deps.deliver ?? deliverIncidents)(events) ? 200 : 503); }
    catch { return response(503); }
  } catch (error) { return response(error instanceof DiagnosticRequestError ? error.status : 400); }
}
