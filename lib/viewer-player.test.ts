import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import {
  fullscreenVideo, summarizeStats, ViewerApiError, ViewerFleet, ViewerPlayer, waitForGathering,
  type PlayerState, type VideoSink, type ViewerPeer,
} from "./viewer-player";
import { VIEWER_CAMERA, VIEWER_CAMERAS, type CameraId } from "./viewer-protocol";
import { buildContentSecurityPolicy, shouldDisableStore } from "./security-headers";

const sdp = "v=0\r\ns=test\r\n";
const lease = "l".repeat(43);
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
function stats(frames: number, relay = true): RTCStatsReport {
  const entries = [
    { id: "transport", type: "transport", timestamp: 1, selectedCandidatePairId: "pair" },
    { id: "pair", type: "candidate-pair", timestamp: 1, localCandidateId: "local", state: "succeeded", nominated: true },
    { id: "local", type: "local-candidate", timestamp: 1, candidateType: relay ? "relay" : "host",
      address: "203.0.113.1", port: 9999 },
    { id: "video", type: "inbound-rtp", timestamp: 1, kind: "video", framesDecoded: frames },
    { id: "audio", type: "inbound-rtp", timestamp: 1, kind: "audio", packetsReceived: 12, bytesReceived: 1200 },
  ];
  return new Map(entries.map((entry) => [entry.id, entry]));
}
class Peer extends EventTarget implements ViewerPeer {
  iceGatheringState: RTCIceGatheringState = "complete";
  connectionState: RTCPeerConnectionState = "new";
  localDescription: { sdp: string } | null = null;
  transceivers: Array<{ kind: string; options: RTCRtpTransceiverInit }> = [];
  remote: RTCSessionDescriptionInit[] = [];
  closed = false;
  frames = 0;
  relay = true;
  override addEventListener<K extends keyof RTCPeerConnectionEventMap>(
    type: K, listener: (event: RTCPeerConnectionEventMap[K]) => void,
  ) { super.addEventListener(type, listener as EventListener); }
  override removeEventListener<K extends keyof RTCPeerConnectionEventMap>(
    type: K, listener: (event: RTCPeerConnectionEventMap[K]) => void,
  ) { super.removeEventListener(type, listener as EventListener); }
  addTransceiver(kind: string, options: RTCRtpTransceiverInit) { this.transceivers.push({ kind, options }); }
  async createOffer() { return { type: "offer" as const, sdp }; }
  async setLocalDescription(description: RTCSessionDescriptionInit) { this.localDescription = { sdp: description.sdp! }; }
  async setRemoteDescription(description: RTCSessionDescriptionInit) { this.remote.push(description); }
  candidates: RTCIceCandidateInit[] = [];
  async addIceCandidate(candidate: RTCIceCandidateInit) { this.candidates.push(candidate); }
  async getStats() { return stats(this.frames, this.relay); }
  close() { this.closed = true; }
}
const players: ViewerPlayer[] = [];
afterEach(() => { for (const player of players.splice(0)) player.stop(); });
function fixture(apiOverride?: (action: string, body: Record<string, unknown>) => Promise<unknown>,
  timing: { statsMs: number; startupMs: number; playbackMs: number; gatheringMs: number; sessionMs?: number } =
    { statsMs: 5, startupMs: 500, playbackMs: 1000, gatheringMs: 20 }) {
  let peer = new Peer();
  const states: PlayerState[] = [];
  const calls: Array<{ action: string; body: Record<string, unknown> }> = [];
  let options: RTCConfiguration | undefined;
  let paused = false;
  let trackStopped = false;
  let expired = false;
  const video: VideoSink = { srcObject: null, muted: false, readyState: 4,
    async play() {}, pause() { paused = true; } };
  const stream = {
    addTrack(_track: MediaStreamTrack) { void _track; },
    getTracks: () => [{ stop() { trackStopped = true; } } as MediaStreamTrack],
  } as MediaStream;
  const player = new ViewerPlayer({
    video: () => video, update: (state) => states.push(state),
    api: async (action, body) => {
      calls.push({ action, body });
      if (apiOverride) return apiOverride(action, body);
      if (action === "config") return { lease, camera: body.camera, expires: Math.floor(Date.now() / 1000) + 900,
        iceServers: [{ urls: ["turn:turn.cloudflare.com:3478"], username: "short", credential: "temporary" }] };
      if (action === "offer") return { type: "answer", sdp };
      if (action === "poll") return { events: [], closed: false };
      return { ok: true };
    },
    peer: (config) => { options = config; if (peer.closed) peer = new Peer(); return peer; },
    stream: () => stream, timing, sessionExpired: () => { expired = true; },
  });
  players.push(player);
  return { player, get peer() { return peer; }, states, calls, video, get options() { return options; },
    get expired() { return expired; }, get paused() { return paused; }, get trackStopped() { return trackStopped; } };
}
async function pause(ms = 15) { await new Promise((resolve) => setTimeout(resolve, ms)); }

