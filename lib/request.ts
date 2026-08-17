import { MAX_JSON_BODY_BYTES } from "./constants";

export type JsonReadResult =
  | { ok: true; value: unknown }
  | { ok: false; status: number };

export function hasJsonContentType(request: Request): boolean {
  const contentType = request.headers.get("content-type");
  if (!contentType) {
    return false;
  }

  return contentType.toLowerCase().split(";")[0]?.trim() === "application/json";
}

async function readLimitedBytes(request: Request): Promise<
  { ok: true; bytes: Uint8Array } | { ok: false; status: number }
> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const parsedLength = Number(contentLength);
    if (!Number.isFinite(parsedLength) || parsedLength < 0) {
      return { ok: false, status: 400 };
    }
    if (parsedLength > MAX_JSON_BODY_BYTES) {
      return { ok: false, status: 413 };
    }
  }

  if (!request.body) {
    return { ok: true, bytes: new Uint8Array() };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value) {
      continue;
    }

    total += value.byteLength;
    if (total > MAX_JSON_BODY_BYTES) {
      await reader.cancel();
      return { ok: false, status: 413 };
    }

    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { ok: true, bytes };
}

export async function readJsonBody(request: Request): Promise<JsonReadResult> {
  const limited = await readLimitedBytes(request);
  if (!limited.ok) {
    return limited;
  }

  try {
    const text = new TextDecoder().decode(limited.bytes);
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, status: 400 };
  }
}

export function readPasswordField(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const password = (value as { password?: unknown }).password;
  return typeof password === "string" ? password : null;
}
