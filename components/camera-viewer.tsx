"use client";

/* eslint-disable @next/next/no-img-element -- Authenticated in-memory JPEGs must not enter an image optimiser/cache. */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  fullscreenVideo, INITIAL_PLAYER_STATE, validSession, viewerApi, ViewerApiError, ViewerFleet,
  ViewerPlayer, type PlayerState,
} from "@/lib/viewer-player";
import {
  validSnapshot, type CameraId, type ViewerCamera, type ViewerSnapshot,
} from "@/lib/viewer-protocol";

function CameraTile({ camera, fleet, selected, visible, select, expired, dataSaver, epoch }: {
  camera: ViewerCamera; fleet: ViewerFleet; selected: boolean; visible: boolean; select: () => void;
  expired: () => void; dataSaver: boolean; epoch: number;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const container = useRef<HTMLElement>(null);
  const player = useRef<ViewerPlayer | null>(null);
  const snapshotGeneration = useRef(0);
  const snapshotAbort = useRef<AbortController | null>(null);
  const [state, setState] = useState<PlayerState>(INITIAL_PLAYER_STATE);
  const [fullscreenEpoch, setFullscreenEpoch] = useState<number | null>(null);
  const [snapshot, setSnapshot] = useState<ViewerSnapshot | null>(null);
  const [snapshotRequest, setSnapshotRequest] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(0);
  const snapshotBusy = snapshotRequest === epoch;
  const ring = camera.kind === "ring";
  const fullscreen = ring && visible && fullscreenEpoch === epoch;
  const closeFullscreen = useCallback(() => {
    fleet.leaveRingFullscreen(camera.id);
    setFullscreenEpoch(null);
  }, [camera.id, fleet]);
  const cancelSnapshot = useCallback(() => {
    ++snapshotGeneration.current;
    snapshotAbort.current?.abort();
  }, []);

  useEffect(() => {
    const instance = new ViewerPlayer({
      video: () => video.current, update: setState, api: viewerApi, sessionExpired: expired,
    });
    player.current = instance;
    const unregister = fleet.register(camera.id, instance);
    return () => {
      unregister();
      player.current = null;
      cancelSnapshot();
    };
  }, [camera.id, fleet, expired, cancelSnapshot]);

  useEffect(() => {
    cancelSnapshot();
  }, [epoch, cancelSnapshot]);

  useEffect(() => {
    if (!snapshot || !visible) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const timestamp = Date.now();
      setNow(timestamp);
      const elapsed = snapshot.capturedAt == null ? 60000 : Math.max(0, timestamp - snapshot.capturedAt * 1000);
      const step = elapsed < 60000 ? 10000 : 60000;
      timer = setTimeout(tick, Math.max(250, step - elapsed % step));
    };
    timer = setTimeout(tick, 0);
    return () => clearTimeout(timer);
  }, [snapshot, visible]);

  useEffect(() => {
    if (!fullscreen) return;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    container.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeFullscreen(); }
      if (event.key !== "Tab") return;
      const controls = [...(container.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled), summary, [href], [tabindex='0']",
      ) ?? [])];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", keyboard);
    return () => {
      fleet.leaveRingFullscreen(camera.id);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", keyboard);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [fullscreen, camera.id, fleet, closeFullscreen]);

  const active = state.status === "playing" || state.status === "connecting";
  const age = snapshot?.capturedAt == null ? null : Math.max(0, Math.floor(now / 1000 - snapshot.capturedAt));
  const stale = snapshot?.stale || age === null || age >= 120;

  async function refreshSnapshot() {
    if (document.hidden || snapshotBusy) return;
    const generation = ++snapshotGeneration.current;
    const abort = new AbortController();
    snapshotAbort.current?.abort();
    snapshotAbort.current = abort;
    setSnapshotRequest(epoch);
    setError("");
    try {
      const result = await viewerApi("snapshot", { camera: camera.id }, abort.signal);
      if (generation !== snapshotGeneration.current || document.hidden) return;
      if (!validSnapshot(result) || result.camera !== camera.id) throw new Error("Snapshot unavailable.");
      setNow(Date.now());
      setSnapshot(result);
    } catch (failure) {
      if (generation === snapshotGeneration.current) {
        setError("Snapshot unavailable. Any previous still below is not a live picture.");
        if (failure instanceof ViewerApiError && failure.status === 401) expired();
      }
    } finally {
      if (generation === snapshotGeneration.current) setSnapshotRequest(null);
    }
  }

  return (
    <section ref={container} hidden={!visible}
      className={fullscreen ? "fixed inset-0 z-50 flex flex-col overflow-y-auto bg-black p-3 sm:p-6" :
        `panel overflow-hidden ${selected ? "sm:col-span-2" : ""}`}
      role={fullscreen ? "dialog" : undefined} aria-modal={fullscreen ? true : undefined}
      aria-label={`${camera.label} ${camera.kind} camera${fullscreen ? " fullscreen" : ""}`}>
      <div className="flex items-center justify-between gap-3 p-4">
        <h2 className="text-xl font-semibold">{camera.label}</h2>
        {fullscreen ? <button className="btn btn-ghost" onClick={closeFullscreen}>Close fullscreen</button> :
          <button className="btn btn-ghost" aria-pressed={selected} onClick={select}>
            {selected ? "Selected" : "Select"}
          </button>}
      </div>
      <div className={`relative bg-black ${fullscreen ? "min-h-48 flex-1" : "aspect-video"}`}>
        <video ref={video} className={`h-full w-full object-contain ${active ? "" : "hidden"}`}
          muted autoPlay playsInline aria-label={`${camera.label} live video`} />
        {ring && !active && snapshot ? <img src={`data:image/jpeg;base64,${snapshot.image}`}
          alt={`${camera.label} snapshot, not live`} className="h-full w-full object-contain" /> : null}
        {ring && !active ? <span className="absolute bottom-0 left-0 inline-flex h-5 items-center gap-[3px] border border-white/50 bg-black px-[5px] text-[9px] font-semibold text-white"
          title={age === null ? "Snapshot capture time unknown" : `Snapshot captured ${age}s ago${stale ? " (stale)" : ""}`}
          aria-label={age === null ? "Snapshot capture time unknown" : `Snapshot captured ${age}s ago${stale ? " (stale)" : ""}`}>
          <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8" cy="8" r="1" /><path d="m3 17 6-6 4 4 3-3 5 5" />
          </svg>
          {age === null ? "—" : age < 60 ? `${Math.floor(age / 10) * 10}s` : age < 3600 ? `${Math.floor(age / 60)}m` : `${Math.floor(age / 3600)}h`}
        </span> : null}
        {state.status !== "playing" && !(ring && !active && snapshot) ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-mute">
            {ring && !active ? "Snapshot - refresh when needed. No background camera polling." : state.message}
          </div>
        ) : null}
      </div>
      <div className="flex flex-col gap-3 p-4">
        <p role="status" className={`text-sm ${state.status === "playing" ? "text-secure-soft" : "text-mute"}`}>
          {state.message}
        </p>
        {ring && !active && snapshot ? <p className="text-sm text-mute">
          {stale ? "Stale / age unverified" : "Snapshot, not live"}.
          {age !== null ? ` Captured ${age < 60 ? `${age}s` : `${Math.floor(age / 60)}m`} ago.` : " Capture time unknown."}
        </p> : null}
        {ring ? <>
          <button className="btn btn-secondary" disabled={snapshotBusy || active} onClick={() => { void refreshSnapshot(); }}>
            {snapshotBusy ? "Fetching still..." : "Refresh snapshot"}
          </button>
          <p className="text-xs text-mute">{fullscreen
            ? "Pressing Play starts an approved Ring Live View event, for up to five minutes."
            : "Snapshots only. Open fullscreen, then press Play for live video."}
            {dataSaver ? " Data Saver disables live playback." : " No automatic live renewal."}</p>
        </> : null}
        <div className="flex flex-wrap gap-2">
          {!ring || fullscreen ? <button className="btn btn-primary" disabled={active || (ring && dataSaver)}
            onClick={() => {
              if (!document.hidden && navigator.onLine !== false) {
                setError("");
                void (ring ? fleet.playRingFullscreen(camera) : fleet.watch([camera]))
                  .catch(() => setError("Viewing could not start. Please retry."));
              } else setError("Offline or paused. Return online and press Watch.");
            }}>{ring ? "Play" : state.status === "error" ? "Retry" : "Watch"}</button> : null}
          <button className="btn btn-secondary" disabled={!active} onClick={() => player.current?.stop()}>Stop</button>
          <button className="btn btn-secondary" disabled={state.status !== "playing"} aria-pressed={!state.muted}
            onClick={() => { void fleet.sound(camera.id); }}>{state.muted ? "Sound on" : "Sound off"}</button>
          {!fullscreen ? <button className="btn btn-ghost" disabled={!ring && state.status !== "playing"} onClick={() => {
            if (ring) { fleet.enterRingFullscreen(camera.id); setFullscreenEpoch(epoch); }
            else if (video.current) void fullscreenVideo(video.current).catch(() => setError("Fullscreen is unavailable."));
          }}>Fullscreen</button> : null}
        </div>
        <details className="text-xs text-mute">
          <summary className="cursor-pointer">Connection check</summary>
          <p className="mt-2">Relay verified: {state.diagnostics.relayVerified ? "Yes" : "Not yet"}.
            {" "}Decoded frames: {state.diagnostics.framesDecoded}. Audio packets: {state.diagnostics.audioPackets}.
            {" "}Audio bytes: {state.diagnostics.audioBytes}. Counters do not prove audible sound.</p>
        </details>
        {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      </div>
    </section>
  );
}