test("no connection until explicit Watch; peer is relay-only and audio/video are receive-only", async () => {
  const f = fixture();
  assert.equal(f.calls.length, 0);
  await f.player.start();
  assert.equal(f.options?.iceTransportPolicy, "relay");
  assert.equal(f.options?.bundlePolicy, "max-bundle");
  assert.deepEqual(f.peer.transceivers, [
    { kind: "video", options: { direction: "recvonly" } }, { kind: "audio", options: { direction: "recvonly" } },
  ]);
  assert.equal(f.video.muted, true);
  assert.deepEqual(f.calls[1], { action: "offer", body: { camera: VIEWER_CAMERA, lease, sdp } });
  assert.equal(f.states.at(-1)?.status, "connecting");
});

test("Playing requires advancing decoded frames and a selected relay, not successful signalling", async () => {
  const f = fixture();
  await f.player.start();
  await pause();
  assert.equal(f.states.at(-1)?.status, "connecting");
  f.peer.frames = 3;
  f.peer.relay = false;
  await pause();
  assert.equal(f.states.at(-1)?.status, "connecting");
  f.peer.frames = 6;
  f.peer.relay = true;
  await pause();
  assert.equal(f.states.at(-1)?.status, "playing");
  assert.equal(f.states.at(-1)?.diagnostics.audioPackets, 12);
  await f.player.toggleSound();
  assert.equal(f.video.muted, false);
  await f.player.toggleSound();
  assert.equal(f.video.muted, true);
});

test("Stop closes peer, stops tracks, detaches video, mutes, aborts and releases lease", async () => {
  const f = fixture();
  await f.player.start();
  f.player.stop();
  assert.equal(f.peer.closed, true);
  assert.equal(f.trackStopped, true);
  assert.equal(f.paused, true);
  assert.equal(f.video.srcObject, null);
  assert.equal(f.video.muted, true);
  assert.deepEqual(f.calls.at(-1), { action: "stop", body: { lease } });
  assert.equal(f.states.at(-1)?.status, "stopped");
});

test("late offer response after Stop cannot reattach or resurrect playback", async () => {
  const pending = deferred<unknown>();
  const f = fixture(async (action) => action === "config"
    ? { lease, camera: VIEWER_CAMERA, expires: Date.now() / 1000 + 900, iceServers: [] }
    : action === "offer" ? pending.promise : { ok: true });
  const start = f.player.start();
  await pause(1);
  f.player.stop();
  pending.resolve({ type: "answer", sdp });
  await start;
  assert.deepEqual(f.peer.remote, []);
  assert.equal(f.video.srcObject, null);
  assert.equal(f.states.at(-1)?.status, "stopped");
});

