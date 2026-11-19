import { createHmac, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { NextResponse } from "next/server";
import { hasJsonContentType } from "./request";
import { gatewayDiagnostics, transportCodes } from "./gateway-diagnostics";
import {
  exactFields, isRecord, isSdp, isViewerToken, isCameraId, isLiveMode, validCameras, validPoll,
  validRecording, validSnapshot, VIEWER_ACTIONS,
  VIEWER_COOKIE, VIEWER_GATEWAY_ORIGIN, VIEWER_MAX_JSON, VIEWER_SESSION_SECONDS,
  VIEWER_MAX_SNAPSHOT_JSON,
  validSavedSessions, isViewerFailureCode, VIEWER_FAILURE_MESSAGES, type ViewerFailureCode,
  type ViewerAction,
} from "./viewer-protocol";

const FAILURE = "Camera access is unavailable. Please try again.";
const COOKIE_OPTIONS = {
  httpOnly: true, secure: true, sameSite: "strict", path: "/",
} as const;

export class ViewerError extends Error {
  constructor(public status: number, public event: string, public code?: ViewerFailureCode, public transport?: string) {
    super(event);
  }
}

export function viewerEnabled(): boolean {
  return process.env.VIEWER_ENABLED === "true";
}

function settings() {
  const secret = process.env.VIEWER_SHARED_SECRET;
  if (!viewerEnabled() || !secret || Buffer.byteLength(secret) < 32 ||
      process.env.VIEWER_GATEWAY_ORIGIN !== VIEWER_GATEWAY_ORIGIN) {
    throw new ViewerError(503, "viewer_not_configured");
  }
  return { secret, origin: VIEWER_GATEWAY_ORIGIN };
}

export function viewerSameOrigin(request: Request): boolean {
  const url = new URL(request.url);
  if (process.env.NODE_ENV === "production" && url.origin !== "https://cctv.mpdee.uk") {
    return false;
  }
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return false;
  return request.headers.get("origin") === url.origin;
}

export async function boundedJson(input: Request | Response, limit = VIEWER_MAX_JSON): Promise<unknown> {
  if (!hasJsonContentType(input)) throw new ViewerError(400, "viewer_invalid_json");
  const length = input.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) {
    throw new ViewerError(413, "viewer_body_too_large");
  }
  if (!input.body) throw new ViewerError(400, "viewer_invalid_json");
  const reader = input.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ViewerError(504, "viewer_body_timeout")), 5000);
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new ViewerError(413, "viewer_body_too_large");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    if (error instanceof ViewerError) throw error;
    throw new ViewerError(400, "viewer_invalid_json");
  } finally {
    clearTimeout(timer);
  }
}

