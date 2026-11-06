import { jsonError } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return jsonError(410, "Shared sign-in is retired. Use your own Tailscale account and the owner's private Dell device invite.");
}

export function POST() {
  return jsonError(405, "Method not allowed");
}