test("late config after hidden/Stop releases its lease without creating a peer", async () => {
  const pending = deferred<unknown>();
  const requested = deferred<void>();
  const f = fixture(async (action) => {
    if (action === "config") { requested.resolve(); return pending.promise; }
    return { ok: true };
  });
  const start = f.player.start();
  await requested.promise;
  f.player.stop("Viewing paused.");
  pending.resolve({ lease, camera: VIEWER_CAMERA, expires: Date.now() / 1000 + 900, iceServers: [] });
  await start;
  assert.equal(f.options, undefined);
  assert.equal(f.calls.at(-1)?.action, "stop");
  assert.equal(f.states.at(-1)?.status, "stopped");
});

test("explicit Retry waits for Stop and ignores an earlier release error", async () => {
  const released = deferred<unknown>();
  const f = fixture(async (action) => {
    if (action === "config") return { lease, camera: VIEWER_CAMERA, expires: Date.now() / 1000 + 900, iceServers: [] };
    if (action === "offer") return { type: "answer", sdp };
    if (action === "poll") return { events: [], closed: false };
    return released.promise;
  });
  await f.player.start();
  const firstPeer = f.peer;
  f.player.stop();
  const retry = f.player.start();
  await Promise.resolve();
  assert.equal(f.calls.filter(({ action }) => action === "config").length, 1);
  released.reject(new Error("lost Stop response"));
  await retry;
  assert.equal(firstPeer.closed, true);
  assert.notEqual(f.peer, firstPeer);
  assert.equal(f.peer.closed, false);
  assert.equal(f.calls.filter(({ action }) => action === "config").length, 2);
  assert.equal(f.states.at(-1)?.message, "Connecting to Back Garden...");
});

test("bounded playback stops automatically without reconnect and requires explicit restart", async () => {
  const f = fixture(undefined, { statsMs: 5, startupMs: 500, playbackMs: 25, gatheringMs: 20 });
  await f.player.start();
  await pause(45);
  assert.equal(f.peer.closed, true);
  assert.equal(f.states.at(-1)?.status, "stopped");
  assert.match(f.states.at(-1)!.message, /15-minute/);
  assert.equal(f.calls.filter(({ action }) => action === "config").length, 1);
});

test("missing decoded frames times out once; retry remains explicit", async () => {
  const f = fixture(undefined, { statsMs: 5, startupMs: 20, playbackMs: 1000, gatheringMs: 20 });
  await f.player.start();
  await pause(40);
  assert.equal(f.states.at(-1)?.status, "error");
  assert.match(f.states.at(-1)!.message, /No moving picture/);
  assert.equal(f.calls.filter(({ action }) => action === "offer").length, 1);
});

test("ICE gathering has a deadline and abort cleanup", async () => {
  const peer = new Peer();
  peer.iceGatheringState = "gathering";
  await assert.rejects(waitForGathering(peer, new AbortController().signal, 5), /timed out/);
  const abort = new AbortController();
  const pending = waitForGathering(peer, abort.signal, 1000);
  abort.abort();
  await assert.rejects(pending, /Stopped/);
});

test("gathering deadline uses an available relay while other transports remain pending", async () => {
  const peer = new Peer();
  peer.iceGatheringState = "gathering";
  peer.localDescription = { sdp: sdp + "a=candidate:1 1 udp 1 1.1.1.1 3478 typ relay\r\n" };
  await waitForGathering(peer, new AbortController().signal, 5);
  peer.localDescription = { sdp: sdp + "a=candidate:1 1 udp 1 1.1.1.1 3478 typ srflx\r\n" };
  await assert.rejects(waitForGathering(peer, new AbortController().signal, 5), /timed out/);
});

test("diagnostic summary never returns addresses, SDP, candidate IDs or credentials", () => {
  const value = summarizeStats(stats(20));
  assert.deepEqual(value, { relayVerified: true, framesDecoded: 20, audioPackets: 12, audioBytes: 1200 });
  assert.doesNotMatch(JSON.stringify(value), /203\.0|9999|local|pair|sdp|credential/i);
});

