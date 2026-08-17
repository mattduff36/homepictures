import { SESSION_COOKIE } from "@/lib/constants";
import { getClientIp } from "@/lib/client-ip";
import { sessionCookieOptions } from "@/lib/auth";
import { getSessionSecret, getSetupPassword } from "@/lib/env";
import { jsonError, jsonOk } from "@/lib/http";
import { isAllowedOrigin } from "@/lib/origin";
import { passwordsMatch } from "@/lib/password";
import { loginRateLimiter } from "@/lib/rate-limit";
import { hasJsonContentType, readJsonBody, readPasswordField } from "@/lib/request";
import { createSessionToken } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function genericFailure(status = 401) {
  return jsonError(status, "Incorrect password");
}

export async function POST(request: Request) {
  if (!isAllowedOrigin(request)) {
    return genericFailure(403);
  }

  if (!hasJsonContentType(request)) {
    return genericFailure(400);
  }

  const body = await readJsonBody(request);
  if (!body.ok) {
    return genericFailure(body.status);
  }

  const password = readPasswordField(body.value);
  if (password === null) {
    return genericFailure(400);
  }

  const limited = loginRateLimiter.check(getClientIp(request));
  if (!limited.ok) {
    console.info("login_rate_limited");
    return jsonError(429, "Too many attempts. Try again later.");
  }

  const expectedPassword = getSetupPassword();
  const sessionSecret = getSessionSecret();
  if (!expectedPassword || !sessionSecret) {
    console.info("login_misconfigured");
    return jsonError(503, "Setup is temporarily unavailable.");
  }

  if (!passwordsMatch(password, expectedPassword)) {
    console.info("login_failed");
    return genericFailure(401);
  }

  const response = jsonOk();
  response.cookies.set(
    SESSION_COOKIE,
    createSessionToken(sessionSecret),
    sessionCookieOptions(),
  );
  return response;
}

export function GET() {
  return jsonError(405, "Method not allowed");
}
