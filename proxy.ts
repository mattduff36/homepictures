import { NextResponse, type NextRequest } from "next/server";
import { getCameraOrigin } from "@/lib/camera-url";
import { CAMERA_URL } from "@/lib/constants";
import {
  buildContentSecurityPolicy,
  shouldDisableStore,
  STATIC_SECURITY_HEADERS,
  offlineAssetHeaders,
} from "@/lib/security-headers";

export function proxy(request: NextRequest) {
  const publicOfflineHeaders = offlineAssetHeaders(request.nextUrl.pathname);
  if (publicOfflineHeaders) {
    const response = NextResponse.next();
    for (const header of STATIC_SECURITY_HEADERS) response.headers.set(header.key, header.value);
    for (const [name, value] of Object.entries(publicOfflineHeaders)) response.headers.set(name, value);
    return response;
  }
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  const cameraOrigin = getCameraOrigin(CAMERA_URL);
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
