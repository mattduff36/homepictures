import { createHmac, timingSafeEqual } from "node:crypto";
import {
  MAX_SESSION_TOKEN_CHARS,
  SESSION_MAX_AGE_SECONDS,
  SESSION_VERSION,
} from "./constants";

type SessionPayload = {
  v: number;
  iat: number;
  exp: number;
};

function encodeBase64Url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

function decodeCanonicalBase64Url(value: string): Buffer | null {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) {
    return null;
  }

  let decoded: Buffer;
  try {
    decoded = Buffer.from(value, "base64url");
  } catch {
    return null;
  }

  if (decoded.length === 0 || encodeBase64Url(decoded) !== value) {
    return null;
  }

  return decoded;
}

function signBody(body: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(body).digest();
}

function signaturesMatch(left: Buffer, right: Buffer): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePayload(raw: Buffer): SessionPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  const { v, iat, exp } = parsed;
  if (
    typeof v !== "number" ||
    !Number.isInteger(v) ||
    typeof iat !== "number" ||
    !Number.isInteger(iat) ||
    typeof exp !== "number" ||
    !Number.isInteger(exp)
  ) {
    return null;
  }

  return { v, iat, exp };
}

export function createSessionToken(secret: string, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const payload: SessionPayload = {
    v: SESSION_VERSION,
    iat,
    exp: iat + SESSION_MAX_AGE_SECONDS,
  };
  const body = encodeBase64Url(Buffer.from(JSON.stringify(payload), "utf8"));
  const signature = encodeBase64Url(signBody(body, secret));
  return `${body}.${signature}`;
}

export function verifySessionToken(
  token: string,
  secret: string,
  now = Date.now(),
): boolean {
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    token.length > MAX_SESSION_TOKEN_CHARS
  ) {
    return false;
  }

  const separator = token.indexOf(".");
  if (separator <= 0 || token.lastIndexOf(".") !== separator) {
    return false;
  }

  const body = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const payloadBuffer = decodeCanonicalBase64Url(body);
  const signatureBuffer = decodeCanonicalBase64Url(signature);

  if (!payloadBuffer || !signatureBuffer) {
    return false;
  }

  const expectedSignature = signBody(body, secret);
  if (!signaturesMatch(signatureBuffer, expectedSignature)) {
    return false;
  }

  const payload = parsePayload(payloadBuffer);
  if (!payload || payload.v !== SESSION_VERSION) {
    return false;
  }

  const nowSeconds = Math.floor(now / 1000);

  if (payload.iat > nowSeconds) {
    return false;
  }

  if (payload.exp <= payload.iat) {
    return false;
  }

  if (payload.exp - payload.iat > SESSION_MAX_AGE_SECONDS) {
    return false;
  }

  if (payload.exp <= nowSeconds) {
    return false;
  }

  return true;
}
