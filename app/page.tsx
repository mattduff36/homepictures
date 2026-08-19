import { connection } from "next/server";
import { redirect } from "next/navigation";
import { ConnectionGateway } from "@/components/connection-gateway";
import { getCameraUrl } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  await connection();

  const cameraUrl = getCameraUrl();
  if (!cameraUrl) {
    redirect("/setup");
  }

  return <ConnectionGateway cameraUrl={cameraUrl} />;
}
