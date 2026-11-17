"use client";

/* eslint-disable @next/next/no-img-element -- Authenticated in-memory JPEGs must not enter an image optimiser/cache. */
import Link from "next/link";
import "./camera-wall.css";
import { SavedSessions } from "./saved-sessions";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  INITIAL_PLAYER_STATE, validSession, viewerApi, ViewerApiError, ViewerFleet,
  ViewerPlayer, type PlayerState,
} from "@/lib/viewer-player";
import {
  validSnapshot, type ViewerCamera, type ViewerSnapshot,
} from "@/lib/viewer-protocol";

function Icon({ name }: { name: "play" | "stop" | "sound" | "muted" | "refresh" | "close" | "menu" | "image" | "expand" }) {
  const paths = { play: "m8 5 11 7-11 7Z", stop: "M6 6h12v12H6Z", sound: "m11 5-6 4H2v6h3l6 4ZM15 8c3 2 3 6 0 8m3-11c5 4 5 10 0 14", muted: "m11 5-6 4H2v6h3l6 4ZM16 9l6 6m0-6-6 6", refresh: "M20 7v5h-5M4 17v-5h5M5 7a8 8 0 0 1 14-1l1 6M4 12l1 6a8 8 0 0 0 14-1", close: "m6 6 12 12M6 18 18 6", menu: "M4 6h16M4 12h16M4 18h16", image: "M3 3h18v18H3ZM3 17l6-6 4 4 3-3 5 5M7 7h2", expand: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" };
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
}

function CameraTile({ camera, fleet, visible, expired, dataSaver, epoch }: {
  camera: ViewerCamera; fleet: ViewerFleet; visible: boolean;
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
  const fullscreen = visible && fullscreenEpoch === epoch;
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
  const remaining = state.remainingSeconds ?? null;
  const age = snapshot?.capturedAt == null ? null : Math.max(0, Math.floor(now / 1000 - snapshot.capturedAt));
  const stale = snapshot?.stale || age === null || age >= 120;

  const refreshSnapshot = useCallback(async () => {
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
        setError(failure instanceof ViewerApiError ? failure.message : "Snapshot unavailable. Tap refresh to retry.");
        if (failure instanceof ViewerApiError && failure.status === 401) expired();
      }
    } finally {
      if (generation === snapshotGeneration.current) setSnapshotRequest(null);
    }
  }, [camera.id, epoch, expired, snapshotBusy]);

  const requestedStill = useRef(false);
  useEffect(() => {
    if (ring && visible && !requestedStill.current && !document.hidden) {
      requestedStill.current = true;
      void refreshSnapshot();
    }
  }, [ring, visible, refreshSnapshot]);

  function openFullscreen() {
    if (ring) fleet.enterRingFullscreen(camera.id);
    setFullscreenEpoch(epoch);
    setError("");
  }
  function play() {
    if (document.hidden || navigator.onLine === false) { setError("You're offline. Reconnect, then press Play."); return; }
    setError("");
    void (ring ? fleet.playRingFullscreen(camera) : fleet.watch([camera]))
      .catch(() => setError("Could not start this camera. Please try again."));
  }
  function retry() {
    if (document.hidden || navigator.onLine === false) { setError("You're offline. Reconnect, then press Retry."); return; }
    setError("");
    void fleet.retrySwann(camera).catch(() => setError("Could not restart this camera. Please try again."));
  }
  const ageLabel = age === null ? "—" : age < 60 ? `${Math.floor(age / 10) * 10}s` : age < 3600 ? `${Math.floor(age / 60)}m` : `${Math.floor(age / 3600)}h`;
  const snapshotDescription = age === null ? "Snapshot capture time unknown" : `Snapshot captured ${age}s ago${stale ? " (stale)" : ""}`;
  return (
    <section ref={container} hidden={!visible} className={`vision-tile${fullscreen ? " vision-solo" : ""}`}
      role={fullscreen ? "dialog" : "region"} aria-modal={fullscreen ? true : undefined}
      aria-label={`${camera.label} ${camera.kind} camera${fullscreen ? " fullscreen" : ""}`}>
      <video ref={video} className={`vision-picture ${active ? "" : "hidden"}`} muted autoPlay playsInline aria-label={`${camera.label} live video`} />
      {ring && !active && snapshot ? <img className="vision-picture" src={`data:image/jpeg;base64,${snapshot.image}`} alt={`${camera.label} snapshot, not live`} /> : null}
      {!fullscreen ? <button className="vision-tile-open" onClick={openFullscreen} aria-label={`Open ${camera.label} fullscreen`} /> : null}
      {!active && !(ring && snapshot) ? <div className="vision-placeholder" aria-hidden="true"><Icon name={ring ? "image" : "play"} /><span>{snapshotBusy ? "Loading snapshot…" : ring ? "Snapshot unavailable" : state.status === "error" ? "Connection unavailable" : state.status === "stopped" ? state.message : "Ready to watch"}</span></div> : null}
      <span className={`vision-status vision-badge ${state.status === "playing" ? "is-live" : ""}`} role="status">{state.status === "playing" ? "LIVE" : state.status === "connecting" ? "Connecting…" : ring ? "SNAPSHOT" : state.status === "error" ? "UNAVAILABLE" : state.status === "stopped" ? "PAUSED" : "SD"}</span>
      <span className="vision-name vision-badge">{camera.label}</span>
      {active && remaining !== null ? <span className="vision-budget vision-badge" aria-label={`Viewing ends in ${Math.floor(remaining / 60)} minutes ${remaining % 60} seconds`}>{Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}</span> : null}
      <div className="vision-tile-controls">
        {ring && !active ? <span className="vision-age vision-badge" title={snapshotDescription} aria-label={snapshotDescription}><Icon name="image" />{ageLabel}</span> : null}
        {ring && !active ? <button className="vision-icon vision-badge" disabled={snapshotBusy} onClick={() => void refreshSnapshot()} aria-label={`Refresh ${camera.label} snapshot`} title="Refresh snapshot"><Icon name="refresh" /></button> : null}
        {active ? <><button className="vision-icon vision-badge" disabled={state.status !== "playing"} aria-pressed={!state.muted} aria-label={`${state.muted ? "Unmute" : "Mute"} ${camera.label}`} onClick={() => void fleet.sound(camera.id)}><Icon name={state.muted ? "muted" : "sound"} /></button><button className="vision-icon vision-badge" onClick={() => player.current?.stop()} aria-label={`Stop ${camera.label}`}><Icon name="stop" /></button></> : null}
        {!ring && !active && state.status !== "idle" ? <button className="vision-icon vision-badge" onClick={retry} aria-label={`Retry ${camera.label}`} title="Retry camera"><Icon name="play" /></button> : null}
      </div>
      {fullscreen ? <>
        <button className="vision-close vision-icon" onClick={closeFullscreen} aria-label="Close fullscreen"><Icon name="close" /></button>
        {!active ? <div className="vision-play-area"><button className="vision-play" disabled={ring && dataSaver} onClick={play}><Icon name="play" />Play</button><p>{ring ? dataSaver ? "Data Saver is on. Turn it off in the menu to play." : "Starts a Ring Live View · up to 5 minutes" : "Live video · starts muted"}</p></div> : null}
      </> : null}
      {error || state.status === "error" ? <p className="vision-camera-error" role="alert">{error || state.message}</p> : null}
    </section>
  );
}