export function gatewaySignature(
  secret: string, timestamp: string, nonce: string, path: string, body: string,
): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}\n${nonce}\nPOST\n${path}\n${body}`, "utf8").digest("hex");
}

export function viewerSource(request: Request, secret: string): string {
  // Vercel overwrites this header; never trust caller-supplied x-real-ip / x-forwarded-for.
  const candidate = process.env.VERCEL === "1"
    ? request.headers.get("x-vercel-forwarded-for")?.trim() : null;
  const ip = candidate && isIP(candidate) ? candidate : "unknown";
  return createHmac("sha256", secret).update(`viewer-source\n${ip}`).digest("hex");
}

async function gateway(
  action: ViewerAction, body: Record<string, unknown>, fetchImpl: typeof fetch,
): Promise<unknown> {
  const { secret, origin } = settings();
  const path = `/v1/${action}`;
  const raw = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomBytes(16).toString("hex");
  let upstreamStatus: number | undefined;
  try {
    return await gatewayDiagnostics().run(nonce, action, async () => {
      const response = await fetchImpl(`${origin}${path}`, {
        method: "POST", cache: "no-store", redirect: "error",
        signal: AbortSignal.timeout(12000),
        headers: {
          "Content-Type": "application/json", Accept: "application/json",
          "X-Viewer-Timestamp": timestamp, "X-Viewer-Nonce": nonce,
          "X-Viewer-Signature": gatewaySignature(secret, timestamp, nonce, path, raw),
        },
        body: raw,
      });
      upstreamStatus = response.status;
      if (!response.ok) {
        const failure = await boundedJson(response, 2048).catch(() => null);
        const code = response.status === 429 && isRecord(failure) && isViewerFailureCode(failure.code)
          ? failure.code : undefined;
        throw new ViewerError([400, 401, 403, 413, 429].includes(response.status) ? response.status : 502,
          "viewer_gateway_denied", code);
      }
      return await boundedJson(response, action === "snapshot" ? VIEWER_MAX_SNAPSHOT_JSON : VIEWER_MAX_JSON);
    }, () => upstreamStatus);
  } catch (error) {
    if (error instanceof ViewerError) throw error;
    const transport = transportCodes(error)[0] ?? "NETWORK_ERROR";
    throw new ViewerError(502, "viewer_gateway_unavailable", undefined, transport);
  }
}

function cookieSession(request: Request): string {
  const cookies = (request.headers.get("cookie") ?? "").split(";")
    .map((part) => part.trim()).filter((part) => part.startsWith(`${VIEWER_COOKIE}=`));
  const value = cookies.length === 1 ? cookies[0].slice(VIEWER_COOKIE.length + 1) : null;
  if (!isViewerToken(value)) throw new ViewerError(401, "viewer_session_required");
  return value;
}

function json(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
}

function clearCookie(response: NextResponse) {
  response.cookies.set(VIEWER_COOKIE, "", { ...COOKIE_OPTIONS, maxAge: 0 });
}

async function turnServers(fetchImpl: typeof fetch): Promise<RTCIceServer[]> {
  const key = process.env.CF_TURN_KEY_ID;
  const token = process.env.CF_TURN_API_TOKEN;
  if (!key || !/^[A-Za-z0-9_-]{1,128}$/.test(key) || !token) {
    throw new ViewerError(503, "viewer_turn_not_configured");
  }
  try {
    const response = await fetchImpl(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(key)}/credentials/generate-ice-servers`,
      {
        method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5000),
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ttl: 1200 }),
      },
    );
    if (!response.ok) {
      void response.body?.cancel();
      throw new ViewerError(502, "viewer_turn_unavailable");
    }
    const value = await boundedJson(response, 16384);
    if (!isRecord(value) || !Array.isArray(value.iceServers)) {
      throw new ViewerError(502, "viewer_turn_invalid");
    }
    const servers: RTCIceServer[] = [];
    for (const server of value.iceServers) {
      if (!isRecord(server)) throw new ViewerError(502, "viewer_turn_invalid");
      const urls = typeof server.urls === "string" ? [server.urls] : server.urls;
      if (!Array.isArray(urls) || !urls.every((url: unknown) => typeof url === "string")) {
        throw new ViewerError(502, "viewer_turn_invalid");
      }
      const relayUrls = urls.filter((url: string) =>
        /^turns?:[a-z0-9.-]+\.cloudflare\.com:\d{2,5}(?:\?transport=(?:udp|tcp))?$/i.test(url));
      if (!relayUrls.length) continue;
      if (typeof server.username !== "string" || typeof server.credential !== "string" ||
          !server.username.length || !server.credential.length ||
          server.username.length > 2048 || server.credential.length > 2048) {
        throw new ViewerError(502, "viewer_turn_invalid");
      }
      servers.push({ urls: relayUrls, username: server.username, credential: server.credential });
    }
    if (!servers.length) throw new ViewerError(502, "viewer_turn_invalid");
    return servers;
  } catch (error) {
    if (error instanceof ViewerError) throw error;
    throw new ViewerError(502, "viewer_turn_unavailable");
  }
}

