import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HEALTH_FETCH_OPTIONS,
  createCameraHealthProbe,
} from "./camera-health";

const cameraUrl = "https://canary-camera.example.ts.net/";
const healthUrl = "https://canary-camera.example.ts.net/healthz";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("PROBE-PARITY-01: success, failure, timeout, cancel, and stale ignore", async () => {
  const success = createCameraHealthProbe(cameraUrl, {
    fetchImpl: async (input, init) => {
      assert.equal(input, healthUrl);
      assert.equal(init?.method, HEALTH_FETCH_OPTIONS.method);
      assert.equal(init?.cache, HEALTH_FETCH_OPTIONS.cache);
      assert.equal(init?.credentials, HEALTH_FETCH_OPTIONS.credentials);
      assert.equal(init?.headers, undefined);
      return new Response(null, { status: 204 });
    },
  });
  assert.equal(await success.promise, "ok");

  const failed = createCameraHealthProbe(cameraUrl, {
    fetchImpl: async () => new Response(null, { status: 500 }),
  });
  assert.equal(await failed.promise, "failed");

  const pendingTimeout = deferred<Response>();
  let timeoutSignal: AbortSignal | undefined;
  const timedOut = createCameraHealthProbe(cameraUrl, {
    timeoutMs: 15,
    fetchImpl: (_input, init) => {
      timeoutSignal = init?.signal ?? undefined;
      timeoutSignal?.addEventListener("abort", () => {
        pendingTimeout.reject(new DOMException("Aborted", "AbortError"));
      });
      return pendingTimeout.promise;
    },
  });
  assert.equal(await timedOut.promise, "failed");
  assert.equal(timeoutSignal?.aborted, true);

  const pendingCancel = deferred<Response>();
  let cancelSignal: AbortSignal | undefined;
  const cancelled = createCameraHealthProbe(cameraUrl, {
    fetchImpl: (_input, init) => {
      cancelSignal = init?.signal ?? undefined;
      return pendingCancel.promise;
    },
  });
  cancelled.abort();
  pendingCancel.reject(new DOMException("Aborted", "AbortError"));
  assert.equal(await cancelled.promise, "cancelled");
  assert.equal(cancelSignal?.aborted, true);

  const stalePending = deferred<Response>();
  const stale = createCameraHealthProbe(cameraUrl, {
    fetchImpl: () => stalePending.promise,
  });
  stale.abort();
  assert.equal(await stale.promise, "cancelled");

  const fresh = createCameraHealthProbe(cameraUrl, {
    fetchImpl: async () => new Response(null, { status: 204 }),
  });
  assert.equal(await fresh.promise, "ok");

  stalePending.resolve(new Response(null, { status: 204 }));
  assert.equal(await stale.promise, "cancelled");
});
