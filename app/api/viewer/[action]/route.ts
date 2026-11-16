import { handleViewerRequest } from "@/lib/viewer-server";
import { jsonError } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params;
  return handleViewerRequest(request, action);
}

export function GET() {
  return jsonError(405, "Method not allowed");
}