export async function handleViewerRequest(
  request: Request, actionName: string, fetchImpl: typeof fetch = fetch,
): Promise<NextResponse> {
  let clear = false;
  try {
    if (!(VIEWER_ACTIONS as readonly string[]).includes(actionName)) {
      throw new ViewerError(404, "viewer_unknown_action");
    }
    const action = actionName as ViewerAction;
    if (!viewerSameOrigin(request)) throw new ViewerError(403, "viewer_origin_denied");
    const { secret } = settings();
    const body = await boundedJson(request, action === "offer" ? VIEWER_MAX_JSON : 2048);
    if (action === "login") {
      if (!exactFields(body, ["username", "password"]) ||
          typeof body.username !== "string" || !/^[a-z0-9][a-z0-9_-]{0,47}$/.test(body.username) ||
          typeof body.password !== "string" || !Buffer.byteLength(body.password) ||
          Buffer.byteLength(body.password) > 256) {
        throw new ViewerError(400, "viewer_invalid_login");
      }
      const value = await gateway("login", { ...body, source: viewerSource(request, secret) }, fetchImpl);
      const now = Math.floor(Date.now() / 1000);
      if (!exactFields(value, ["session", "expires"]) || !isViewerToken(value.session) ||
          typeof value.expires !== "number" || !Number.isInteger(value.expires) ||
          value.expires <= now || value.expires > now + VIEWER_SESSION_SECONDS) {
        throw new ViewerError(502, "viewer_invalid_response");
      }
      const response = json({ ok: true });
      response.cookies.set(VIEWER_COOKIE, value.session, {
        ...COOKIE_OPTIONS, maxAge: value.expires - now,
      });
      return response;
    }
    const session = cookieSession(request);
    if (action === "offer") {
      if (!exactFields(body, ["camera", "lease", "sdp"]) || !isCameraId(body.camera) ||
          !isViewerToken(body.lease) || !isSdp(body.sdp)) {
        throw new ViewerError(400, "viewer_invalid_offer");
      }
    } else if (action === "stop" || action === "poll" || action === "heartbeat") {
      if (!exactFields(body, ["lease"]) || !isViewerToken(body.lease)) {
        throw new ViewerError(400, "viewer_invalid_lease");
      }
    } else if (action === "config") {
      if (!exactFields(body, ["camera", "mode"]) || !isCameraId(body.camera) ||
          !isLiveMode(body.camera, body.mode)) {
        throw new ViewerError(400, "viewer_invalid_camera");
      }
    } else if (action === "snapshot") {
      if (!exactFields(body, ["camera"]) || !isCameraId(body.camera) || !body.camera.startsWith("ring-")) {
        throw new ViewerError(400, "viewer_invalid_camera");
      }
    } else if (action === "revoke-session") {
      if (!exactFields(body, ["id"]) || typeof body.id !== "string" || !/^[0-9a-f]{64}$/.test(body.id)) {
        throw new ViewerError(400, "viewer_invalid_session_id");
      }
    } else if (!exactFields(body, [])) {
      throw new ViewerError(400, "viewer_unexpected_fields");
    }
    if (!isRecord(body)) throw new ViewerError(400, "viewer_invalid_json");
    clear = action === "logout";
    const value = await gateway(action, { ...body, session }, fetchImpl);
    if (action === "sessions") {
      if (!validSavedSessions(value)) throw new ViewerError(502, "viewer_invalid_response");
      return json(value);
    }
    if (action === "config") {
      if (!exactFields(value, ["lease", "expires", "camera"]) || !isViewerToken(value.lease) ||
          value.camera !== body.camera || typeof value.expires !== "number" ||
          !Number.isInteger(value.expires) || value.expires <= Date.now() / 1000 ||
          value.expires > Math.floor(Date.now() / 1000) +
            (String(body.camera).startsWith("ring-") ? 300 : 900)) {
        throw new ViewerError(502, "viewer_invalid_response");
      }
      try {
        const iceServers = await turnServers(fetchImpl);
        return json({ ...value, iceServers });
      } catch (error) {
        try {
          await gateway("stop", { session, lease: value.lease }, fetchImpl);
        } catch {
          console.warn("viewer_lease_release_failed");
        }
        throw error;
      }
    }
    if (action === "offer") {
      if (!exactFields(value, ["type", "sdp"]) || value.type !== "answer" || !isSdp(value.sdp)) {
        throw new ViewerError(502, "viewer_invalid_response");
      }
      return json(value);
    }
    if (action === "session") {
      if (!exactFields(value, ["username", "cameras", "expires"]) ||
          typeof value.username !== "string" || !/^[a-z0-9][a-z0-9_-]{0,47}$/.test(value.username) ||
          !validCameras(value.cameras) || !Number.isInteger(value.expires) ||
          Number(value.expires) <= Date.now() / 1000 ||
          Number(value.expires) > Date.now() / 1000 + VIEWER_SESSION_SECONDS) {
        throw new ViewerError(502, "viewer_invalid_response");
      }
      return json(value);
    }
    if (action === "poll") {
      if (!validPoll(value)) throw new ViewerError(502, "viewer_invalid_response");
      return json(value);
    }
    if (action === "recording") {
      if (!validRecording(value)) throw new ViewerError(502, "viewer_invalid_response");
      return json(value);
    }
    if (action === "snapshot") {
      if (!validSnapshot(value) || value.camera !== body.camera) {
        throw new ViewerError(502, "viewer_invalid_response");
      }
      return json(value);
    }
    if (!exactFields(value, ["ok"]) || value.ok !== true) {
      throw new ViewerError(502, "viewer_invalid_response");
    }
    const response = json({ ok: true });
    if (clear) clearCookie(response);
    return response;
  } catch (error) {
    const failure = error instanceof ViewerError ? error : new ViewerError(503, "viewer_unavailable");
    console.info(failure.transport ? { event: failure.event, transport: failure.transport } : failure.event);
    const response = json({ error: failure.code ? VIEWER_FAILURE_MESSAGES[failure.code] : failure.status === 429
      ? "Too many attempts. Please wait before trying again." : FAILURE,
      ...(failure.code ? { code: failure.code } : {}) }, failure.status);
    if (clear || failure.status === 401) clearCookie(response);
    return response;
  }
}
