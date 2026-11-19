"use client";

import { useEffect, useState } from "react";
import { reportBrowserIncident } from "@/lib/diagnostics-client";
import "./recovery.css";

export function ErrorFallback({error, reset}: {error: Error & {digest?: string}; reset: () => void}) {
  const [reference, setReference] = useState("");
  useEffect(() => {
    const id = reportBrowserIncident({code: "render_failed", operation: "render", error});
    const timer = setTimeout(() => setReference(id), 0);
    return () => clearTimeout(timer);
  }, [error]);
  return <main className="vision-recovery" role="alert">
    <h1>Vision could not display this page</h1>
    <p>You can try opening it again. If the problem continues, give the owner the reference below and the time it happened.</p>
    <div className="vision-recovery-actions"><button onClick={reset}>Try again</button>
      <button onClick={() => window.location.reload()}>Reload page</button>
      <a href="/watch">Open cameras</a><a href="/setup">Private access setup</a></div>
    {reference ? <small>Reference: {reference}</small> : <small>Open the page again to retry.</small>}
  </main>;
}
