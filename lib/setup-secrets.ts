export const SHARED_LOGIN_PROVIDERS = [
  "apple",
  "github",
  "google",
  "microsoft",
] as const;

export type SharedLoginProvider = (typeof SHARED_LOGIN_PROVIDERS)[number];

export type SharedLogin = {
  email: string;
  password: string;
  provider: SharedLoginProvider;
};

const PROVIDER_SET = new Set<string>(SHARED_LOGIN_PROVIDERS);

export const SHARED_LOGIN_PROVIDER_LABELS: Record<SharedLoginProvider, string> =
  {
    apple: "Apple",
    github: "GitHub",
    google: "Google",
    microsoft: "Microsoft",
  };

export function parseExactSecret(value: string | undefined): string | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  return value;
}

export function parseSharedLoginEmail(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const email = value.trim();
  if (!email || !email.includes("@") || email.includes(" ")) {
    return null;
  }

  return email;
}

export function parseSharedLoginProvider(
  value: string | null | undefined,
): SharedLoginProvider | null {
  if (typeof value !== "string") {
    return null;
  }

  const provider = value.trim().toLowerCase();
  if (!PROVIDER_SET.has(provider)) {
    return null;
  }

  return provider as SharedLoginProvider;
}

export function parseTailscaleAuthKey(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const key = value.trim();
  if (!/^tskey-[A-Za-z0-9_-]+$/.test(key)) {
    return null;
  }

  return key;
}

export function parseSharedLogin(input: {
  email: string | undefined;
  password: string | undefined;
  provider: string | undefined;
}): SharedLogin | null {
  const email = parseSharedLoginEmail(input.email);
  const password = parseExactSecret(input.password);
  const provider = parseSharedLoginProvider(input.provider);

  if (!email || !password || !provider) {
    return null;
  }

  return { email, password, provider };
}