test("connection failure stops with no retry loop", async () => {
  const f = fixture();
  await f.player.start();
  f.peer.connectionState = "disconnected";
  f.peer.dispatchEvent(new Event("connectionstatechange"));
  assert.equal(f.peer.closed, true);
  assert.equal(f.states.at(-1)?.status, "error");
  await pause();
  assert.equal(f.calls.filter(({ action }) => action === "config").length, 1);
});

test("revocation or unavailable authority during playback stops without repeated authorization attempts", async () => {
  let checks = 0;
  const f = fixture(async (action) => {
    if (action === "config") return { lease, camera: VIEWER_CAMERA, expires: Date.now() / 1000 + 900, iceServers: [] };
    if (action === "offer") return { type: "answer", sdp };
    if (action === "poll") return { events: [], closed: false };
    if (action === "heartbeat") {
      ++checks;
      throw new ViewerApiError(401, "revoked");
    }
    return { ok: true };
  }, { statsMs: 5, startupMs: 500, playbackMs: 1000, gatheringMs: 20, sessionMs: 10 });
  await f.player.start();
  await pause(35);
  assert.equal(f.peer.closed, true);
  assert.equal(checks, 1);
  assert.equal(f.expired, true);
  assert.equal(f.states.at(-1)?.status, "error");
});

