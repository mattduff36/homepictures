import "server-only";

import { Buffer } from "node:buffer";
import { parseCameraUrl } from "./camera-url";
import { MIN_SESSION_SECRET_BYTES, MIN_SETUP_PASSWORD_LENGTH } from "./constants";
import {
  parseSharedLogin,
  parseTailscaleAuthKey,
  type SharedLogin,
} from "./setup-secrets";

function readEnv(name: string): string | null {
  const value = process.env[name];
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function getSetupPassword(): string | null {
  const password = readEnv("SETUP_PASSWORD");
  if (!password || password.length < MIN_SETUP_PASSWORD_LENGTH) {
    return null;
  }

  return password;
}

export function getSessionSecret(): string | null {
  const secret = readEnv("SESSION_SECRET");
  if (!secret || Buffer.byteLength(secret, "utf8") < MIN_SESSION_SECRET_BYTES) {
    return null;
  }

  return secret;
}

export function getCameraUrl(): string | null {
  return parseCameraUrl(readEnv("CAMERA_URL"));
}

export function getSharedLogin(): SharedLogin | null {
  return parseSharedLogin({
    email: process.env.TAILSCALE_SHARED_LOGIN_EMAIL,
    password: process.env.TAILSCALE_SHARED_LOGIN_PASSWORD,
    provider: process.env.TAILSCALE_SHARED_LOGIN_PROVIDER,
  });
}

export function getTailscaleAuthKey(): string | null {
  return parseTailscaleAuthKey(process.env.TAILSCALE_AUTHKEY);
}
