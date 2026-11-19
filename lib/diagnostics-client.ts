import { createIncident, incidentFingerprint, incidentPage, safeLocation, type Incident, type IncidentInput } from "./diagnostics";
import { requestDeadline } from "./client-request";

type Pending = { event: Incident; attempts: number; added: number };
type ReporterOptions = { send: (events: Incident[]) => Promise<boolean>; online: () => boolean; now?: () => number;
  schedule?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>; cancel?: typeof clearTimeout };

/** Memory only. Three attempts per event; bounded queue/dedup prevents error storms and reporting loops. */
export function createIncidentReporter(options: ReporterOptions) {
  const pending: Pending[] = [];
  const recent = new Map<string, {id: string; at: number}>();
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? setTimeout;
  const cancel = options.cancel ?? clearTimeout;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sending = false;
  let disposed = false;
  function later(delay = 1200) {
    if (disposed || timer || !pending.length || !options.online()) return;
    timer = schedule(() => { timer = undefined; void flush(); }, delay);
  }
  async function flush() {
    if (disposed || sending || !pending.length || !options.online()) return;
    if (timer) { cancel(timer); timer = undefined; }
    for (let index = pending.length - 1; index >= 0; index--) {
      if (now() - pending[index].added > 600000) pending.splice(index, 1);
    }
    const batch = pending.slice(0, 5);
    if (!batch.length) return;
    sending = true;
    let accepted = false;
    try { accepted = await options.send(batch.map(item => item.event)); } catch { /* Telemetry is best effort. */ }
    finally {
      for (const item of batch) {
        item.attempts++;
        if (accepted || item.attempts >= 3) {
          const index = pending.indexOf(item);
          if (index >= 0) pending.splice(index, 1);
        }
      }
      sending = false;
      later(accepted ? 1200 : batch[0].attempts === 1 ? 5000 : 30000);
    }
  }
  return {
    add(event: Incident): string {
      if (disposed) return event.id;
      const key = incidentFingerprint(event);
      const previous = recent.get(key);
      if (previous && now() - previous.at < 60000) return previous.id;
      recent.delete(key); recent.set(key, {id: event.id, at: now()});
      while (recent.size > 40) recent.delete(recent.keys().next().value!);
      if (pending.length >= 20) pending.shift();
      pending.push({event, attempts: 0, added: now()});
      later();
      return event.id;
    },
    flush,
    size: () => pending.length,
    dispose() { disposed = true; if (timer) cancel(timer); pending.length = 0; recent.clear(); },
  };
}

let reporter: ReturnType<typeof createIncidentReporter> | undefined;
function browserReporter() {
  return reporter ??= createIncidentReporter({
    online: () => typeof navigator === "undefined" || navigator.onLine !== false,
    async send(events) {
      const deadline = requestDeadline(undefined, 5000);
      try {
        const response = await fetch("/api/diagnostics", {method: "POST", credentials: "same-origin", cache: "no-store",
          redirect: "error", keepalive: true, headers: {"Content-Type": "application/json"},
          body: JSON.stringify({events}), signal: deadline.signal});
        // 200 is durable acknowledgement. A failure leaves the bounded queue available for retry.
        void response.body?.cancel().catch(() => undefined);
        return response.status === 200;
      } finally { deadline.dispose(); }
    },
  });
}
export function reportBrowserIncident(input: IncidentInput): string {
  try {
    if (typeof window === "undefined") return "";
    const event = createIncident({...input, page: input.page ?? incidentPage(location.pathname),
      release: process.env.NEXT_PUBLIC_APP_RELEASE ?? "unknown"}, "browser");
    return browserReporter().add(event);
  } catch { return ""; }
}

let installed = false;
export function installBrowserDiagnostics() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const notice = (reference: string) => {
    try { window.dispatchEvent(new CustomEvent("vision:unexpected-error", {detail: {reference}})); } catch { /* No failure cascade. */ }
  };
  window.addEventListener("error", (event: Event) => {
    try {
      if (event instanceof ErrorEvent) {
        const reference = reportBrowserIncident({code: "client_exception", operation: "unknown", error: event.error,
          location: safeLocation(`${event.filename}:${event.lineno}:${event.colno}`)});
        notice(reference);
      } else if (event.target instanceof HTMLScriptElement ||
          event.target instanceof HTMLLinkElement && event.target.rel === "stylesheet") {
        const reference = reportBrowserIncident({code: "asset_failed", operation: "asset", severity: "error"});
        notice(reference);
      }
    } catch { /* Never interfere with the application's own error handling. */ }
  }, true);
  window.addEventListener("unhandledrejection", event => {
    try { notice(reportBrowserIncident({code: "unhandled_rejection", operation: "unknown", error: event.reason})); }
    catch { /* Deliberately do not preventDefault: developer tools retain the original error. */ }
  });
  window.addEventListener("online", () => { void browserReporter().flush(); });
  window.addEventListener("pagehide", () => { void browserReporter().flush(); });
}
