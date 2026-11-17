import {
  exactFields, isLiveMode, isSdp, isViewerToken, validCameras, validPoll, VIEWER_CAMERA, VIEWER_PLAYBACK_MS,
  VIEWER_FAILURE_MESSAGES, isViewerFailureCode, type ViewerFailureCode,
  type CameraId, type LiveMode, type ViewerCamera,
} from "./viewer-protocol";

export type PlayerStatus = "idle" | "connecting" | "playing" | "stopped" | "error";
export type ViewerDiagnostics = {
  relayVerified: boolean; framesDecoded: number; audioPackets: number; audioBytes: number;
};
export type PlayerState = {
  status: PlayerStatus; message: string; muted: boolean; diagnostics: ViewerDiagnostics;
  expiresAt?: number | null;
  remainingSeconds?: number | null;
};
export type VideoSink = {
  srcObject: MediaProvider | null; muted: boolean; readyState: number;
  play(): Promise<void>; pause(): void;
};
type PlayerDependencies = {
  video: () => VideoSink | null;
  update: (state: PlayerState) => void;
  api: (action: string, body: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>;
  peer?: (config: RTCConfiguration) => ViewerPeer;
  stream?: () => MediaStream;
  sessionExpired?: () => void;
  timing?: { statsMs?: number; startupMs?: number; playbackMs?: number; gatheringMs?: number;
    sessionMs?: number; signallingMs?: number; authorityMs?: number };
};
export interface ViewerPeer {
  iceGatheringState: RTCIceGatheringState;
  connectionState: RTCPeerConnectionState;
  localDescription: { sdp: string } | null;
  addEventListener<K extends keyof RTCPeerConnectionEventMap>(
    type: K, listener: (event: RTCPeerConnectionEventMap[K]) => void,
  ): void;
  removeEventListener<K extends keyof RTCPeerConnectionEventMap>(
    type: K, listener: (event: RTCPeerConnectionEventMap[K]) => void,
  ): void;
  addTransceiver(kind: string, options: RTCRtpTransceiverInit): unknown;
  createOffer(): Promise<RTCSessionDescriptionInit>;
  setLocalDescription(description: RTCSessionDescriptionInit): Promise<void>;
  setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void>;
  addIceCandidate(candidate: RTCIceCandidateInit): Promise<void>;
  getStats(): Promise<RTCStatsReport>;
  close(): void;
}
const EMPTY_DIAGNOSTICS: ViewerDiagnostics = {
  relayVerified: false, framesDecoded: 0, audioPackets: 0, audioBytes: 0,
};
export const INITIAL_PLAYER_STATE: PlayerState = {
  status: "idle", message: "Ready when you are.", muted: true, diagnostics: EMPTY_DIAGNOSTICS,
};

export class ViewerApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

function transientGatewayFailure(error: unknown) {
  return error instanceof ViewerApiError && error.status >= 500 ||
    error instanceof TypeError || error instanceof DOMException && error.name === "TimeoutError";
}

export async function viewerApi(
  action: string, body: Record<string, unknown> = {}, signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetch(`/api/viewer/${action}`, {
    method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
    keepalive: action === "stop" || action === "logout",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => null);
    const code: ViewerFailureCode | undefined = isViewerFailureCode(failure?.code) ? failure.code : undefined;
    throw new ViewerApiError(response.status, code ? VIEWER_FAILURE_MESSAGES[code] : response.status === 401
      ? action === "login" ? "The username or password was not accepted. Please check and try again."
        : "Your sign-in has expired or was revoked. Please sign in again."
      : response.status === 429 ? "The viewing service has reached a limit. Please wait before retrying."
      : response.status >= 500 ? action === "snapshot" ? "Snapshot unavailable. Refresh to retry."
        : "The camera gateway is temporarily unavailable. Please retry."
      : "This camera connection is no longer available. Please retry.", code);
  }
  return response.json() as Promise<unknown>;
}

export function waitForGathering(peer: ViewerPeer, signal: AbortSignal, timeoutMs = 12000) {
  return new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      peer.removeEventListener("icegatheringstatechange", change);
      signal.removeEventListener("abort", abort);
      if (error) reject(error); else resolve();
    };
    const change = () => {
      if (peer.iceGatheringState === "complete") finish();
    };
    const abort = () => finish(new Error("Stopped"));
    // Optional TURN transports can remain pending after usable relay candidates arrive.
    // This exchange is non-trickle: send the bounded gathered offer at the deadline.
    const timer = setTimeout(() => {
      const hasRelay = /^a=candidate:.* typ relay(?: |\r?$)/m.test(peer.localDescription?.sdp ?? "");
      finish(hasRelay ? undefined : new Error("Connection timed out. Please retry."));
    }, timeoutMs);
    peer.addEventListener("icegatheringstatechange", change);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort(); else change();
  });
}

