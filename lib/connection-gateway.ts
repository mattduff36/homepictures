import {
  createCameraHealthProbe,
  type CameraHealthProbe,
} from "./camera-health";

export {
  HEALTH_FETCH_OPTIONS,
  HEALTH_TIMEOUT_MS,
} from "./camera-health";

export const COUNTDOWN_SECONDS = 5;

export type GatewayStatus = "checking" | "connected" | "failed" | "cancelled";

export type GatewaySnapshot = {
  status: GatewayStatus;
  secondsLeft: number;
};

export type GatewayStartOptions = {
  timeoutMs?: number;
  intervalMs?: number;
  fetchImpl?: typeof fetch;
};

const INITIAL_SNAPSHOT: GatewaySnapshot = {
  status: "checking",
  secondsLeft: COUNTDOWN_SECONDS,
};

let snapshot: GatewaySnapshot = { ...INITIAL_SNAPSHOT };
const listeners = new Set<() => void>();
let startedFor: string | null = null;
let countdownId: ReturnType<typeof setInterval> | null = null;
let navigated = false;
let activeProbe: CameraHealthProbe | null = null;

function emit(next: GatewaySnapshot) {
  snapshot = next;
  for (const listener of listeners) {
    listener();
  }
}

function clearCountdown() {
  if (countdownId !== null) {
    clearInterval(countdownId);
    countdownId = null;
  }
}

function beginCountdown(cameraUrl: string, intervalMs: number) {
  emit({ status: "connected", secondsLeft: COUNTDOWN_SECONDS });
  countdownId = setInterval(() => {
    if (startedFor !== cameraUrl || snapshot.status !== "connected") {
      return;
    }

    const next = snapshot.secondsLeft - 1;
    emit({ status: "connected", secondsLeft: Math.max(0, next) });
    if (next <= 0 && countdownId !== null) {
      clearInterval(countdownId);
      countdownId = null;
    }
  }, intervalMs);
}

export function subscribeGateway(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getGatewaySnapshot(): GatewaySnapshot {
  return snapshot;
}

export function getGatewayServerSnapshot(): GatewaySnapshot {
  return INITIAL_SNAPSHOT;
}

export function startGatewayCheck(
  cameraUrl: string,
  options: GatewayStartOptions = {},
): void {
  if (startedFor === cameraUrl) {
    return;
  }

  clearCountdown();
  activeProbe?.abort();

  startedFor = cameraUrl;
  navigated = false;
  emit({ status: "checking", secondsLeft: COUNTDOWN_SECONDS });

  const probe = createCameraHealthProbe(cameraUrl, {
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
  });
  activeProbe = probe;

  void probe.promise.then((result) => {
    if (startedFor !== cameraUrl || snapshot.status !== "checking") {
      return;
    }

    if (result === "ok") {
      beginCountdown(cameraUrl, options.intervalMs ?? 1000);
      return;
    }

    emit({ status: "failed", secondsLeft: 0 });
  });
}

export function cancelGatewayCheck(): void {
  clearCountdown();
  activeProbe?.abort();
  activeProbe = null;
  emit({
    status: "cancelled",
    secondsLeft: snapshot.secondsLeft,
  });
}

export function takeNavigationTarget(cameraUrl: string): string | null {
  if (navigated) {
    return null;
  }

  if (snapshot.status === "cancelled" || snapshot.status === "failed") {
    navigated = true;
    return "/setup";
  }

  if (snapshot.status === "connected" && snapshot.secondsLeft === 0) {
    navigated = true;
    return cameraUrl;
  }

  return null;
}

export function resetGatewayStateForTests(): void {
  clearCountdown();
  activeProbe?.abort();
  activeProbe = null;
  startedFor = null;
  navigated = false;
  snapshot = { ...INITIAL_SNAPSHOT };
  listeners.clear();
}
