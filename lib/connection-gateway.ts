import { getCameraHealthUrl } from "./camera-url";

export const HEALTH_TIMEOUT_MS = 4500;
export const COUNTDOWN_SECONDS = 5;

export const HEALTH_FETCH_OPTIONS = {
  method: "GET",
  cache: "no-store",
  credentials: "omit",
} as const;

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
let controller: AbortController | null = null;
let timeoutId: ReturnType<typeof setTimeout> | null = null;
let countdownId: ReturnType<typeof setInterval> | null = null;
let navigated = false;

function emit(next: GatewaySnapshot) {
  snapshot = next;
  for (const listener of listeners) {
    listener();
  }
}

function clearTimers() {
  if (timeoutId !== null) {
    clearTimeout(timeoutId);
    timeoutId = null;
  }
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

  clearTimers();
  controller?.abort();

  startedFor = cameraUrl;
  navigated = false;
  controller = new AbortController();
  emit({ status: "checking", secondsLeft: COUNTDOWN_SECONDS });

  const healthUrl = getCameraHealthUrl(cameraUrl);
  if (!healthUrl) {
    emit({ status: "failed", secondsLeft: 0 });
    return;
  }

  const timeoutMs = options.timeoutMs ?? HEALTH_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? 1000;
  const fetchImpl = options.fetchImpl ?? fetch;

  timeoutId = setTimeout(() => {
    timeoutId = null;
    controller?.abort();
    if (startedFor === cameraUrl && snapshot.status === "checking") {
      emit({ status: "failed", secondsLeft: 0 });
    }
  }, timeoutMs);

  void fetchImpl(healthUrl, {
    ...HEALTH_FETCH_OPTIONS,
    signal: controller.signal,
  })
    .then((response) => {
      if (startedFor !== cameraUrl || snapshot.status !== "checking") {
        return;
      }

      clearTimers();
      if (response.ok) {
        beginCountdown(cameraUrl, intervalMs);
        return;
      }

      emit({ status: "failed", secondsLeft: 0 });
    })
    .catch(() => {
      if (startedFor !== cameraUrl || snapshot.status !== "checking") {
        return;
      }

      clearTimers();
      emit({ status: "failed", secondsLeft: 0 });
    });
}

export function cancelGatewayCheck(): void {
  clearTimers();
  controller?.abort();
  controller = null;
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
  clearTimers();
  controller?.abort();
  controller = null;
  startedFor = null;
  navigated = false;
  snapshot = { ...INITIAL_SNAPSHOT };
  listeners.clear();
}