test("watch component wires hidden/page-exit/unmount/logout cleanup and requests no capture permissions", () => {
  const component = readFileSync(join(process.cwd(), "components", "camera-viewer.tsx"), "utf8");
  const source = readFileSync(join(process.cwd(), "lib", "viewer-player.ts"), "utf8");
  assert.match(component, /document\.addEventListener\("visibilitychange", visibility\)/);
  assert.match(component, /if \(document\.hidden\) stop\(\)/);
  assert.match(component, /window\.addEventListener\("pagehide", stop\)/);
  assert.match(component, /fleet\.stop\(/);
  assert.match(component, /player\.current\?\.stop\(\)/);
  assert.match(component, /muted autoPlay playsInline/);
  assert.doesNotMatch(source + component, /getUserMedia|getDisplayMedia|new WebSocket|localStorage/);
  assert.equal(shouldDisableStore("/watch"), true);
  assert.match(buildContentSecurityPolicy("nonce", false), /media-src 'self' blob:/);
});

test("five-camera wall creates only five peers; selecting one retains it and stops four", async () => {
  const fleet = new ViewerFleet();
  const fixtures = VIEWER_CAMERAS.filter((camera) => camera.kind === "swann").map((camera) => {
    const f = fixture();
    fleet.register(camera.id, f.player);
    return f;
  });
  const swann = VIEWER_CAMERAS.filter((camera) => camera.kind === "swann");
  await fleet.watch(swann);
  assert.equal(fixtures.filter((f) => !f.peer.closed).length, 5);
  await fleet.watch([swann[0]]);
  assert.equal(fixtures.filter((f) => !f.peer.closed).length, 1);
  assert.equal(fixtures[0].calls.filter((call) => call.action === "offer").length, 1);
  fleet.stop();
  assert.ok(fixtures.every((f) => f.peer.closed));
});

test("fleet keeps only one audio source and rejects mixed Ring walls", async () => {
  const fleet = new ViewerFleet();
  const a = fixture(), b = fixture();
  fleet.register("back-garden", a.player);
  fleet.register("front-door", b.player);
  await fleet.watch([VIEWER_CAMERAS[0], VIEWER_CAMERAS[1]]);
  a.peer.frames = b.peer.frames = 2;
  await pause();
  a.peer.frames = b.peer.frames = 5;
  await pause();
  await fleet.sound("back-garden");
  assert.equal(a.video.muted, false);
  await fleet.sound("front-door");
  assert.equal(a.video.muted, true);
  assert.equal(b.video.muted, false);
  await assert.rejects(fleet.watch([VIEWER_CAMERAS[0], VIEWER_CAMERAS[5]]), /one camera/);
});

test("switching waits for upstream Stop; Stop while waiting cannot start a stale selection", async () => {
  const fleet = new ViewerFleet();
  const release = deferred<unknown>();
  const a = fixture(async (action) => {
    if (action === "config") return { lease, camera: VIEWER_CAMERA, expires: Date.now() / 1000 + 900, iceServers: [] };
    if (action === "offer") return { type: "answer", sdp };
    if (action === "poll") return { events: [], closed: false };
    return release.promise;
  });
  const b = fixture();
  fleet.register("back-garden", a.player);
  fleet.register("front-door", b.player);
  await fleet.watch([VIEWER_CAMERAS[0]]);
  const pending = fleet.watch([VIEWER_CAMERAS[1]]);
  await Promise.resolve();
  assert.equal(b.calls.length, 0);
  fleet.stop();
  release.resolve({ ok: true });
  await pending;
  assert.equal(b.calls.length, 0);
});

test("Ring modes use their own camera and finite lease; candidates are safely polled", async () => {
  const candidate = { candidate: "candidate:1 1 udp 1 1.1.1.1 3478 typ relay", sdpMLineIndex: 0 };
  for (const mode of ["timed", "always"] as const) {
    const f = fixture(async (action, body) => {
      if (action === "config") return { lease, camera: body.camera, expires: Date.now() / 1000 + 0.04, iceServers: [] };
      if (action === "offer") return { type: "answer", sdp };
      if (action === "poll") return { events: [candidate], closed: false };
      return { ok: true };
    });
    await f.player.start("ring-doorbell", mode, "Doorbell");
    assert.deepEqual(f.calls[0].body, { camera: "ring-doorbell", mode });
    assert.deepEqual(f.peer.candidates, [candidate]);
    await pause(70);
    assert.equal(f.peer.closed, true);
    assert.match(f.states.at(-1)!.message, mode === "timed" ? /Snapshot mode/ : /Continue live/);
    assert.equal(f.calls.filter((c) => c.action === "config").length, 1);
  }
});

test("late candidates after Stop never reach a closed peer", async () => {
  const pending = deferred<unknown>();
  const f = fixture(async (action) => {
    if (action === "config") return { lease, camera: VIEWER_CAMERA, expires: Date.now() / 1000 + 900, iceServers: [] };
    if (action === "offer") return { type: "answer", sdp };
    if (action === "poll") return pending.promise;
    return { ok: true };
  });
  const start = f.player.start();
  await pause(1);
  f.player.stop();
  pending.resolve({ events: [{ candidate: "candidate:test", sdpMLineIndex: 0 }], closed: false });
  await start;
  assert.deepEqual(f.peer.candidates, []);
});

test("iPhone native video fullscreen fallback and standard fullscreen are supported", async () => {
  let native = 0, standard = 0;
  await fullscreenVideo({ webkitEnterFullscreen() { ++native; } } as unknown as HTMLVideoElement);
  await fullscreenVideo({ async requestFullscreen() { ++standard; } } as unknown as HTMLVideoElement);
  assert.equal(native, 1);
  assert.equal(standard, 1);
  await assert.rejects(fullscreenVideo({} as HTMLVideoElement), /unavailable/);
});

test("all five Ring tiles default to Snapshot; Data Saver and snapshots never background-poll", () => {
  const component = readFileSync(join(process.cwd(), "components", "camera-viewer.tsx"), "utf8");
  assert.equal(VIEWER_CAMERAS.filter((c) => c.kind === "ring").length, 5);
  assert.match(component, /useState<RingPolicy>\("snapshot"\)/);
  assert.match(component, /dataSaver \? "snapshot" : policy/);
  assert.match(component, /"offline", stop/);
  assert.match(component, /"online", stop/);
  assert.match(component, /generation !== snapshotGeneration\.current \|\| document\.hidden/);
  assert.equal((component.match(/viewerApi\("snapshot"/g) ?? []).length, 1);
  assert.doesNotMatch(component, /setInterval\([^;]*refreshSnapshot/);
  assert.ok(VIEWER_CAMERAS.every((camera) => camera.id !== ("_Gate" as CameraId)));
});
