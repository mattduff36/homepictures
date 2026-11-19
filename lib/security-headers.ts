export const STATIC_SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), accelerometer=(), gyroscope=(), magnetometer=()",
  },
] as const;

export const OFFLINE_CONTENT_SECURITY_POLICY =
  "default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** Only these public files bypass the application's nonce-based HTML policy. */
export function offlineAssetHeaders(pathname: string): Record<string, string> | null {
  if (pathname === "/offline-worker.js") return {
    "Content-Type": "application/javascript; charset=utf-8",
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Content-Security-Policy": "default-src 'none'; connect-src 'self'",
    "Service-Worker-Allowed": "/",
  };
  if (pathname === "/offline.html" || pathname === "/offline.css") return {
    "Content-Type": pathname === "/offline.html" ? "text/html; charset=utf-8" : "text/css; charset=utf-8",
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Content-Security-Policy": OFFLINE_CONTENT_SECURITY_POLICY,
  };
  return null;
}

function isSafeConnectOrigin(value: string): boolean {
  if (value.includes(";") || value.includes(",") || value.includes(" ")) {
    return false;
  }

  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.origin === value
    );
  } catch {
    return false;
  }
}

export function buildContentSecurityPolicy(
  nonce: string,
  isDev: boolean,
  cameraOrigin?: string | null,
): string {
  const scriptSrc = isDev
    ? `'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`
    : `'self' 'nonce-${nonce}' 'strict-dynamic'`;
  const styleSrc = isDev
    ? `'self' 'nonce-${nonce}' 'unsafe-inline'`
    : `'self' 'nonce-${nonce}'`;

  const connectSrc =
    cameraOrigin && isSafeConnectOrigin(cameraOrigin)
      ? `connect-src 'self' ${cameraOrigin}`
      : "connect-src 'self'";

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    `style-src ${styleSrc}`,
    "worker-src 'self'",
    "img-src 'self' blob: data:",
    "media-src 'self' blob:",
    "font-src 'self'",
    connectSrc,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    isDev ? "" : "upgrade-insecure-requests",
  ]
    .filter(Boolean)
    .join("; ");
}

export function shouldDisableStore(pathname: string): boolean {
  return (
    pathname === "/" || pathname === "/setup" || pathname === "/watch" || pathname.startsWith("/api/")
  );
}
