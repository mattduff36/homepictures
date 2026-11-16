import { CameraViewer } from "@/components/camera-viewer";
import { viewerEnabled } from "@/lib/viewer-server";

export const dynamic = "force-dynamic";

export default function WatchPage() {
  return <CameraViewer enabled={viewerEnabled()} />;
}
