"use client";

/* eslint-disable @next/next/no-img-element -- Authenticated in-memory JPEGs must not enter an image optimiser/cache. */
import Link from "next/link";
import "./camera-wall.css";
import { CameraBoundary } from "./camera-boundary";
import { reportBrowserIncident } from "@/lib/diagnostics-client";
import { SavedSessions } from "./saved-sessions";
import { VisionStartup } from "./vision-startup";
import { VisionSettings } from "./vision-settings";
import { useViewerChrome } from "./use-viewer-chrome";
import { useViewerInsets } from "./use-viewer-insets";
import { DEFAULT_VISION_PREFERENCES, VISION_PREFERENCES_KEY, normalizePreferences, effectiveLayout, featuredSlots, type VisionPreferences, type Wall } from "@/lib/vision-layout";
import { useCallback, useEffect, useRef, useState, type FormEvent, type PointerEvent } from "react";
import {
  INITIAL_PLAYER_STATE, validSession, viewerApi, ViewerApiError, ViewerFleet, safeViewerMessage, viewerErrorReference,
  ViewerPlayer, type PlayerState,
} from "@/lib/viewer-player";
import {
  RECORDING_LABELS, validRecording, validSnapshot, type RecordingState, type ViewerCamera, type ViewerSnapshot,
} from "@/lib/viewer-protocol";

function Icon({ name }: { name: "play" | "stop" | "sound" | "muted" | "close" | "menu" | "image" | "expand" | "pause" | "volume" | "reload" }) {
  const paths = { reload: "M20 7v5h-5M20 12a8 8 0 1 0-2.34 5.66M20 12a8 8 0 0 0-2.34-5.66", pause: "M9 5v14m6-14v14", play: "m8 5 11 7-11 7Z", stop: "M6 6h12v12H6Z", sound: "m11 5-6 4H2v6h3l6 4ZM15 8c3 2 3 6 0 8m3-11c5 4 5 10 0 14", muted: "m11 5-6 4H2v6h3l6 4ZM16 9l6 6m0-6-6 6", volume: "M4 10v4m4-7v10m4-13v16m4-13v10m4-7v4", close: "m6 6 12 12M6 18 18 6", menu: "M2 6h20M2 12h20M2 18h20", image: "M3 3h18v18H3ZM3 17l6-6 4 4 3-3 5 5M7 7h2", expand: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" };
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
}

function PlayIcon() {
  // The triangle is a transparent cutout, like the owner's circular reference.
  return <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false" fill="currentColor">
    <path fillRule="evenodd" d="M16 1a15 15 0 1 0 0 30a15 15 0 0 0 0-30ZM11 7l14 9-14 9Z" />
  </svg>;
}

function useRecordingStatus(enabled: boolean) {
  const [states, setStates] = useState<Record<string, RecordingState>>({});
  useEffect(() => {
    if (!enabled) return;
    let request: AbortController | undefined;
    let pollTimer: ReturnType<typeof setTimeout>;
    let expiryTimer: ReturnType<typeof setTimeout>;
    const stop = () => {
      request?.abort();
      request = undefined;
      clearTimeout(pollTimer);
      clearTimeout(expiryTimer);
    };
    const poll = async () => {
      const current = new AbortController();
      request = current;
      const started = performance.now();
      try {
        const result = await viewerApi("recording", {}, current.signal);
        if (current.signal.aborted) return;
        if (!validRecording(result)) throw new Error("Invalid recording status");
        clearTimeout(expiryTimer);
        const update = () => {
          const elapsed = performance.now() - started;
          const fresh = Object.entries(result.cameras).filter(([, row]) => row.validForMs > elapsed);
          setStates(Object.fromEntries(fresh.map(([id, row]) => [id, row.state])));
          if (fresh.length) {
            expiryTimer = setTimeout(update, Math.min(...fresh.map(([, row]) => row.validForMs)) - elapsed);
          }
        };
        update();
      } catch {
        if (!current.signal.aborted) {
          clearTimeout(expiryTimer);
          setStates({});
        }
      } finally {
        if (!current.signal.aborted) pollTimer = setTimeout(poll, 10_000);
      }
    };
    const refresh = () => {
      stop();
      setStates({});
      if (!document.hidden) void poll();
    };
    refresh();
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("pagehide", stop);
    window.addEventListener("pageshow", refresh);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("pagehide", stop);
      window.removeEventListener("pageshow", refresh);
    };
  }, [enabled]);
  return enabled ? states : {};
}

