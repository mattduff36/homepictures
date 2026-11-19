"use client";

import { useEffect, useRef, useState } from "react";
import { viewerApi, ViewerApiError } from "@/lib/viewer-player";
import { VIEWER_SAVED_SESSION_LIMIT, validSavedSessions, type SavedSession } from "@/lib/viewer-protocol";

export function SavedSessions({ onClose, onExpired }: { onClose: () => void; onExpired: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [sessions, setSessions] = useState<SavedSession[] | null>(null);
  const [limit, setLimit] = useState(VIEWER_SAVED_SESSION_LIMIT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    request.current = abort;
    dialog.current?.showModal();
    void viewerApi("sessions", {}, abort.signal).then((value) => {
      if (!validSavedSessions(value)) throw new Error("Saved sign-ins could not be checked.");
      if (!abort.signal.aborted) { setSessions(value.sessions); setLimit(value.limit); }
    }).catch((failure: unknown) => {
      if (abort.signal.aborted) return;
      setError(failure instanceof Error ? failure.message : "Saved sign-ins could not be checked.");
      if (failure instanceof ViewerApiError && failure.status === 401) onExpired();
    });
    return () => abort.abort();
  }, [onExpired]);

  async function revoke(id: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await viewerApi("revoke-session", { id }, request.current?.signal);
      const value = await viewerApi("sessions", {}, request.current?.signal);
      if (!validSavedSessions(value)) throw new Error("Saved sign-ins could not be checked.");
      if (!request.current?.signal.aborted) { setSessions(value.sessions); setLimit(value.limit); }
    } catch (failure) {
      if (request.current?.signal.aborted) return;
      setError(failure instanceof Error ? failure.message : "Sign-out could not be confirmed. Please retry.");
      if (failure instanceof ViewerApiError && failure.status === 401) onExpired();
    } finally {
      if (!request.current?.signal.aborted) setBusy(false);
    }
  }

  return <dialog ref={dialog} className="vision-settings vision-sessions" aria-labelledby="saved-sign-ins-title" onClose={onClose}>
    <div className="vision-menu-heading"><h2 id="saved-sign-ins-title">Saved sign-ins</h2><button className="vision-icon" aria-label="Close saved sign-ins" onClick={onClose}>×</button></div>
    <p className="vision-menu-account">Up to {limit} saved sign-ins, each lasting seven days. Sign out an old session to make room for another device. This ends that session&apos;s live viewing.</p>
    {!sessions && !error ? <p role="status">Checking saved sign-ins…</p> : null}
    {sessions?.map((session) => <section key={session.id} className="vision-saved-session">
      <h3>{session.current ? "This browser" : "Other saved sign-in"}</h3>
      <p>Signed in {new Date(session.issuedAt * 1000).toLocaleString()}</p>
      <p>Expires {new Date(session.expires * 1000).toLocaleString()}</p>
      {!session.current ? <button className="vision-menu-action" disabled={busy} onClick={() => void revoke(session.id)}>Sign out this session</button> : null}
    </section>)}
    {error ? <p role="alert">{error}</p> : null}
  </dialog>;
}
