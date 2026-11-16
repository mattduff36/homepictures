import {
  exactFields, isRecord, isSdp, isViewerToken, VIEWER_CAMERA, VIEWER_PLAYBACK_MS,
} from "./viewer-protocol";

export type PlayerStatus = "idle" | "connecting" | "playing" | "stopped" | "error";
export type ViewerDiagnostics = {
  relayVerified: boolean; framesDecoded: number; audioPackets: number; audioBytes: number;
};
export type PlayerState = {
  status: PlayerStatus; message: string; muted: boolean; diagnostics: ViewerDiagnostics;
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
  timing?: { statsMs?: number; startupMs?: number; playbackMs?: number; gatheringMs?: number; sessionMs?: number };
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
  constructor(public status: number, message: string) {
    super(message);
  }
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
    void response.body?.cancel();
    throw new ViewerApiError(response.status, response.status === 401 ? "Please sign in again." :
      response.status === 429 ? "Please wait before trying again." :
        "The camera is unavailable. Please try again.");
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
  private startupTimer?: ReturnType<typeof setTimeout>;
  private limitTimer?: ReturnType<typeof setTimeout>;
  private polling = false;
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
    clearTimeout(this.startupTimer);
    clearTimeout(this.limitTimer);
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
    this.publish({ status, message, muted: true });
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

  async start() {
    this.stop("", "idle");
    const generation = this.generation;
    const current = () => generation === this.generation;
    const abort = new AbortController();
    this.abort = abort;
    this.previousFrames = 0;
    this.lastFrameAt = Date.now();
    this.polling = false;
    this.publish({ status: "connecting", message: "Connecting to Back Garden...", muted: true,
      diagnostics: { ...EMPTY_DIAGNOSTICS } });
    this.startupTimer = setTimeout(() => {
      if (current()) this.stop("No moving picture received. Please retry.", "error");
    }, this.deps.timing?.startupMs ?? 35000);
    this.limitTimer = setTimeout(() => {
      if (current()) this.stop("The 15-minute viewing limit was reached. Press Watch to restart.");
    }, this.deps.timing?.playbackMs ?? VIEWER_PLAYBACK_MS);
    try {
      await this.releasePending;
      if (!current()) return;
      const config = await this.deps.api("config", {}, abort.signal);
      if (!exactFields(config, ["lease", "camera", "expires", "iceServers"]) ||
          !isViewerToken(config.lease) || config.camera !== VIEWER_CAMERA ||
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
      clearTimeout(this.limitTimer);
      this.limitTimer = setTimeout(() => {
        if (current()) this.stop("The 15-minute viewing limit was reached. Press Watch to restart.");
      }, Math.min(remaining, this.deps.timing?.playbackMs ?? VIEWER_PLAYBACK_MS));
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
      const answer = await this.deps.api("offer", { camera: VIEWER_CAMERA, lease: this.lease, sdp }, abort.signal);
      if (!current()) return;
      if (!exactFields(answer, ["type", "sdp"]) || answer.type !== "answer" || !isSdp(answer.sdp)) {
        throw new Error("Connection could not start. Please retry.");
      }
      await peer.setRemoteDescription({ type: "answer", sdp: answer.sdp });
      if (!current()) return;
      this.statsTimer = setInterval(() => { void this.poll(generation, peer); },
        this.deps.timing?.statsMs ?? 1000);
      this.sessionTimer = setInterval(() => {
        void this.checkSession(generation, abort.signal);
      }, this.deps.timing?.sessionMs ?? 60000);
    } catch (error) {
      if (current()) {
        this.stop(error instanceof Error ? error.message : "Please retry.", "error");
        if (error instanceof ViewerApiError && error.status === 401) this.deps.sessionExpired?.();
      }
    }
  }

  private async checkSession(generation: number, signal: AbortSignal) {
    try {
      const session = await this.deps.api("session", {}, signal);
      if (!validSession(session)) throw new Error("Sign-in could not be checked.");
    } catch (error) {
      if (generation === this.generation) {
        this.stop("Sign-in could not be confirmed. Please sign in again or retry.", "error");
        if (error instanceof ViewerApiError && error.status === 401) this.deps.sessionExpired?.();
      }
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
      this.publish({ diagnostics });
      if (playing) {
        clearTimeout(this.startupTimer);
        this.publish({ status: "playing", message: "Playing Back Garden" });
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

export function validSession(value: unknown): value is { username: string } {
  return isRecord(value) && typeof value.username === "string";
}