const WALL_ORDER: readonly Wall[] = ["swann", "all", "ring"];

function compactAge(at: number, now: number, event = false) {
  const seconds = Math.max(0, Math.floor(now / 1000 - at));
  if (event && seconds < 60) return `${Math.max(1, seconds)}s`;
  if (seconds < 60) return `${Math.floor(seconds / 10) * 10}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < (event ? 172800 : 86400)) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function RingWallBadges({ snapshot, now }: { snapshot?: ViewerSnapshot | null; now: number }) {
  if (!snapshot) return null;
  const at = snapshot.capturedAt ?? snapshot.cachedAt;
  const age = at === undefined ? null : compactAge(at, now);
  const description = age ? `Snapshot ${snapshot.capturedAt === null ? "cached " : ""}${age} ago` : "";
  return <>
    {age ? <span className="vision-age vision-badge" title={description} aria-label={description}><Icon name="image" />{age}</span> : <span className="vision-notice">Snapshot capture time unknown</span>}
    <div className="vision-ring-status">
      {snapshot.battery !== undefined ? <span className="vision-badge" title={`Battery ${snapshot.battery}%`}>{snapshot.battery}%</span> : null}
      {snapshot.weakWifi ? <span className="vision-badge" title="Weak Wi-Fi">Wi-Fi</span> : null}
    </div>
  </>;
}

function CameraTile({ camera, fleet, visible, expired, dataSaver, epoch, slot, featured, paused, onFeature, onRotation, onSolo, onSnapshot, recording }: {
  recording: RecordingState; camera: ViewerCamera; fleet: ViewerFleet; visible: boolean;
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
  const [errorReference, setErrorReference] = useState("");
  const [now, setNow] = useState(0);
  const snapshotBusy = snapshotRequest === epoch;
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [volume, setVolume] = useState(1);
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
    if (visible && !ring) void player.current?.resumeFromRingWall();
  }, [visible, ring]);

  useEffect(() => {
    cancelSnapshot();
  }, [epoch, cancelSnapshot]);

  useEffect(() => {
    const at = snapshot?.capturedAt ?? snapshot?.cachedAt;
    if (!visible || at === undefined) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const timestamp = Date.now();
      setNow(timestamp);
      const elapsed = Math.max(0, timestamp - at * 1000);
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
        "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [href], [tabindex='0']",
      ) ?? [])].filter(control => !control.hidden && control.getClientRects().length > 0);
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
  const refreshSnapshot = useCallback(async () => {
    if (document.hidden) return;
    const generation = ++snapshotGeneration.current;
    const abort = new AbortController();
    snapshotAbort.current?.abort();
    snapshotAbort.current = abort;
    setSnapshotRequest(epoch);
    setError(""); setErrorReference("");
    try {
      const result = await viewerApi("snapshot", { camera: camera.id }, abort.signal);
      if (generation !== snapshotGeneration.current || document.hidden) return;
      if (!validSnapshot(result) || result.camera !== camera.id) throw new Error("Snapshot unavailable.");
      setNow(Date.now());
      setSnapshot(result);
      onSnapshot(camera.id, result);
    } catch (failure) {
      if (generation === snapshotGeneration.current) {
        setError(safeViewerMessage(failure, "Snapshot unavailable. Tap refresh to retry."));
        setErrorReference(viewerErrorReference(failure) || (failure instanceof ViewerApiError ? "" : reportBrowserIncident({code: "snapshot_failed", operation: "snapshot",
          camera: camera.id, error: failure, severity: "warning"})));
        if (failure instanceof ViewerApiError && failure.status === 401) expired();
      }
    } finally {
      if (generation === snapshotGeneration.current) setSnapshotRequest(null);
    }
  }, [camera.id, epoch, expired, onSnapshot]);

  useEffect(() => {
    if (!ring || !visible || active) return;
    const refresh = () => { void refreshSnapshot(); };
    const timer = setTimeout(refresh, 0);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", refresh);
      cancelSnapshot();
    };
  }, [ring, visible, active, refreshSnapshot, cancelSnapshot]);

  function openFullscreen() {
    if (ring) fleet.enterRingFullscreen(camera.id);
    setFullscreenEpoch(epoch);
    setError("");
  }
  function play() {
    if (document.hidden || navigator.onLine === false) { setError("You're offline. Reconnect, then press Play."); return; }
    setError("");
    void (ring ? fleet.playRingFullscreen(camera) : fleet.retrySwann(camera))
      .catch(() => setError("Could not start this camera. Please try again."));
  }
  const swannCanPlay = !ring && !active;
  return (
    <section ref={container} hidden={!visible} data-camera-id={camera.id} className={`vision-tile ${featured ? slot : ""}${fullscreen ? " vision-solo" : ""}`} inert={featured && slot === "vision-feature-held" && !fullscreen ? true : undefined}
      role={fullscreen ? "dialog" : "region"} aria-modal={fullscreen ? true : undefined}
      aria-label={`${camera.label} ${camera.kind} camera${fullscreen ? " fullscreen" : ""}`}>
      <video ref={video} className={`vision-picture ${active ? "" : "hidden"}`} muted autoPlay playsInline aria-label={`${camera.label} live video`} />
      {ring && !active && snapshot ? <img className="vision-picture" src={`data:image/jpeg;base64,${snapshot.image}`} alt={`${camera.label} snapshot, not live`} /> : null}
      {swannCanPlay ? <button className="vision-tile-open vision-tile-play" onClick={play} aria-label={`Play ${camera.label}`}>
        <span className="vision-play vision-action"><PlayIcon /></span>
      </button> : !fullscreen ? <button className="vision-tile-open"
        disabled={state.status === "connecting"}
        onClick={() => ring && featured ? onFeature(camera.id) : openFullscreen()}
        onDoubleClick={ring && featured ? openFullscreen : undefined}
        aria-label={ring && featured ? `Feature ${camera.label}` : `Open ${camera.label} fullscreen`} /> : null}
      {ring && featured && !fullscreen ? <button className="vision-expand vision-icon vision-badge vision-action" onClick={openFullscreen} aria-label={`Open ${camera.label} fullscreen`} title="Open fullscreen"><Icon name="expand" /></button> : null}
      {ring && !fullscreen && !active && !snapshot ? <div className="vision-placeholder" role="status"><Icon name="image" /><span>{snapshotBusy ? "Loading snapshot…" : "Snapshot unavailable"}</span></div> : null}
      {state.status === "connecting" ? <div className="vision-placeholder" role="status"><span>Connecting…</span></div> : null}
      {!ring ? <span className="vision-recording" role="img" data-recording-state={recording} aria-label={RECORDING_LABELS[recording]} title={RECORDING_LABELS[recording]} /> : null}
      {ring && state.status === "playing" ? <span className="vision-ring-live vision-badge">LIVE</span> : null}
      <span className="vision-name vision-badge">{camera.label}{ring && snapshot?.eventAt ? <span className="vision-event-age" title="Time since last Ring event">{compactAge(snapshot.eventAt, now, true)}</span> : null}</span>
      {ring && !active ? <RingWallBadges snapshot={snapshot} now={now} /> : null}
      {mainFeature && !fullscreen ? <button className="vision-rotation-state vision-icon vision-badge vision-action" onClick={onRotation} aria-pressed={paused} aria-label={`${paused ? "Resume" : "Pause"} camera rotation`}><Icon name={paused ? "play" : "pause"} /></button> : null}
      {fullscreen && active && remaining !== null ? <span className="vision-budget vision-badge" aria-label={`Viewing ends in ${Math.floor(remaining / 60)} minutes ${remaining % 60} seconds`}>{Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}</span> : null}
      {!ring && active ? <button className="vision-icon vision-badge vision-stop vision-action" onClick={() => { player.current?.stop(); setVolumeOpen(false); }} aria-label={`Stop ${camera.label}`}><Icon name="stop" /></button> : null}
      <div className="vision-tile-controls vision-action">
        {active ? <>
          <button className="vision-icon vision-badge" disabled={state.status !== "playing"} aria-pressed={!state.muted} aria-label={`${state.muted ? "Unmute" : "Mute"} ${camera.label}`} onClick={() => void fleet.sound(camera.id)}><Icon name={state.muted ? "muted" : "sound"} /></button>
          <button className="vision-icon vision-badge" disabled={state.status !== "playing"} aria-label={`Volume for ${camera.label}`} aria-expanded={volumeOpen} onClick={() => setVolumeOpen(value => !value)}><Icon name="volume" /></button>
          {volumeOpen && state.status === "playing" ? <input className="vision-volume vision-chrome" type="range" aria-label={`${camera.label} volume`} min="0" max="1" step=".05" value={volume} onChange={event => {
            const next = Number(event.target.value);
            if (video.current) video.current.volume = next;
            setVolume(next);
          }} /> : null}
          {ring ? <button className="vision-icon vision-badge vision-ring-stop" onClick={() => { player.current?.stop(); setVolumeOpen(false); }} aria-label={`Stop ${camera.label}`}><Icon name="stop" /></button> : null}
        </> : null}
      </div>
      {fullscreen ? <>
        <button className="vision-close vision-icon vision-chrome vision-action" onClick={closeFullscreen} aria-label="Close fullscreen"><Icon name="close" /></button>
        {ring && !active ? <div className="vision-play-area vision-action"><button className="vision-play" aria-label="Play" aria-describedby={`vision-play-note-${camera.id}`} disabled={dataSaver} onClick={play}><PlayIcon /></button><p id={`vision-play-note-${camera.id}`}>{dataSaver ? "Data Saver is on. Turn it off in the menu to play." : "Starts a Ring Live View · up to 5 minutes"}</p></div> : null}
      </> : null}
      {(error && (!ring || fullscreen || snapshot)) || state.status === "error" ? <p className="vision-camera-error" role="alert">{error || state.message}{errorReference || state.reference ? <small> Reference: {errorReference || state.reference}</small> : null}</p> : null}
    </section>
  );
}

export function CameraViewer({ enabled }: { enabled: boolean }) {
  const screen = useRef<HTMLElement>(null);
  const [fleet] = useState(() => new ViewerFleet());
  const mounted = useRef(false);
  const authGeneration = useRef(0);
  const [account, setAccount] = useState<{ username: string; cameras: ViewerCamera[] } | null>(null);
  const [checking, setChecking] = useState(enabled);
  const [sessionRetry, setSessionRetry] = useState(0);
  const [canRetrySession, setCanRetrySession] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [errorReference, setErrorReference] = useState("");
  const [group, setGroup] = useState<"all" | "swann" | "ring">("all");
  const recordingStates = useRecordingStatus(group !== "ring" && !!account?.cameras.some(camera => camera.kind === "swann"));
  const menu = useRef<HTMLDialogElement>(null);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [preferences, setPreferences] = useState<VisionPreferences>(DEFAULT_VISION_PREFERENCES);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [widePointer, setWidePointer] = useState(false);
  const [layoutOverride, setLayoutOverride] = useState<"featured" | "grid" | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [startup, setStartup] = useState(false);
  const [launchPending, setLaunchPending] = useState(false);
  const [featuredId, setFeaturedId] = useState("");
  const [paused, setPaused] = useState(false);
  const [soloId, setSoloId] = useState<string | null>(null);
  const [pageVisible, setPageVisible] = useState(true);
  const [wallNow, setWallNow] = useState(0);
  const [snapshots, setSnapshots] = useState<Record<string, ViewerSnapshot>>({});
  const pointerStart = useRef<{x: number; y: number} | null>(null);
  const suppressClick = useRef(false);
  const dataSaver = preferences.dataSaver;
  const layout = effectiveLayout(preferences.layout, widePointer, layoutOverride);
  const featured = group === "all" && layout === "featured";
  const selected = account?.cameras.find(camera => camera.id === featuredId) ?? account?.cameras[0];
  const selectedIndex = account?.cameras.findIndex(camera => camera.id === selected?.id) ?? 0;
  const slots = featuredSlots(account?.cameras ?? [], selected?.id ?? "", selectedIndex);
  useViewerChrome(screen, !!account && !startup, menuOpen || settingsOpen || sessionsOpen || !!error, `${group}:${soloId ?? "wall"}`);
  useViewerInsets(screen, !!account, `${group}:${layout}:${selected?.id}:${soloId}:${account?.cameras.length}`);
  const receiveSnapshot = useCallback((id: string, snapshot: ViewerSnapshot) => {
    setWallNow(Date.now());
    setSnapshots(value => ({...value, [id]: snapshot}));
  }, []);

  const finishStartup = useCallback(() => setStartup(false), []);
  const changeSolo = useCallback((id: string | null) => {
    setSoloId(id);
  }, []);
  const clearSessionView = useCallback(() => {
    menu.current?.close();
    setMenuOpen(false); setSettingsOpen(false); setSessionsOpen(false);
    setSoloId(null); setSnapshots({});
    setFeaturedId(""); setPaused(false); setGroup("all");
    setStartup(false); setLaunchPending(false);
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
  useEffect(() => {
    if (!featured || !pageVisible) return;
    const timer = setInterval(() => setWallNow(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, [featured, pageVisible]);
  const [epoch, setEpoch] = useState(0);
  const [notice, setNotice] = useState("Vision starts after sign-in. Ring stays on snapshots.");
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
      setLaunchPending(false);
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
        if (mounted.current && authGeneration.current === generation) {
          setCanRetrySession(false); setAccount(value); setStartup(true); setLaunchPending(true);
        }
      }).catch((failure: unknown) => {
        if (mounted.current && authGeneration.current === generation &&
            !(failure instanceof ViewerApiError && failure.status === 401)) {
          setError("Your saved sign-in could not be checked. You can retry without entering your password again.");
          setCanRetrySession(true);
          setErrorReference(viewerErrorReference(failure) || (failure instanceof ViewerApiError ? "" : reportBrowserIncident({code: "session_check_failed",
            operation: "session", error: failure, severity: "warning"})));
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
  }, [enabled, fleet, invalidateAuth, sessionRetry]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const generation = ++authGeneration.current;
    setBusy(true);
    setError(""); setErrorReference("");
    try {
      await viewerApi("login", { username: String(values.get("username") ?? "").trim().toLowerCase(),
        password: String(values.get("password") ?? "") });
      const session = await viewerApi("session");
      if (!validSession(session)) throw new Error("Sign-in could not be checked.");
      if (mounted.current && generation === authGeneration.current) {
        form.reset();
        setCanRetrySession(false); setAccount(session);
        setStartup(true); setLaunchPending(true);
      }
    } catch (failure) {
      if (mounted.current && generation === authGeneration.current) {
        setError(safeViewerMessage(failure, "Sign-in could not be checked. Please retry."));
        setErrorReference(viewerErrorReference(failure) || (failure instanceof ViewerApiError ? "" : reportBrowserIncident({code: "session_check_failed",
          operation: "login", error: failure, severity: "warning"})));
      }
    } finally {
      if (mounted.current && generation === authGeneration.current) setBusy(false);
    }
  }

  async function logout() {
    const generation = ++authGeneration.current;
    fleet.stop();
    setLaunchPending(false);
    setEpoch((value) => value + 1);
    setBusy(true);
    setError(""); setErrorReference("");
    try {
      await viewerApi("logout");
      if (mounted.current && generation === authGeneration.current) { clearSessionView(); setAccount(null); }
    } catch (failure) {
      if (mounted.current && generation === authGeneration.current) {
        if (failure instanceof ViewerApiError && failure.status === 401) { clearSessionView(); setAccount(null); }
        else { setError("Sign-out could not be confirmed. Viewing stopped; please try signing out again.");
          setErrorReference(viewerErrorReference(failure)); }
      }
    } finally {
      if (mounted.current && generation === authGeneration.current) setBusy(false);
    }
  }

  const closeMenu = useCallback(() => { menu.current?.close(); setMenuOpen(false); }, []);
  function reloadApp() {
    // Full document navigation, not a client-router refresh. A fresh URL bypasses
    // a stale document; the returned release selects its content-hashed JS/CSS.
    // Keep the saved sign-in, preferences and public offline fallback intact.
    const url = new URL(window.location.href);
    url.searchParams.set("_reload", Date.now().toString(36));
    setBusy(true);
    fleet.stop();
    window.location.replace(url.href);
  }
  function updatePreferences(next: VisionPreferences) {
    const clean = normalizePreferences(next);
    if (clean.layout !== preferences.layout) setLayoutOverride(null);
    if (clean.dataSaver !== preferences.dataSaver) { fleet.stop(); setEpoch(value => value + 1); }
    setPreferences(clean);
    try { localStorage.setItem(VISION_PREFERENCES_KEY, JSON.stringify(clean)); } catch { /* Session preferences still work. */ }
  }
  const chooseWall = useCallback((value: Wall, quickSwitch = false) => {
    if (quickSwitch && value === "all" && group === "all" && preferences.layout === "auto") {
      setLayoutOverride(layout === "featured" ? "grid" : "featured");
    } else if (value !== group) {
      // All and Swann share their mounted players. Ring is snapshot-only on the wall.
      if (value === "ring") fleet.enterRingWall();
      else fleet.leaveRingWall();
      setGroup(value); setEpoch(current => current + 1);
    }
    closeMenu();
  }, [closeMenu, fleet, group, layout, preferences.layout]);
  useEffect(() => {
    if (!account || startup || soloId || menuOpen || settingsOpen || sessionsOpen) return;
    function navigate(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey ||
          (event.target instanceof HTMLElement && (event.target.isContentEditable ||
            event.target.matches("input,textarea,select")))) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const next = WALL_ORDER[WALL_ORDER.indexOf(group) + (event.key === "ArrowRight" ? 1 : -1)];
      if (!next) return;
      event.preventDefault();
      chooseWall(next);
    }
    document.addEventListener("keydown", navigate);
    return () => document.removeEventListener("keydown", navigate);
  }, [account, startup, soloId, menuOpen, settingsOpen, sessionsOpen, group, chooseWall]);
  const startWall = useCallback(() => {
    if (!account || group === "ring" || document.hidden || navigator.onLine === false) return;
    const cameras = account.cameras.filter(camera => camera.kind === "swann");
    if (!cameras.length) return;
    setNotice("Starting Swann cameras…"); closeMenu();
    void fleet.watch(cameras)
      .then(failed => setNotice(failed?.length ? `${failed.join(", ")} could not start. Use each camera's Retry button.` : "LIVE appears when moving video is confirmed."))
      .catch(() => { setError("Could not start the wall. Please try again."); });
  }, [account, fleet, closeMenu, group]);
  useEffect(() => {
    if (!launchPending || !account || checking || !preferencesReady) return;
    // Launch once after authentication, after the tiles have registered players.
    // Stopping, hiding the page or reaching a lease limit never renews this launch.
    const launch = setTimeout(() => { setLaunchPending(false); startWall(); }, 0);
    return () => clearTimeout(launch);
  }, [launchPending, account, checking, preferencesReady, startWall]);
  function swipeStart(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" || soloId || (event.target as HTMLElement).closest(".vision-tile-controls,.vision-expand,.vision-stop")) return;
    pointerStart.current = {x:event.clientX, y:event.clientY};
  }
  function swipeEnd(event: PointerEvent<HTMLDivElement>) {
    const start = pointerStart.current; pointerStart.current = null;
    if (!start) return;
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    if (Math.abs(dx) < 65 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    suppressClick.current = true;
    const next = WALL_ORDER[WALL_ORDER.indexOf(group) + (dx < 0 ? 1 : -1)];
    if (next) chooseWall(next);
    setTimeout(() => { suppressClick.current = false; }, 0);
  }
  const selectedRing = selected?.kind === "ring" ? selected : null;
  const ringIndex = account?.cameras.filter(camera => camera.kind === "ring").findIndex(camera => camera.id === selected?.id) ?? 0;

  return <>
    <main ref={screen} className={account ? `vision-app vision-fit-${preferences.fit}` : "vision-login"} inert={startup ? true : undefined} data-vision-ui="dell-parity-1" aria-label="MPDEE Vision">
      {!account ? <div className="vision-login-shell">
        <header className="vision-login-brand"><span className="vision-logo" aria-hidden="true">△</span><span>MPDEE <strong>VISION</strong></span></header>
        {!enabled ? <section className="vision-login-panel"><h1>Website viewing is unavailable</h1><p>Use private access to open your cameras.</p><Link href="/setup">Open private access setup</Link></section>
          : checking ? <p role="status">Checking sign-in…</p> : <section className="vision-login-panel">
            <h1>Sign in to Vision</h1><p>Your home cameras, wherever you are.</p>
            {canRetrySession ? <button className="vision-primary" disabled={busy} onClick={() => {
              setChecking(true); setCanRetrySession(false); setError(""); setErrorReference(""); setSessionRetry(value => value + 1);
            }}>Check saved sign-in again</button> : null}
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
          {account.cameras.map(camera => <CameraBoundary key={camera.id} camera={camera}
            visible={group === "all" || group === camera.kind} slot={featured ? slots[camera.id] ?? "" : ""}>
            <CameraTile camera={camera} fleet={fleet}
            visible={group === "all" || group === camera.kind} dataSaver={dataSaver} epoch={epoch} expired={expired}
            featured={featured} slot={slots[camera.id] ?? ""} paused={paused} onFeature={setFeaturedId}
            onRotation={() => setPaused(value => !value)} onSolo={changeSolo} onSnapshot={receiveSnapshot} recording={recordingStates[camera.id] ?? "unknown"} /></CameraBoundary>)}
          {featured && selectedRing ? <div className={`vision-feature-ring-copy vision-feature-bottom-${ringIndex + 1}`} aria-hidden="true">
            {snapshots[selectedRing.id] ? <img className="vision-picture" src={`data:image/jpeg;base64,${snapshots[selectedRing.id].image}`} alt="" /> : <div className="vision-placeholder"><Icon name="image" /></div>}
            <RingWallBadges snapshot={snapshots[selectedRing.id]} now={wallNow} />
            <span className="vision-name vision-badge">{selectedRing.label}{snapshots[selectedRing.id]?.eventAt ? <span className="vision-event-age">{compactAge(snapshots[selectedRing.id].eventAt!, wallNow, true)}</span> : null}</span>
          </div> : null}
        </div>
        <button className="vision-burger vision-icon vision-action" aria-label="Open menu" aria-expanded={menuOpen} onClick={() => { menu.current?.showModal(); setMenuOpen(true); }}><Icon name="menu" /></button>
        <nav hidden={!!soloId} className="vision-wall-dots vision-action" aria-label="Camera walls">{WALL_ORDER.map(value => <button key={value} aria-label={value === "all" ? "All Cameras" : value === "swann" ? "Swann" : "Ring"} title={value === "all" ? "All Cameras" : value === "swann" ? "Swann Cameras" : "Ring Cameras"} aria-pressed={group === value} onClick={() => chooseWall(value)}><span /></button>)}</nav>
        {!account.cameras.length ? <p className="vision-empty">No cameras are assigned to this account. Ask the owner to update your access.</p> : null}
        <p className="vision-notice" role="status">{notice}</p>
        <dialog ref={menu} className="vision-menu vision-main-menu" aria-label="Vision menu" onClose={() => setMenuOpen(false)}
          onClick={event => { if (event.target === event.currentTarget) { const box = event.currentTarget.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeMenu(); } }}>
          <div className="vision-menu-walls">{WALL_ORDER.map(value => <button key={value} className="vision-menu-action" aria-current={group === value ? "page" : undefined}
            title={value === "all" && group === "all" && preferences.layout === "auto" ? `Switch to ${layout === "featured" ? "Grid" : "Featured"}` : undefined}
            onClick={() => chooseWall(value, true)}><span className="vision-menu-selection" aria-hidden="true">{group === value ? "✓" : ""}</span>{value === "all" ? "All Cameras" : value === "swann" ? "Swann Cameras" : "Ring Cameras"}{value === "all" && group === "all" && preferences.layout === "auto" ? <span className="vision-layout-switch" aria-label={`Switch to ${layout === "featured" ? "Grid" : "Featured"}`}>⇄</span> : null}</button>)}</div>
          {group !== "ring" ? <button className="vision-menu-action" onClick={startWall} disabled={!account.cameras.some(camera => camera.kind === "swann")}><Icon name="play" />Start wall</button> : null}
          <button className="vision-menu-action" onClick={() => { fleet.stop(); setEpoch(value => value + 1); setNotice("Viewing stopped. Open the menu and press Start wall when you're ready."); closeMenu(); }}><Icon name="stop" />Stop all cameras</button>
          <div className="vision-menu-divider" />
          <button className="vision-menu-action" onClick={() => { closeMenu(); setSettingsOpen(true); }}>Settings</button>
          <button className="vision-menu-action" onClick={() => { closeMenu(); setSessionsOpen(true); }}>Manage saved sign-ins</button>
          <label className="vision-menu-toggle"><span>Data Saver</span><input type="checkbox" aria-label="Data Saver" checked={dataSaver} onChange={event => updatePreferences({...preferences, dataSaver:event.target.checked})} /></label>
          <div className="vision-menu-divider" />
          <button className="vision-menu-action" disabled={busy} onClick={reloadApp}><Icon name="reload" />Reload App</button>
          <button className="vision-menu-action" disabled={busy} onClick={() => { closeMenu(); void logout(); }}>Sign out</button>
          <p className="vision-menu-account">{account.username}<span>△ Web</span></p>
        </dialog>
        {settingsOpen ? <VisionSettings preferences={preferences} onChange={updatePreferences} username={account.username}
          onClose={() => setSettingsOpen(false)} onSessions={() => { setSettingsOpen(false); setSessionsOpen(true); }}
          onLogout={() => { setSettingsOpen(false); void logout(); }} /> : null}
        {sessionsOpen ? <SavedSessions onClose={() => setSessionsOpen(false)} onExpired={expired} /> : null}
      </>}
      {error ? <p role="alert" className={account ? "vision-global-error" : "vision-login-error"}>{error}{errorReference ? <small> Reference: {errorReference}</small> : null}<button aria-label="Dismiss message" onClick={() => setError("")}>×</button></p> : null}
    </main>
    {startup ? <VisionStartup ready={!checking && preferencesReady} onComplete={finishStartup} /> : null}
  </>;
}
