import { createHash, randomBytes } from "node:crypto";
import {
  LOGIN_MAX_ATTEMPTS,
  LOGIN_WINDOW_MS,
  RATE_LIMIT_MAX_KEYS,
} from "./constants";

export type RateLimiter = {
  check: (key: string, now?: number) => { ok: boolean; remaining: number };
  prune: (now?: number) => void;
  size: () => number;
};

export type RateLimiterOptions = {
  windowMs?: number;
  maxAttempts?: number;
  maxKeys?: number;
};

function hashKey(value: string, salt: Buffer): string {
  return createHash("sha256").update(salt).update(value).digest("hex");
}

export function createRateLimiter(options: RateLimiterOptions = {}): RateLimiter {
  const windowMs = options.windowMs ?? LOGIN_WINDOW_MS;
  const maxAttempts = options.maxAttempts ?? LOGIN_MAX_ATTEMPTS;
  const maxKeys = options.maxKeys ?? RATE_LIMIT_MAX_KEYS;
  const salt = randomBytes(16);
  const store = new Map<string, number[]>();

  function prune(now = Date.now()): void {
    for (const [key, times] of store) {
      const next = times.filter((time) => now - time < windowMs);
      if (next.length === 0) {
        store.delete(key);
      } else {
        store.set(key, next);
      }
    }
  }

  function evictOldest(): void {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) {
      store.delete(oldest);
    }
  }

  function check(key: string, now = Date.now()): { ok: boolean; remaining: number } {
    const hashed = hashKey(key, salt);
    const recent = (store.get(hashed) ?? []).filter((time) => now - time < windowMs);

    if (recent.length >= maxAttempts) {
      store.set(hashed, recent);
      return { ok: false, remaining: 0 };
    }

    if (!store.has(hashed) && store.size >= maxKeys) {
      prune(now);
      while (store.size >= maxKeys) {
        evictOldest();
      }
    }

    recent.push(now);
    store.set(hashed, recent);
    return { ok: true, remaining: maxAttempts - recent.length };
  }

  return {
    check,
    prune,
    size: () => store.size,
  };
}

export const loginRateLimiter = createRateLimiter();
