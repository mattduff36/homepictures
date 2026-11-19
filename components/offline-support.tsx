"use client";

import { useEffect } from "react";
import { reportBrowserIncident } from "@/lib/diagnostics-client";

/** Install a public fallback after loading. Never reload or restart a viewer. */
export function OfflineSupport() {
  useEffect(() => {
    if (!window.isSecureContext || !("serviceWorker" in navigator)) return;
    let cancelled = false;
    const install = () => {
      if (cancelled) return;
      void navigator.serviceWorker.register("/offline-worker.js", {scope: "/", updateViaCache: "none"})
        .catch(() => {
          if (!cancelled && navigator.onLine) {
            reportBrowserIncident({code: "asset_failed", operation: "bootstrap", severity: "warning"});
          }
        });
    };
    if (document.readyState === "complete") install();
    else window.addEventListener("load", install, {once: true});
    return () => {cancelled = true; window.removeEventListener("load", install);};
  }, []);
  return null;
}