export function summarizeStats(report: RTCStatsReport): ViewerDiagnostics {
  let selected: string | undefined;
  report.forEach((entry) => {
    if (entry.type === "transport" && typeof entry.selectedCandidatePairId === "string") {
      selected = entry.selectedCandidatePairId;
    }
  });
  let relayVerified = false;
  let framesDecoded = 0;
  let audioPackets = 0;
  let audioBytes = 0;
  report.forEach((entry) => {
    if (entry.type === "candidate-pair" &&
        (entry.id === selected || (!selected && entry.nominated && entry.state === "succeeded"))) {
      const local = report.get(entry.localCandidateId);
      relayVerified = local?.candidateType === "relay";
    }
    if (entry.type === "inbound-rtp" && !entry.isRemote) {
      if (entry.kind === "video" || entry.mediaType === "video") framesDecoded += entry.framesDecoded ?? 0;
      if (entry.kind === "audio" || entry.mediaType === "audio") {
        audioPackets += entry.packetsReceived ?? 0;
        audioBytes += entry.bytesReceived ?? 0;
      }
    }
  });
  return { relayVerified, framesDecoded, audioPackets, audioBytes };
}

export class ViewerPlayer {
  private generation = 0;
  private peer: ViewerPeer | null = null;
  private stream: MediaStream | null = null;
  private abort: AbortController | null = null;
  private lease: string | null = null;
  private statsTimer?: ReturnType<typeof setInterval>;
  private sessionTimer?: ReturnType<typeof setInterval>;
  private signallingTimer?: ReturnType<typeof setInterval>;
  private startupTimer?: ReturnType<typeof setTimeout>;
  private limitTimer?: ReturnType<typeof setTimeout>;
  private authorityTimer?: ReturnType<typeof setTimeout>;
  private polling = false;
  private signalling = false;
  private heartbeating = false;
  private label = "Back Garden";
  private previousFrames = 0;
  private lastFrameAt = 0;
  private releasePending: Promise<void> = Promise.resolve();
  private state: PlayerState = INITIAL_PLAYER_STATE;

  constructor(private deps: PlayerDependencies) {}

  private publish(patch: Partial<PlayerState>) {
    this.state = { ...this.state, ...patch };
    this.deps.update(this.state);
  }

  stop(message = "Stopped. Press Watch to start again.", status: PlayerStatus = "stopped") {
    ++this.generation;
    this.abort?.abort();
    this.abort = null;
    clearInterval(this.statsTimer);
    clearInterval(this.sessionTimer);
    clearInterval(this.signallingTimer);
    clearTimeout(this.startupTimer);
    clearTimeout(this.limitTimer);
    clearTimeout(this.authorityTimer);
    this.peer?.close();
    this.peer = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    const video = this.deps.video();
    if (video) {
      video.muted = true;
      video.pause();
      video.srcObject = null;
    }
    const lease = this.lease;
    this.lease = null;
    if (lease) this.releasePending = this.release(lease);
    this.publish({ status, message, muted: true, expiresAt: null, remainingSeconds: null });
  }

  private async release(lease: string, generation = this.generation) {
    try {
      await this.deps.api("stop", { lease });
    } catch {
      // Local media is already closed; an unavailable authority retains the lease until expiry.
      if (generation === this.generation) {
        this.publish({ message: `${this.state.message} The server could not confirm Stop.` });
      }
    }
  }

  get status() {
    return this.state.status;
  }
  get active() {
    return this.state.status === "playing" || this.state.status === "connecting";
  }
  waitForRelease() {
    return this.releasePending;
  }

  mute() {
    const video = this.deps.video();
    if (video) video.muted = true;
    this.publish({ muted: true });
  }

