import { handleDiagnosticRequest } from "@/lib/diagnostics-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export function POST(request: Request) { return handleDiagnosticRequest(request); }
export function GET() {
  return Response.json({error: "Method not allowed"}, {status: 405, headers: {"Cache-Control": "private, no-store"}});
}
