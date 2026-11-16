"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  INITIAL_PLAYER_STATE, validSession, viewerApi, ViewerApiError, ViewerPlayer, type PlayerState,
} from "@/lib/viewer-player";

export function CameraViewer({ enabled }: { enabled: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const player = useRef<ViewerPlayer | null>(null);
  const mounted = useRef(false);
  const authGeneration = useRef(0);
  const [state, setState] = useState<PlayerState>(INITIAL_PLAYER_STATE);
  const [username, setUsername] = useState<string | null>(null);
  const [checking, setChecking] = useState(enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    mounted.current = true;
    const instance = new ViewerPlayer({
      video: () => video.current,
      update: (next) => { if (mounted.current) setState(next); },
      api: viewerApi,
      sessionExpired: () => {
        if (mounted.current) {
          ++authGeneration.current;
          setUsername(null);
          setError("Please sign in again.");
        }
      },
    });
    player.current = instance;
    const stop = () => instance.stop("Viewing paused. Press Watch to restart.");
    const visibility = () => { if (document.hidden) stop(); };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", stop);
    const generation = ++authGeneration.current;
    const abort = new AbortController();
    if (enabled) {
      void viewerApi("session", {}, abort.signal).then((value) => {
        if (mounted.current && authGeneration.current === generation && validSession(value)) {
          setUsername(value.username);
        }
      }).catch((failure: unknown) => {
        if (mounted.current && authGeneration.current === generation &&
            !(failure instanceof ViewerApiError && failure.status === 401)) {
          setError("Sign-in could not be checked. Please try again.");
        }
      }).finally(() => {
        if (mounted.current && authGeneration.current === generation) setChecking(false);
      });
    }
    return () => {
      mounted.current = false;
      abort.abort();
      instance.stop();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", stop);
    };
  }, [enabled]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const name = String(values.get("username") ?? "").trim().toLowerCase();
    const password = String(values.get("password") ?? "");
    const form = event.currentTarget;
    const generation = ++authGeneration.current;
    setBusy(true);
    setError("");
    try {
      await viewerApi("login", { username: name, password });
      if (mounted.current && generation === authGeneration.current) {
        form.reset();
        setUsername(name);
      }
    } catch (failure) {
      if (mounted.current && generation === authGeneration.current) {
        setError(failure instanceof Error ? failure.message : "Sign-in failed. Please try again.");
      }
    } finally {
      if (mounted.current && generation === authGeneration.current) setBusy(false);
    }
  }

  async function logout() {
    ++authGeneration.current;
    player.current?.stop();
    setBusy(true);
    setError("");
    try {
      await viewerApi("logout");
      if (mounted.current) setUsername(null);
    } catch (failure) {
      if (mounted.current) {
        if (failure instanceof ViewerApiError && failure.status === 401) {
          setUsername(null);
        } else {
          setError("Sign-out could not be confirmed. Viewing has stopped; please try signing out again.");
        }
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const active = state.status === "playing" || state.status === "connecting";
  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-4xl flex-col gap-6 px-5 py-8 sm:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-secure-soft">MPDEE Vision</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Back Garden</h1>
          <p className="mt-2 text-sm text-mute">Private camera pilot</p>
        </div>
        <Link className="btn btn-ghost" href="/setup">Private access setup</Link>
      </header>
      {!enabled ? (
        <section className="panel p-6"><h2 className="text-xl font-semibold">Not available yet</h2>
          <p className="mt-2 text-mute">The camera pilot is not currently available. Existing private access is unchanged.</p>
        </section>
      ) : checking ? <p role="status">Checking sign-in...</p> : !username ? (
        <section className="panel mx-auto w-full max-w-md p-6">
          <h2 className="text-xl font-semibold">Sign in to watch</h2>
          <p className="mt-2 text-sm text-mute">Use your individual camera account, not the setup password.</p>
          <form className="mt-6 flex flex-col gap-4" onSubmit={login}>
            <label className="flex flex-col gap-2">Username
              <input className="field" name="username" autoComplete="username" autoCapitalize="none"
                spellCheck={false} maxLength={48} required disabled={busy} />
            </label>
            <label className="flex flex-col gap-2">Password
              <input className="field" name="password" type="password" autoComplete="current-password"
                maxLength={256} required disabled={busy} />
            </label>
            <p className="text-sm text-mute">This device stays signed in for up to seven days. Sign out on shared devices.</p>
            <button className="btn btn-primary" disabled={busy} type="submit">{busy ? "Signing in..." : "Sign in"}</button>
          </form>
        </section>
      ) : (
        <>
          <section className="panel overflow-hidden" aria-label="Back Garden camera">
            <div className="relative aspect-video bg-black">
              <video ref={video} className="h-full w-full object-contain" muted autoPlay playsInline
                aria-label="Back Garden live video" />
              {state.status !== "playing" ? (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/70 px-5 text-center">
                  <p role="status">{state.message}</p>
                </div>
              ) : null}
            </div>
            <div className="flex flex-col gap-4 p-5">
              <p aria-live="polite" className={state.status === "playing" ? "text-secure-soft" : "text-mute"}>{state.message}</p>
              <div className="flex flex-wrap gap-3">
                <button className="btn btn-primary" disabled={active || busy} onClick={() => {
                  if (!document.hidden) void player.current?.start();
                }}>{state.status === "error" ? "Retry" : "Watch"}</button>
                <button className="btn btn-secondary" disabled={!active} onClick={() => player.current?.stop()}>Stop</button>
                <button className="btn btn-secondary" disabled={state.status !== "playing"}
                  aria-pressed={!state.muted} onClick={() => { void player.current?.toggleSound(); }}>
                  {state.muted ? "Sound on" : "Sound off"}
                </button>
              </div>
            </div>
          </section>
          <p className="text-sm leading-relaxed text-mute">Starts with sound off. Viewing stops after 15 minutes or when you leave this page.
            Press Watch to restart. No automatic reconnect.</p>
          <details className="panel p-4 text-sm text-mute">
            <summary className="cursor-pointer text-ink">Connection check</summary>
            <dl className="mt-3 grid grid-cols-2 gap-2">
              <dt>Relay verified</dt><dd>{state.diagnostics.relayVerified ? "Yes" : "Not yet"}</dd>
              <dt>Decoded video frames</dt><dd>{state.diagnostics.framesDecoded}</dd>
              <dt>Audio packets received</dt><dd>{state.diagnostics.audioPackets}</dd>
              <dt>Audio bytes received</dt><dd>{state.diagnostics.audioBytes}</dd>
            </dl>
            <p className="mt-3">Audio reception does not confirm audible sound. Use Sound on to check.</p>
          </details>
          <div className="flex flex-wrap items-center justify-between gap-4 text-sm">
            <p className="text-mute">Signed in as {username}</p>
            <button className="btn btn-ghost" disabled={busy} onClick={() => { void logout(); }}>Sign out</button>
          </div>
        </>
      )}
      {error ? <p role="alert" className="text-danger">{error}</p> : null}
    </main>
  );
}
