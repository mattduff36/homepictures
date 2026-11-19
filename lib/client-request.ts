/** A request deadline covering response headers AND body, without relying on AbortSignal.any support. */
export function requestDeadline(parent?: AbortSignal, milliseconds = 20000) {
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  if (parent?.aborted) cancel(); else parent?.addEventListener("abort", cancel, {once: true});
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, milliseconds);
  return { signal: controller.signal, timedOut: () => timedOut, dispose() {
    clearTimeout(timer); parent?.removeEventListener("abort", cancel);
  } };
}

export async function setupRequest(action: "login" | "logout", body: Record<string, unknown>, signal?: AbortSignal) {
  const deadline = requestDeadline(signal, 15000);
  try {
    return await fetch(`/api/${action}`, { method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
      headers: {"Content-Type": "application/json"}, body: JSON.stringify(body), signal: deadline.signal });
  } catch {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    throw new DOMException("Setup request unavailable", deadline.timedOut() ? "TimeoutError" : "NetworkError");
  } finally { deadline.dispose(); }
}