  async start(camera: CameraId = VIEWER_CAMERA, mode: LiveMode = "live", label = "Back Garden") {
    if (!isLiveMode(camera, mode)) throw new Error("Ring live requires fullscreen and explicit Play.");
    this.stop("", "idle");
    const generation = this.generation;
    const current = () => generation === this.generation;
    const abort = new AbortController();
    this.abort = abort;
    this.previousFrames = 0;
    this.lastFrameAt = Date.now();
    this.polling = false;
    this.signalling = false;
    this.heartbeating = false;
    this.label = label;
    const limitMessage = camera.startsWith("ring-")
      ? "Live View ended after five minutes. Press Play in fullscreen to start again."
      : "The 15-minute viewing limit was reached. Press Play or Start wall to restart.";
    const playbackMs = Math.min(this.deps.timing?.playbackMs ?? VIEWER_PLAYBACK_MS,
      camera.startsWith("ring-") ? 300000 : VIEWER_PLAYBACK_MS);
    this.publish({ status: "connecting", message: `Connecting to ${label}...`, muted: true,
      diagnostics: { ...EMPTY_DIAGNOSTICS } });
    this.startupTimer = setTimeout(() => {
      if (current()) this.stop("No moving picture received. Please retry.", "error");
    }, this.deps.timing?.startupMs ?? 35000);
    this.limitTimer = setTimeout(() => {
      if (current()) this.stop(limitMessage);
    }, playbackMs);
    try {
      await this.releasePending;
      if (!current()) return;
      const config = await this.deps.api("config", { camera, mode }, abort.signal);
      if (!exactFields(config, ["lease", "camera", "expires", "iceServers"]) ||
          !isViewerToken(config.lease) || config.camera !== camera ||
          !Array.isArray(config.iceServers) || typeof config.expires !== "number") {
        throw new Error("The camera is unavailable. Please retry.");
      }
      if (!current()) {
        await this.release(config.lease, generation);
        return;
      }
      this.lease = config.lease;
      const remaining = config.expires * 1000 - Date.now();
      if (remaining <= 0) throw new Error("Please retry.");
      this.publish({ expiresAt: Math.min(config.expires * 1000, Date.now() + playbackMs), remainingSeconds: Math.ceil(remaining / 1000) });
      clearTimeout(this.limitTimer);
      this.limitTimer = setTimeout(() => {
        if (current()) this.stop(limitMessage);
      }, Math.min(remaining, playbackMs));
      const peer = (this.deps.peer ?? ((options) => new RTCPeerConnection(options)))({
        iceServers: config.iceServers, iceTransportPolicy: "relay", bundlePolicy: "max-bundle",
      });
      this.peer = peer;
      const stream = (this.deps.stream ?? (() => new MediaStream()))();
      this.stream = stream;
      const video = this.deps.video();
      if (!video) throw new Error("Video is unavailable. Please retry.");
      video.muted = true;
      video.srcObject = stream;
      peer.addEventListener("track", (event) => {
        if (!current()) {
          event.track.stop();
          return;
        }
        stream.addTrack(event.track);
        void video.play().catch(() => {
          if (current()) this.stop("Playback could not start. Please retry.", "error");
        });
      });
      peer.addEventListener("connectionstatechange", () => {
        if (current() && ["failed", "disconnected", "closed"].includes(peer.connectionState)) {
          this.stop("The connection was interrupted. Please retry.", "error");
        }
      });
      peer.addTransceiver("video", { direction: "recvonly" });
      peer.addTransceiver("audio", { direction: "recvonly" });
      const offer = await peer.createOffer();
      if (!current()) return;
      await peer.setLocalDescription(offer);
      if (!current()) return;
      await waitForGathering(peer, abort.signal, this.deps.timing?.gatheringMs ?? 12000);
      if (!current()) return;
      const sdp = peer.localDescription?.sdp;
      if (!isSdp(sdp)) throw new Error("Connection could not start. Please retry.");
      const answer = await this.deps.api("offer", { camera, lease: this.lease, sdp }, abort.signal);
      if (!current()) return;
      if (!exactFields(answer, ["type", "sdp"]) || answer.type !== "answer" || !isSdp(answer.sdp)) {
        throw new Error("Connection could not start. Please retry.");
      }
      await peer.setRemoteDescription({ type: "answer", sdp: answer.sdp });
      if (!current()) return;
      this.confirmAuthority(generation);
      this.statsTimer = setInterval(() => { void this.poll(generation, peer); },
        this.deps.timing?.statsMs ?? 1000);
      this.sessionTimer = setInterval(() => {
        void this.heartbeat(generation, abort.signal);
      }, this.deps.timing?.sessionMs ?? 15000);
      this.signallingTimer = setInterval(() => {
        void this.signals(generation, peer, abort.signal);
      }, this.deps.timing?.signallingMs ?? 1000);
      await this.signals(generation, peer, abort.signal);
    } catch (error) {
      if (current()) {
        this.stop(error instanceof Error ? error.message : "Please retry.", "error");
        if (error instanceof ViewerApiError && error.status === 401) this.deps.sessionExpired?.();
      }
    }
  }

