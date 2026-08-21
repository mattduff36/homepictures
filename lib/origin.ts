function firstHeaderValue(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const first = value.split(",")[0]?.trim();
  return first || null;
}

function isAllowedHost(host: string): boolean {
  return /^[a-zA-Z0-9.-]+(?::\d+)?$/.test(host);
}

export function getExpectedOrigin(request: Request): string | null {
  const host = firstHeaderValue(
    request.headers.get("x-forwarded-host") ?? request.headers.get("host"),
  );

  if (!host || !isAllowedHost(host)) {
    return null;
  }

  const proto = firstHeaderValue(request.headers.get("x-forwarded-proto")) ?? "http";
  if (proto !== "http" && proto !== "https") {
    return null;
  }

  return `${proto}://${host}`;
}

export function isAllowedOrigin(
  request: Request,
  isProduction = process.env.NODE_ENV === "production",
): boolean {
  const originHeader = request.headers.get("origin");
  const expected = getExpectedOrigin(request);

  if (isProduction) {
    if (!originHeader || !expected) {
      return false;
    }
  } else if (!originHeader) {
    return true;
  } else if (!expected) {
    return false;
  }

  try {
    return new URL(originHeader).origin === new URL(expected as string).origin;
  } catch {
    return false;
  }
}

export function isAllowedSameOriginRead(
  request: Request,
  isProduction = process.env.NODE_ENV === "production",
): boolean {
  const originHeader = request.headers.get("origin");
  if (originHeader) {
    return isAllowedOrigin(request, isProduction);
  }

  const site = (request.headers.get("sec-fetch-site") ?? "").toLowerCase();
  if (site && site !== "same-origin" && site !== "same-site" && site !== "none") {
    return false;
  }

  return getExpectedOrigin(request) !== null;
}
