import { expiredSessionCookieOptions } from "@/lib/auth";
import { SESSION_COOKIE } from "@/lib/constants";
import { jsonError, jsonOk } from "@/lib/http";
import { isAllowedOrigin } from "@/lib/origin";
import { hasJsonContentType, readJsonBody } from "@/lib/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isAllowedOrigin(request)) {
    return jsonError(403, "Unable to lock the setup page.");
  }

  if (!hasJsonContentType(request)) {
    return jsonError(400, "Unable to lock the setup page.");
  }

  const body = await readJsonBody(request);
  if (!body.ok) {
    return jsonError(body.status, "Unable to lock the setup page.");
  }

  const response = jsonOk();
  response.cookies.set(SESSION_COOKIE, "", expiredSessionCookieOptions());
  return response;
}

export function GET() {
  return jsonError(405, "Method not allowed");
}
