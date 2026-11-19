"use client";

/* eslint-disable @next/next/no-img-element -- Authenticated in-memory JPEGs must not enter an image optimiser/cache. */
import Link from "next/link";
import "./camera-wall.css";
import { SavedSessions } from "./saved-sessions";
import { VisionStartup } from "./vision-startup";
import { VisionSettings } from "./vision-settings";
import { DEFAULT_VISION_PREFERENCES, VISION_PREFERENCES_KEY, normalizePreferences, effectiveLayout, featuredSlots, type VisionPreferences, type Wall } from "@/lib/vision-layout";
import { useCallback, useEffect, useRef, useState, type FormEvent, type PointerEvent } from "react";
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

function CameraTile({ camera, fleet, visible, expired, dataSaver, epoch, slot, featured, paused, onFeature, onRotation, onSolo, onSnapshot }: {
  camera: ViewerCamera; fleet: ViewerFleet; visible: boolean;
  expired: () => void; dataSaver: boolean; epoch: number;
  slot: string; featured: boolean; paused: boolean; onFeature: (id: string) => void;
  onRotation: () => void; onSolo: (id: string | null, kind?: ViewerCamera["kind"]) => void;
  onSnapshot: (id: string, snapshot: ViewerSnapshot) => void;
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
  const mainFeature = featured && slot === "vision-feature-main";
  useEffect(() => {
    if (fullscreen) onSolo(camera.id, camera.kind);
    return () => { if (fullscreen) onSolo(null); };
  }, [fullscreen, camera.id, camera.kind, onSolo]);
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
      onSnapshot(camera.id, result);
    } catch (failure) {
      if (generation === snapshotGeneration.current) {
        setError(failure instanceof ViewerApiError ? failure.message : "Snapshot unavailable. Tap refresh to retry.");
        if (failure instanceof ViewerApiError && failure.status === 401) expired();
      }
    } finally {
      if (generation === snapshotGeneration.current) setSnapshotRequest(null);
    }
  }, [camera.id, epoch, expired, snapshotBusy, onSnapshot]);

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
    <section ref={container} hidden={!visible} data-camera-id={camera.id} className={`vision-tile ${featured ? slot : ""}${fullscreen ? " vision-solo" : ""}`} inert={featured && slot === "vision-feature-held" && !fullscreen ? true : undefined}
      role={fullscreen ? "dialog" : "region"} aria-modal={fullscreen ? true : undefined}
      aria-label={`${camera.label} ${camera.kind} camera${fullscreen ? " fullscreen" : ""}`}>
      <video ref={video} className={`vision-picture ${active ? "" : "hidden"}`} muted autoPlay playsInline aria-label={`${camera.label} live video`} />
      {ring && !active && snapshot ? <img className="vision-picture" src={`data:image/jpeg;base64,${snapshot.image}`} alt={`${camera.label} snapshot, not live`} /> : null}
      {!fullscreen ? <button className="vision-tile-open"
        onClick={() => mainFeature ? onRotation() : featured ? onFeature(camera.id) : openFullscreen()}
        onDoubleClick={featured ? openFullscreen : undefined}
        aria-pressed={mainFeature ? paused : undefined}
        aria-label={mainFeature ? `${paused ? "Resume" : "Pause"} camera rotation` : featured ? `Feature ${camera.label}` : `Open ${camera.label} fullscreen`} /> : null}
      {featured && !fullscreen ? <button className="vision-expand vision-icon vision-badge" onClick={openFullscreen} aria-label={`Open ${camera.label} fullscreen`} title="Open fullscreen"><Icon name="expand" /></button> : null}
      {!active && !(ring && snapshot) ? <div className="vision-placeholder" aria-hidden="true"><Icon name={ring ? "image" : "play"} /><span>{snapshotBusy ? "Loading snapshot…" : ring ? "Snapshot unavailable" : state.status === "error" ? "Connection unavailable" : state.status === "stopped" ? state.message : "Ready to watch"}</span></div> : null}
      <span className={`vision-status vision-badge ${state.status === "playing" ? "is-live" : ""}`} role="status">{state.status === "playing" ? "LIVE" : state.status === "connecting" ? "Connecting…" : ring ? "SNAPSHOT" : state.status === "error" ? "UNAVAILABLE" : state.status === "stopped" ? "PAUSED" : "SD"}</span>
      <span className="vision-name vision-badge">{camera.label}</span>
      {mainFeature && paused && !fullscreen ? <span className="vision-rotation-state vision-badge">Rotation paused</span> : null}
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
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [preferences, setPreferences] = useState<VisionPreferences>(DEFAULT_VISION_PREFERENCES);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [widePointer, setWidePointer] = useState(false);
  const [layoutOverride, setLayoutOverride] = useState<"featured" | "grid" | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [startup, setStartup] = useState(true);
  const [featuredId, setFeaturedId] = useState("");
  const [paused, setPaused] = useState(false);
  const [soloId, setSoloId] = useState<string | null>(null);
  const [pageVisible, setPageVisible] = useState(true);
  const [wallStarted, setWallStarted] = useState(false);
  const [snapshots, setSnapshots] = useState<Record<string, ViewerSnapshot>>({});
  const pointerStart = useRef<{x: number; y: number} | null>(null);
  const suppressClick = useRef(false);
  const dataSaver = preferences.dataSaver;
  const layout = effectiveLayout(preferences.layout, widePointer, layoutOverride);
  const featured = group === "all" && layout === "featured";
  const selected = account?.cameras.find(camera => camera.id === featuredId) ?? account?.cameras[0];
  const selectedIndex = account?.cameras.findIndex(camera => camera.id === selected?.id) ?? 0;
  const slots = featuredSlots(account?.cameras ?? [], selected?.id ?? "", selectedIndex);
  const receiveSnapshot = useCallback((id: string, snapshot: ViewerSnapshot) => setSnapshots(value => ({...value, [id]: snapshot})), []);
  const finishStartup = useCallback(() => setStartup(false), []);
  const changeSolo = useCallback((id: string | null, kind?: ViewerCamera["kind"]) => {
    setSoloId(id);
    if (id && kind === "ring") setWallStarted(false);
  }, []);
  const clearSessionView = useCallback(() => {
    menu.current?.close();
    setMenuOpen(false); setSettingsOpen(false); setSessionsOpen(false);
    setWallStarted(false); setSoloId(null); setSnapshots({});
    setFeaturedId(""); setPaused(false); setGroup("all");
  }, []);
  useEffect(() => {
    const media = matchMedia("(min-width: 1100px) and (hover: hover) and (pointer: fine)");
    const update = () => setWidePointer(media.matches);
    const initialise = setTimeout(() => {
      update();
      try { setPreferences(normalizePreferences(JSON.parse(localStorage.getItem(VISION_PREFERENCES_KEY) ?? "null"))); } catch { /* Private browsing can deny storage. */ }
      const urlLayout = new URL(location.href).searchParams.get("wallLayout");
      if (urlLayout === "grid" || urlLayout === "featured") setLayoutOverride(urlLayout);
      setPreferencesReady(true);
    }, 0);
    media.addEventListener("change", update);
    return () => { clearTimeout(initialise); media.removeEventListener("change", update); };
  }, []);
  useEffect(() => {
    if (!featured || paused || !pageVisible || soloId || menuOpen || settingsOpen || sessionsOpen || startup || !account?.cameras.length) return;
    const timer = setInterval(() => {
      setFeaturedId(current => {
        const index = account.cameras.findIndex(camera => camera.id === (current || account.cameras[0].id));
        return account.cameras[(index + 1) % account.cameras.length].id;
      });
    }, preferences.seconds * 1000);
    return () => clearInterval(timer);
  }, [featured, paused, pageVisible, soloId, menuOpen, settingsOpen, sessionsOpen, startup, account, preferences.seconds]);
  const [epoch, setEpoch] = useState(0);
  const [notice, setNotice] = useState("Press Start wall to watch Swann. Ring stays on snapshots.");
  const invalidateAuth = useCallback(() => { ++authGeneration.current; }, []);
  const [expired] = useState(() => () => {
    fleet.stop();
    invalidateAuth();
    if (mounted.current) {
      clearSessionView();
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
      setWallStarted(false);
    };
    const visibility = () => { setPageVisible(!document.hidden); if (document.hidden) stop(); };
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
    setWallStarted(false);
    setEpoch((value) => value + 1);
    setBusy(true);
    setError("");
    try {
      await viewerApi("logout");
      if (mounted.current && generation === authGeneration.current) { clearSessionView(); setAccount(null); }
    } catch (failure) {
      if (mounted.current && generation === authGeneration.current) {
        if (failure instanceof ViewerApiError && failure.status === 401) { clearSessionView(); setAccount(null); }
        else setError("Sign-out could not be confirmed. Viewing stopped; please try signing out again.");
      }
    } finally {
      if (mounted.current && generation === authGeneration.current) setBusy(false);
    }
  }

  function closeMenu() { menu.current?.close(); setMenuOpen(false); }
  function updatePreferences(next: VisionPreferences) {
    const clean = normalizePreferences(next);
    if (clean.layout !== preferences.layout) setLayoutOverride(null);
    if (clean.dataSaver !== preferences.dataSaver) { fleet.stop(); setEpoch(value => value + 1); setWallStarted(false); }
    setPreferences(clean);
    try { localStorage.setItem(VISION_PREFERENCES_KEY, JSON.stringify(clean)); } catch { /* Session preferences still work. */ }
  }
  function chooseWall(value: Wall, quickSwitch = false) {
    if (quickSwitch && value === "all" && group === "all" && preferences.layout === "auto") {
      setLayoutOverride(layout === "featured" ? "grid" : "featured");
    } else if (value !== group) {
      // All and Swann share their mounted players. Ring is snapshot-only on the wall.
      if (value === "ring") { fleet.stop(); setWallStarted(false); }
      setGroup(value); setEpoch(current => current + 1);
    }
    closeMenu();
  }
  function startWall() {
    if (!account || document.hidden || navigator.onLine === false) return;
    setWallStarted(true); setNotice("Starting Swann cameras…"); closeMenu();
    void fleet.watch(account.cameras.filter(camera => camera.kind === "swann"))
      .then(failed => setNotice(failed?.length ? `${failed.join(", ")} could not start. Use each camera's Retry button.` : "LIVE appears when moving video is confirmed."))
      .catch(() => { setError("Could not start the wall. Please try again."); setWallStarted(false); });
  }
  function swipeStart(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" || soloId || (event.target as HTMLElement).closest(".vision-tile-controls,.vision-expand")) return;
    pointerStart.current = {x:event.clientX, y:event.clientY};
  }
  function swipeEnd(event: PointerEvent<HTMLDivElement>) {
    const start = pointerStart.current; pointerStart.current = null;
    if (!start) return;
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    if (Math.abs(dx) < 65 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    suppressClick.current = true;
    const order: Wall[] = ["swann", "all", "ring"];
    chooseWall(order[Math.min(2, Math.max(0, order.indexOf(group) + (dx < 0 ? 1 : -1)))]);
    setTimeout(() => { suppressClick.current = false; }, 0);
  }
  const selectedRing = selected?.kind === "ring" ? selected : null;
  const ringIndex = account?.cameras.filter(camera => camera.kind === "ring").findIndex(camera => camera.id === selected?.id) ?? 0;

  return <>
    <main className={account ? `vision-app vision-fit-${preferences.fit}` : "vision-login"} inert={startup ? true : undefined} data-vision-ui="dell-parity-1" aria-label="MPDEE Vision">
      {!account ? <div className="vision-login-shell">
        <header className="vision-login-brand"><span className="vision-logo" aria-hidden="true">△</span><span>MPDEE <strong>VISION</strong></span></header>
        {!enabled ? <section className="vision-login-panel"><h1>Website viewing is unavailable</h1><p>Use private access to open your cameras.</p><Link href="/setup">Open private access setup</Link></section>
          : checking ? <p role="status">Checking sign-in…</p> : <section className="vision-login-panel">
            <h1>Sign in to Vision</h1><p>Your home cameras, wherever you are.</p>
            <form onSubmit={login}>
              <label>Username<input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={48} required disabled={busy} /></label>
              <label>Password<input name="password" type="password" autoComplete="current-password" maxLength={256} required disabled={busy} /></label>
              <button className="vision-primary" disabled={busy} type="submit">{busy ? "Signing in…" : "Sign in"}</button>
            </form>
            <p className="vision-login-help">Use your individual camera account. Your sign-in lasts up to seven days.</p>
            <Link href="/setup">Private access setup</Link>
          </section>}
      </div> : <>
        <div className={`vision-grid vision-grid-${group}${featured ? " vision-featured" : ""}`} data-layout={featured ? "featured" : "grid"}
          onPointerDown={swipeStart} onPointerUp={swipeEnd} onPointerCancel={() => { pointerStart.current = null; }}
          onClickCapture={event => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); } }}>
          {account.cameras.map(camera => <CameraTile key={camera.id} camera={camera} fleet={fleet}
            visible={group === "all" || group === camera.kind} dataSaver={dataSaver} epoch={epoch} expired={expired}
            featured={featured} slot={slots[camera.id] ?? ""} paused={paused} onFeature={setFeaturedId}
            onRotation={() => setPaused(value => !value)} onSolo={changeSolo} onSnapshot={receiveSnapshot} />)}
          {featured && selectedRing ? <div className={`vision-feature-ring-copy vision-feature-bottom-${ringIndex + 1}`} aria-hidden="true">
            {snapshots[selectedRing.id] ? <img className="vision-picture" src={`data:image/jpeg;base64,${snapshots[selectedRing.id].image}`} alt="" /> : <div className="vision-placeholder"><Icon name="image" /></div>}
            <span className="vision-status vision-badge">SNAPSHOT</span><span className="vision-name vision-badge">{selectedRing.label}</span>
          </div> : null}
        </div>
        <button className="vision-burger vision-icon" aria-label="Open menu" aria-expanded={menuOpen} onClick={() => { menu.current?.showModal(); setMenuOpen(true); }}><Icon name="menu" /></button>
        <nav className="vision-wall-dots" aria-label="Camera walls">{(["swann", "all", "ring"] as const).map(value => <button key={value} aria-label={value === "all" ? "All Cameras" : value === "swann" ? "Swann" : "Ring"} title={value === "all" ? "All Cameras" : value === "swann" ? "Swann Cameras" : "Ring Cameras"} aria-pressed={group === value} onClick={() => chooseWall(value)}><span /></button>)}</nav>
        {!wallStarted && group !== "ring" && !soloId && account.cameras.some(camera => camera.kind === "swann") ? <button className="vision-start vision-start-floating" onClick={startWall} disabled={busy}><Icon name="play" />Start wall</button> : null}
        {!account.cameras.length ? <p className="vision-empty">No cameras are assigned to this account. Ask the owner to update your access.</p> : null}
        <p className="vision-notice" role="status">{notice}</p>
        <dialog ref={menu} className="vision-menu vision-main-menu" aria-labelledby="vision-menu-title" onClose={() => setMenuOpen(false)}
          onClick={event => { if (event.target === event.currentTarget) { const box = event.currentTarget.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeMenu(); } }}>
          <div className="vision-menu-heading"><h2 id="vision-menu-title">Vision menu</h2><button className="vision-icon" aria-label="Close menu" onClick={closeMenu}><Icon name="close" /></button></div>
          <div className="vision-menu-walls">{(["swann", "all", "ring"] as const).map(value => <button key={value} className="vision-menu-action" aria-current={group === value ? "page" : undefined}
            title={value === "all" && group === "all" && preferences.layout === "auto" ? `Switch to ${layout === "featured" ? "Grid" : "Featured"}` : undefined}
            onClick={() => chooseWall(value, true)}><span className="vision-menu-selection" aria-hidden="true">{group === value ? "✓" : ""}</span>{value === "all" ? "All Cameras" : value === "swann" ? "Swann Cameras" : "Ring Cameras"}{value === "all" && group === "all" && preferences.layout === "auto" ? <span className="vision-layout-switch" aria-label={`Switch to ${layout === "featured" ? "Grid" : "Featured"}`}>⇄</span> : null}</button>)}</div>
          {group !== "ring" ? <button className="vision-menu-action" onClick={startWall} disabled={!account.cameras.some(camera => camera.kind === "swann")}><Icon name="play" />Start wall</button> : null}
          <button className="vision-menu-action" onClick={() => { fleet.stop(); setEpoch(value => value + 1); setWallStarted(false); setNotice("Viewing stopped. Press Start wall when you're ready."); closeMenu(); }}><Icon name="stop" />Stop all cameras</button>
          <div className="vision-menu-divider" />
          <button className="vision-menu-action" onClick={() => { closeMenu(); setSettingsOpen(true); }}>Settings</button>
          <button className="vision-menu-action" onClick={() => { closeMenu(); setSessionsOpen(true); }}>Manage saved sign-ins</button>
          <label className="vision-menu-toggle"><span>Data Saver</span><input type="checkbox" aria-label="Data Saver" checked={dataSaver} onChange={event => updatePreferences({...preferences, dataSaver:event.target.checked})} /></label>
          <div className="vision-menu-divider" />
          <button className="vision-menu-action" disabled={busy} onClick={() => { closeMenu(); void logout(); }}>Sign out</button>
          <p className="vision-menu-account">{account.username}<span>△ Web</span></p>
        </dialog>
        {settingsOpen ? <VisionSettings preferences={preferences} onChange={updatePreferences} username={account.username}
          onClose={() => setSettingsOpen(false)} onSessions={() => { setSettingsOpen(false); setSessionsOpen(true); }}
          onLogout={() => { setSettingsOpen(false); void logout(); }} /> : null}
        {sessionsOpen ? <SavedSessions onClose={() => setSessionsOpen(false)} onExpired={expired} /> : null}
      </>}
      {error ? <p role="alert" className={account ? "vision-global-error" : "vision-login-error"}>{error}<button aria-label="Dismiss message" onClick={() => setError("")}>×</button></p> : null}
    </main>
    {startup ? <VisionStartup ready={!checking && preferencesReady} onComplete={finishStartup} /> : null}
  </>;
}
