"use client";

import { useEffect, useState } from "react";
import { installBrowserDiagnostics } from "@/lib/diagnostics-client";
import { isIncidentId } from "@/lib/diagnostics";
import "./recovery.css";

export function RuntimeRecovery() {
  const [reference, setReference] = useState<string | null>(null);
  useEffect(() => {
    installBrowserDiagnostics();
    const show = (event: Event) => {
      const id: unknown = (event as CustomEvent<{reference?: unknown}>).detail?.reference;
      setReference(isIncidentId(id) ? id : "");
    };
    window.addEventListener("vision:unexpected-error", show);
    return () => window.removeEventListener("vision:unexpected-error", show);
  }, []);
  return reference === null ? null : <aside className="vision-runtime-notice" role="alert">
    <p>A part of Vision encountered a problem. If a control or camera has stopped responding, reload the page.</p>
    <button onClick={() => window.location.reload()}>Reload page</button>
    <button onClick={() => setReference(null)}>Dismiss</button>
    {reference ? <small>Reference: {reference}</small> : null}
  </aside>;
}
