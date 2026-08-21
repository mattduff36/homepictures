import { NextResponse } from "next/server";
import { hasValidSession } from "@/lib/auth";
import { getTailscaleAuthKey } from "@/lib/env";
import { jsonError } from "@/lib/http";
import { isAllowedSameOriginRead } from "@/lib/origin";
import {
  WINDOWS_SIGNIN_FILENAME,
  buildWindowsSigninLauncher,
} from "@/lib/windows-signin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isAllowedSameOriginRead(request)) {
    return jsonError(403, "Unable to load setup details.");
  }

  if (!(await hasValidSession())) {
    return jsonError(401, "Unable to load setup details.");
  }

  const authKey = getTailscaleAuthKey();
  if (!authKey) {
    console.info("windows_signin_unavailable");
    return jsonError(503, "Setup is temporarily unavailable.");
  }

  const script = buildWindowsSigninLauncher(authKey);
  return new NextResponse(script, {
    status: 200,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${WINDOWS_SIGNIN_FILENAME}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function POST() {
  return jsonError(405, "Method not allowed");
}
