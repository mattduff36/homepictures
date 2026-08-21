import { NextResponse } from "next/server";
import { hasValidSession } from "@/lib/auth";
import { getSharedLogin } from "@/lib/env";
import { jsonError } from "@/lib/http";
import { isAllowedSameOriginRead } from "@/lib/origin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = {
  "Cache-Control": "private, no-store",
};

export async function GET(request: Request) {
  if (!isAllowedSameOriginRead(request)) {
    return jsonError(403, "Unable to load setup details.");
  }

  if (!(await hasValidSession())) {
    return jsonError(401, "Unable to load setup details.");
  }

  const login = getSharedLogin();
  if (!login) {
    console.info("setup_credentials_unavailable");
    return jsonError(503, "Setup is temporarily unavailable.");
  }

  return NextResponse.json(
    {
      email: login.email,
      password: login.password,
      provider: login.provider,
    },
    { headers: NO_STORE },
  );
}

export function POST() {
  return jsonError(405, "Method not allowed");
}
