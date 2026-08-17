import "server-only";

import { cookies } from "next/headers";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "./constants";
import { getSessionSecret } from "./env";
import { verifySessionToken } from "./session";

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

export function expiredSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 0,
  };
}

export async function hasValidSession(): Promise<boolean> {
  const secret = getSessionSecret();
  if (!secret) {
    return false;
  }

  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) {
    return false;
  }

  return verifySessionToken(token, secret);
}
