import { NextResponse } from "next/server";

const NO_STORE = {
  "Cache-Control": "private, no-store",
};

export function jsonError(status: number, message: string): NextResponse {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE });
}

export function jsonOk(): NextResponse {
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
