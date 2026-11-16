import { connection } from "next/server";
import { redirect } from "next/navigation";
import { ConnectionGateway } from "@/components/connection-gateway";
import { getCameraUrl } from "@/lib/env";
import { viewerEnabled } from "@/lib/viewer-server";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  await connection();

  const cameraUrl = getCameraUrl();
  if (!cameraUrl) {
    redirect("/setup");
  }

  return <ConnectionGateway cameraUrl={cameraUrl} pilotEnabled={viewerEnabled()} />;
}