export function CameraViewer({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    let pending: ReturnType<typeof setTimeout> | undefined;
    const restore = () => {
      clearTimeout(pending);
      pending = undefined;
      for (const animation of document.getAnimations()) {
        if (animation instanceof CSSAnimation && animation.animationName === "camera-badge-clear-background") {
          animation.currentTime = 0;
          animation.play();
        }
      }
    };
    const move = () => { if (pending === undefined) pending = setTimeout(restore, 100); };
    document.addEventListener("pointerdown", restore, { passive: true, capture: true });
    document.addEventListener("pointermove", move, { passive: true, capture: true });
    document.addEventListener("keydown", restore, true);
    return () => {
      clearTimeout(pending);
      document.removeEventListener("pointerdown", restore, true);
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("keydown", restore, true);
    };
  }, []);
  const [fleet] = useState(() => new ViewerFleet());
  const mounted = useRef(false);
  const authGeneration = useRef(0);
  const [account, setAccount] = useState<{ username: string; cameras: ViewerCamera[] } | null>(null);
  const [checking, setChecking] = useState(enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [group, setGroup] = useState<"all" | "swann" | "ring">("all");
  const menu = useRef<HTMLDialogElement>(null);
  const [dataSaver, setDataSaver] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const [notice, setNotice] = useState("Press Start wall to watch Swann. Ring stays on snapshots.");
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
    const stop = (event?: Event) => {
      const message = event?.type === "offline" ? "You're offline. Reconnect, then press Play or Start wall."
        : event?.type === "online" ? "You're back online. Press Play or Start wall to resume."
        : "Viewing paused while this page was hidden. Press Play or Start wall to resume.";
      fleet.stop(message);
      setEpoch((value) => value + 1);
      setNotice(message);
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
    <main className={account ? "vision-app" : "vision-login mx-auto flex min-h-[100dvh] max-w-6xl flex-col gap-6 px-4 py-6 sm:px-8"}>
      {!account ? <header className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-sm font-semibold text-secure-soft">MPDEE Vision</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Home cameras</h1>
          <p className="mt-2 text-sm text-mute">Private website viewing. No app or Tailscale required.</p></div>
        <Link className="btn btn-ghost" href="/setup">Private access setup</Link>
      </header> : null}
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
          <header className="vision-toolbar">
            <div className="vision-brand"><span className="vision-brand-mark">V</span><span>MPDEE <strong>VISION</strong></span></div>
            <span className="vision-wall-title">{group === "all" ? "All cameras" : group === "swann" ? "Swann wall" : "Ring wall"}</span>
            <button className="vision-icon" aria-label="Open menu" onClick={() => menu.current?.showModal()}><Icon name="menu" /></button>
          </header>
          <div className={`vision-grid vision-grid-${group}`}>
            {account.cameras.map((camera) => <CameraTile key={camera.id} camera={camera} fleet={fleet}
              visible={group === "all" || group === camera.kind} dataSaver={dataSaver} epoch={epoch} expired={expired} />)}
          </div>
          <footer className="vision-dock">
            <nav className="vision-wall-tabs" aria-label="Camera walls">
              {(["swann", "all", "ring"] as const).map(value => <button key={value} aria-pressed={group === value} onClick={() => {
                fleet.stop(); setGroup(value); setEpoch(v => v + 1); setNotice(value === "ring" ? "Tap a camera to open it. Play starts Live View." : "Press Start wall to watch Swann.");
              }}>{value === "all" ? "All cameras" : value === "swann" ? "Swann" : "Ring"}</button>)}
            </nav>
            {group !== "ring" ? <button className="vision-start" onClick={() => {
              if (document.hidden || navigator.onLine === false) return;
              setNotice("Starting Swann cameras…");
              void fleet.watch(account.cameras.filter(c => c.kind === "swann"))
                .then((failed) => setNotice(failed?.length
                  ? `${failed.join(", ")} could not start. Use each camera's Retry button.`
                  : "Connections requested. LIVE appears when moving video is confirmed."))
                .catch(() => setError("Could not start the wall. Please try again."));
            }} disabled={busy || !account.cameras.some(c => c.kind === "swann")}><Icon name="play" />Start wall</button> : <span className="vision-snapshot-hint"><Icon name="image" />Snapshots</span>}
          </footer>
          <p className="vision-notice" role="status">{notice}</p>
          <dialog ref={menu} className="vision-menu" aria-labelledby="vision-menu-title">
            <div className="vision-menu-heading"><h2 id="vision-menu-title">Vision menu</h2><button className="vision-icon" aria-label="Close menu" onClick={() => menu.current?.close()}><Icon name="close" /></button></div>
            <p className="vision-menu-account">Signed in as {account.username}</p>
            <button className="vision-menu-action" onClick={() => { menu.current?.close(); setSessionsOpen(true); }}>Manage saved sign-ins</button>
            <button className="vision-menu-action" onClick={() => { fleet.stop(); setEpoch(v => v + 1); setNotice("Viewing stopped. Press Start wall when you're ready."); menu.current?.close(); }}><Icon name="stop" />Stop all cameras</button>
            <label className="vision-menu-toggle"><span><strong>Data Saver</strong><small>Keep Ring on snapshots, even in fullscreen.</small></span><input type="checkbox" checked={dataSaver} onChange={e => {fleet.stop();setDataSaver(e.target.checked);setEpoch(v=>v+1);}} /></label>
            <details><summary>Using Vision on your phone</summary><p>Tap a camera to open fullscreen. Ring stays on a snapshot until you press Play. Use the speaker to hear one camera at a time.</p><p>In Safari, tap Share, then Add to Home Screen for quick access.</p></details>
            <details><summary>Viewing and privacy</summary><p>Swann uses SD to save data, with up to five cameras at once. Connections last up to 15 minutes. Ring Live View lasts up to five minutes.</p><p>Leaving the page, locking your phone or going offline stops live viewing. Press Play or Start wall to resume.</p><Link href="/setup">Private access and recording playback</Link></details>
            <button className="vision-menu-action" disabled={busy} onClick={() => {menu.current?.close();void logout();}}>Sign out</button>
          </dialog>
          {sessionsOpen ? <SavedSessions onClose={() => setSessionsOpen(false)} onExpired={expired} /> : null}
        </>}

      {error ? <p role="alert" className={account ? "vision-global-error" : "text-danger"}>{error}</p> : null}
    </main>
  );
}
