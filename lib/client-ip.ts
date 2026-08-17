function firstHeaderValue(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const first = value.split(",")[0]?.trim();
  return first || null;
}

export function getClientIp(request: Request): string {
  const raw =
    firstHeaderValue(request.headers.get("x-real-ip")) ??
    firstHeaderValue(request.headers.get("x-vercel-forwarded-for")) ??
    firstHeaderValue(request.headers.get("x-forwarded-for")) ??
    "unknown";

  return raw.slice(0, 128);
}