export function CameraViewer({ enabled }: { enabled: boolean }) {
  const [fleet] = useState(() => new ViewerFleet());
  const mounted = useRef(false);
  const authGeneration = useRef(0);
  const [account, setAccount] = useState<{ username: string; cameras: ViewerCamera[] } | null>(null);
  const [checking, setChecking] = useState(enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [group, setGroup] = useState<"all" | "swann" | "ring">("all");
  const [selected, setSelected] = useState<CameraId | null>(null);
  const [dataSaver, setDataSaver] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const [notice, setNotice] = useState("Choose a camera or the Swann wall. Nothing starts automatically.");
  const invalidateAuth = useCallback(() => { ++authGeneration.current; }, []);
  const [expired] = useState(() => () => {
    fleet.stop();
    invalidateAuth();
    if (mounted.current) {
      setAccount(null);
      setBusy(false);
      setError("Please sign in again.");
    }
  });

  useEffect(() => {
    mounted.current = true;
    const stop = () => {
      fleet.stop("Viewing paused. Press Watch to restart.");
      setEpoch((value) => value + 1);
      setNotice("Viewing paused. Return online and press Watch or Refresh snapshot. No automatic reconnect.");
    };
    const visibility = () => { if (document.hidden) stop(); };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", stop);
    window.addEventListener("offline", stop);
    window.addEventListener("online", stop);
    const generation = ++authGeneration.current;
    const abort = new AbortController();
    if (enabled) {
      void viewerApi("session", {}, abort.signal).then((value) => {
        if (!validSession(value)) throw new Error("Invalid session");
        if (mounted.current && authGeneration.current === generation) setAccount(value);
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
      invalidateAuth();
      abort.abort();
      fleet.stop();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", stop);
      window.removeEventListener("offline", stop);
      window.removeEventListener("online", stop);
    };
  }, [enabled, fleet, invalidateAuth]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const generation = ++authGeneration.current;
    setBusy(true);
    setError("");
    try {
      await viewerApi("login", { username: String(values.get("username") ?? "").trim().toLowerCase(),
        password: String(values.get("password") ?? "") });
      const session = await viewerApi("session");
      if (!validSession(session)) throw new Error("Sign-in could not be checked.");
      if (mounted.current && generation === authGeneration.current) {
        form.reset();
        setAccount(session);
      }
    } catch (failure) {
      if (mounted.current && generation === authGeneration.current) {
        setError(failure instanceof Error ? failure.message : "Sign-in failed. Please retry.");
      }
    } finally {
      if (mounted.current && generation === authGeneration.current) setBusy(false);
    }
  }

  async function logout() {
    const generation = ++authGeneration.current;
    fleet.stop();
    setEpoch((value) => value + 1);
    setBusy(true);
    setError("");
    try {
      await viewerApi("logout");
      if (mounted.current && generation === authGeneration.current) setAccount(null);
    } catch (failure) {
      if (mounted.current && generation === authGeneration.current) {
        if (failure instanceof ViewerApiError && failure.status === 401) setAccount(null);
        else setError("Sign-out could not be confirmed. Viewing stopped; please try signing out again.");
      }
    } finally {
      if (mounted.current && generation === authGeneration.current) setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-6xl flex-col gap-6 px-4 py-6 sm:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-sm font-semibold text-secure-soft">MPDEE Vision</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Home cameras</h1>
          <p className="mt-2 text-sm text-mute">Private website viewing. No app or Tailscale required.</p></div>
        <Link className="btn btn-ghost" href="/setup">Private access setup</Link>
      </header>
      {!enabled ? <section className="panel p-6"><h2 className="text-xl font-semibold">Not available</h2>
        <p className="mt-2 text-mute">Website viewing is unavailable. Existing private access is unchanged.</p></section>
        : checking ? <p role="status">Checking sign-in...</p> : !account ? (
          <section className="panel mx-auto w-full max-w-md p-6">
            <h2 className="text-xl font-semibold">Sign in to watch</h2>
            <p className="mt-2 text-sm text-mute">Use your individual camera account, not the setup password.</p>
            <form className="mt-6 flex flex-col gap-4" onSubmit={login}>
              <label className="flex flex-col gap-2">Username
                <input className="field" name="username" autoComplete="username" autoCapitalize="none"
                  spellCheck={false} maxLength={48} required disabled={busy} /></label>
              <label className="flex flex-col gap-2">Password
                <input className="field" name="password" type="password" autoComplete="current-password"
                  maxLength={256} required disabled={busy} /></label>
              <p className="text-sm text-mute">Stays signed in for up to seven days. Sign out on shared devices.</p>
              <button className="btn btn-primary" disabled={busy} type="submit">{busy ? "Signing in..." : "Sign in"}</button>
            </form>
          </section>
        ) : <>
          <nav className="flex flex-wrap gap-2" aria-label="Camera groups">
            {(["all", "swann", "ring"] as const).map((value) => <button key={value}
              className="btn btn-secondary" aria-pressed={group === value} onClick={() => {
                fleet.stop(); setGroup(value); setSelected(null); setEpoch((v) => v + 1);
              }}>{value === "all" ? "All cameras" : value === "swann" ? "Swann" : "Ring"}</button>)}
            <button className="btn btn-primary" onClick={() => {
              if (document.hidden || navigator.onLine === false) return;
              setGroup("swann"); setSelected(null);
              void fleet.watch(account.cameras.filter((camera) => camera.kind === "swann"))
                .catch(() => setError("No Swann cameras are authorised, or viewing could not start."));
            }} disabled={busy || !account.cameras.some((camera) => camera.kind === "swann")}>Watch Swann wall (SD)</button>
            <button className="btn btn-secondary" onClick={() => {
              fleet.stop(); setEpoch((v) => v + 1); setNotice("All viewing stopped. Restart explicitly.");
            }}>Stop all</button>
          </nav>
          <label className="flex items-center gap-3 text-sm">
            <input type="checkbox" checked={dataSaver} onChange={(event) => {
              fleet.stop(); setDataSaver(event.target.checked); setEpoch((v) => v + 1);
            }} />Data Saver - Ring snapshots only
          </label>
          <p role="status" className="text-sm text-mute">{notice}</p>
          <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
            {account.cameras.map((camera) => <CameraTile key={camera.id} camera={camera} fleet={fleet}
              visible={(group === "all" || group === camera.kind) && (!selected || selected === camera.id)}
              selected={selected === camera.id} dataSaver={dataSaver} epoch={epoch} expired={expired}
              select={() => { fleet.retain(camera.id); setSelected(camera.id); setEpoch((v) => v + 1); }} />)}
          </div>
          {selected ? <button className="btn btn-secondary self-start" onClick={() => setSelected(null)}>Show camera tiles</button> : null}
          <p className="text-sm leading-relaxed text-mute">Starts muted; only one camera can have sound.
            Swann uses economical SD streams, up to five at once and 15 minutes per connection.
            Ring stays on snapshots unless opened fullscreen and Play is pressed. Live View ends after five minutes.
            Stop, leaving this page, hiding the tab or losing the network ends viewing. No automatic reconnect.</p>
          <details className="panel p-4 text-sm text-mute">
            <summary className="cursor-pointer text-ink">Add to Home Screen / private features</summary>
            <p className="mt-3">On iPhone, open this website in Safari, then Share, Add to Home Screen.
              On Android, use the browser menu, Add to Home Screen. Sign-in remains private on this device.
              No installation is required. Recording playback and remote controls remain in the existing private app.</p>
            <Link className="mt-3 inline-block underline" href="/setup">Existing private camera access</Link>
          </details>
          <div className="flex flex-wrap items-center justify-between gap-4 text-sm">
            <p className="text-mute">Signed in as {account.username}</p>
            <button className="btn btn-ghost" disabled={busy} onClick={() => { void logout(); }}>Sign out</button>
          </div>
        </>}
      {error ? <p role="alert" className="text-danger">{error}</p> : null}
    </main>
  );
}