  private confirmAuthority(generation: number) {
    clearTimeout(this.authorityTimer);
    this.authorityTimer = setTimeout(() => {
      if (generation === this.generation) {
        this.stop("The camera gateway could not confirm this session within 45 seconds. Please retry.", "error");
      }
    }, Math.min(this.deps.timing?.authorityMs ?? 45000, 45000));
  }

  private async heartbeat(generation: number, signal: AbortSignal) {
    if (this.heartbeating || generation !== this.generation) return;
    this.heartbeating = true;
    try {
      const value = await this.deps.api("heartbeat", { lease: this.lease }, signal);
      if (generation !== this.generation) return;
      if (!exactFields(value, ["ok"]) || value.ok !== true) throw new Error("Sign-in could not be checked.");
      this.confirmAuthority(generation);
    } catch (error) {
      if (generation === this.generation) {
        // Keep the existing peer only within the gateway's unchanged 45-second authority deadline.
        // Revocation and invalid responses still stop immediately; no new stream is started.
        if (transientGatewayFailure(error)) return;
        this.stop(error instanceof Error ? error.message : "Sign-in could not be confirmed. Please retry.", "error");
        if (error instanceof ViewerApiError && error.status === 401) this.deps.sessionExpired?.();
      }
    } finally {
      if (generation === this.generation) this.heartbeating = false;
    }
  }

  private async signals(generation: number, peer: ViewerPeer, signal: AbortSignal) {
    if (this.signalling || generation !== this.generation) return;
    this.signalling = true;
    try {
      const value = await this.deps.api("poll", { lease: this.lease }, signal);
      if (generation !== this.generation) return;
      if (!validPoll(value) || value.closed) throw new Error("The camera connection ended. Please retry.");
      for (const event of value.events) {
        if (generation !== this.generation) return;
        await peer.addIceCandidate(event);
      }
    } catch (error) {
      if (generation === this.generation) {
        // A setup poll may still be in flight when decoded video stops further polls.
        // Keep an established peer on a transient failure under the heartbeat deadline.
        if (this.state.status === "playing" && transientGatewayFailure(error)) return;
        this.stop(error instanceof Error ? error.message : "The camera connection ended. Please retry.", "error");
        if (error instanceof ViewerApiError && error.status === 401) this.deps.sessionExpired?.();
      }
    } finally {
      if (generation === this.generation) this.signalling = false;
    }
  }

  private async poll(generation: number, peer: ViewerPeer) {
    if (this.polling || generation !== this.generation) return;
    this.polling = true;
    try {
      const diagnostics = summarizeStats(await peer.getStats());
      if (generation !== this.generation) return;
      const progressing = diagnostics.framesDecoded > this.previousFrames;
      if (progressing) this.lastFrameAt = Date.now();
      const playing = progressing && this.previousFrames > 0 && diagnostics.relayVerified &&
        (this.deps.video()?.readyState ?? 0) >= 2;
      this.previousFrames = diagnostics.framesDecoded;
      this.publish({ diagnostics, remainingSeconds: this.state.expiresAt
        ? Math.max(0, Math.ceil((this.state.expiresAt - Date.now()) / 1000)) : null });
      if (playing) {
        clearTimeout(this.startupTimer);
        // Remote candidates are needed during setup. A healthy selected relay needs only heartbeats.
        clearInterval(this.signallingTimer);
        this.publish({ status: "playing", message: `LIVE - ${this.label}` });
      } else if (this.state.status === "playing" && Date.now() - this.lastFrameAt > 8000) {
        this.stop("The picture stopped updating. Please retry.", "error");
      }
    } catch {
      if (generation === this.generation) this.stop("The connection could not be checked. Please retry.", "error");
    } finally {
      if (generation === this.generation) this.polling = false;
    }
  }

