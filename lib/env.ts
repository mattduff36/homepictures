import "server-only";

import { Buffer } from "node:buffer";
import {
  CAMERA_URL,
  MIN_SESSION_SECRET_BYTES,
  MIN_SETUP_PASSWORD_LENGTH,
} from "./constants";

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

export function getCameraUrl(): string {
  return CAMERA_URL;
}
