import { getCameraHealthUrl } from "./camera-url";

export const HEALTH_TIMEOUT_MS = 4500;

export const HEALTH_FETCH_OPTIONS = {
  method: "GET",
  cache: "no-store",
  credentials: "omit",
} as const;

export type CameraHealthResult = "ok" | "failed" | "cancelled";

export type CameraHealthProbe = {
  promise: Promise<CameraHealthResult>;
  abort: () => void;
};

export type CameraHealthProbeOptions = {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export function createCameraHealthProbe(
  cameraUrl: string,
  options: CameraHealthProbeOptions = {},
): CameraHealthProbe {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? HEALTH_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  let settled = false;
  let timedOut = false;
  let cancelled = false;
  let settle!: (result: CameraHealthResult) => void;

  const promise = new Promise<CameraHealthResult>((resolve) => {
    settle = (result) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutId);
      resolve(result);
    };
  });

  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
    settle("failed");
  }, timeoutMs);

  const healthUrl = getCameraHealthUrl(cameraUrl);
  if (!healthUrl) {
    settle("failed");
  } else {
    void fetchImpl(healthUrl, {
      ...HEALTH_FETCH_OPTIONS,
      signal: controller.signal,
    }).then(
      (response) => {
        if (cancelled && !timedOut) {
          settle("cancelled");
          return;
        }

        settle(response.ok ? "ok" : "failed");
      },
      () => {
        if (cancelled && !timedOut) {
          settle("cancelled");
          return;
        }

        settle("failed");
      },
    );
  }

  return {
    promise,
    abort() {
      cancelled = true;
      controller.abort();
      settle("cancelled");
    },
  };
}