  async toggleSound() {
    const generation = this.generation;
    const video = this.deps.video();
    if (!video || this.state.status !== "playing") return;
    video.muted = !video.muted;
    this.publish({ muted: video.muted });
    try {
      await video.play();
    } catch {
      if (generation !== this.generation) return;
      video.muted = true;
      this.publish({ muted: true, message: "Sound could not start. Tap Sound on to retry." });
    }
  }
}

export function validSession(value: unknown): value is { username: string; cameras: ViewerCamera[]; expires: number } {
  return exactFields(value, ["username", "cameras", "expires"]) &&
    typeof value.username === "string" && validCameras(value.cameras) &&
    typeof value.expires === "number" && value.expires > Date.now() / 1000;
}

export class ViewerFleet {
  private players = new Map<CameraId, ViewerPlayer>();
  private generation = 0;
  private fullscreenRing: CameraId | null = null;
  register(camera: CameraId, player: ViewerPlayer) {
    this.players.get(camera)?.stop();
    this.players.set(camera, player);
    return () => {
      player.stop();
      if (this.players.get(camera) === player) this.players.delete(camera);
    };
  }
  stop(message?: string) {
    ++this.generation;
    this.fullscreenRing = null;
    for (const player of this.players.values()) player.stop(message);
  }
  retain(camera: CameraId) {
    ++this.generation;
    if (this.fullscreenRing !== camera) this.fullscreenRing = null;
    for (const [id, player] of this.players) if (id !== camera) player.stop();
  }
  async watch(cameras: ViewerCamera[], mode: LiveMode = "live") {
    if (cameras.some((camera) => camera.kind === "ring")) {
      throw new Error("Choose one camera in fullscreen and press Play for Ring Live View.");
    }
    return this.watchCameras(cameras, mode);
  }
  enterRingFullscreen(camera: CameraId) {
    if (!camera.startsWith("ring-")) throw new Error("Choose a Ring camera.");
    this.stop();
    this.fullscreenRing = camera;
  }
  leaveRingFullscreen(camera: CameraId) {
    if (this.fullscreenRing !== camera) return;
    this.stop("Fullscreen closed. Ring returned to snapshots.");
  }
  async playRingFullscreen(camera: ViewerCamera) {
    if (camera.kind !== "ring" || this.fullscreenRing !== camera.id) {
      throw new Error("Open this Ring camera fullscreen, then press Play.");
    }
    return this.watchCameras([camera], "manual");
  }
  private async watchCameras(cameras: ViewerCamera[], mode: LiveMode) {
    if (!cameras.length || cameras.length > 5 || new Set(cameras.map((c) => c.id)).size !== cameras.length ||
        (cameras.some((c) => c.kind === "ring") && cameras.length !== 1)) {
      throw new Error("Choose one camera or the Swann wall.");
    }
    const generation = ++this.generation;
    const wanted = new Set(cameras.map((c) => c.id));
    for (const [id, player] of this.players) if (!wanted.has(id)) player.stop();
    await Promise.all([...this.players.values()].map((player) => player.waitForRelease()));
    if (generation !== this.generation) return;
    await Promise.all(cameras.map((camera) => {
      const player = this.players.get(camera.id);
      return player?.active ? undefined : player?.start(camera.id, mode, camera.label);
    }));
    return cameras.filter((camera) => this.players.get(camera.id)?.status === "error").map((camera) => camera.label);
  }
  async sound(camera: CameraId) {
    for (const [id, player] of this.players) if (id !== camera) player.mute();
    await this.players.get(camera)?.toggleSound();
  }
}

export async function fullscreenVideo(video: HTMLVideoElement) {
  const ios = video as HTMLVideoElement & { webkitEnterFullscreen?: () => void };
  if (typeof ios.webkitEnterFullscreen === "function") {
    ios.webkitEnterFullscreen();
  } else if (video.requestFullscreen) {
    await video.requestFullscreen();
  } else {
    throw new Error("Fullscreen is unavailable in this browser.");
  }
}
