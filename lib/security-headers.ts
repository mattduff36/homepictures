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
    "img-src 'self' blob: data:",
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
    pathname === "/" || pathname === "/setup" || pathname.startsWith("/api/")
  );
}
