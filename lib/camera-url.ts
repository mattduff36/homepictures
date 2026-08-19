export function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

export function parseCameraUrl(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || !isHttpsUrl(trimmed)) {
    return null;
  }

  return trimmed;
}

export function getCameraOrigin(value: string | null | undefined): string | null {
  const parsed = parseCameraUrl(value);
  if (!parsed) {
    return null;
  }

  try {
    return new URL(parsed).origin;
  } catch {
    return null;
  }
}

export function getCameraHealthUrl(value: string | null | undefined): string | null {
  const parsed = parseCameraUrl(value);
  if (!parsed) {
    return null;
  }

  try {
    return new URL("/healthz", parsed).href;
  } catch {
    return null;
  }
}
