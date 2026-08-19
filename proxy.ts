import { NextResponse, type NextRequest } from "next/server";
import { getCameraOrigin } from "@/lib/camera-url";
import {
  buildContentSecurityPolicy,
  shouldDisableStore,
  STATIC_SECURITY_HEADERS,
} from "@/lib/security-headers";

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  const cameraOrigin = getCameraOrigin(process.env.CAMERA_URL);
  const csp = buildContentSecurityPolicy(nonce, isDev, cameraOrigin);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  response.headers.set("Content-Security-Policy", csp);

  for (const header of STATIC_SECURITY_HEADERS) {
    response.headers.set(header.key, header.value);
  }

  if (shouldDisableStore(request.nextUrl.pathname)) {
    response.headers.set("Cache-Control", "private, no-store");
  }

  return response;
}

export const config = {
  matcher: [
    {
      source:
        "/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:svg|png|ico|webmanifest|ps1)$).*)",
    },
  ],
};
