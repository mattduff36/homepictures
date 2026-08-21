import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  HEALTH_FETCH_OPTIONS,
  cancelGatewayCheck,
  getGatewaySnapshot,
  resetGatewayStateForTests,
  startGatewayCheck,
  takeNavigationTarget,
} from "./connection-gateway";

const cameraUrl = "https://canary-camera.example.ts.net/";
const healthUrl = "https://canary-camera.example.ts.net/healthz";

afterEach(() => {
  resetGatewayStateForTests();
});

async function waitUntil(predicate: () => boolean, timeoutMs = 500) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("timed out waiting for gateway condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("starts exactly one GET with no-store, omit credentials, and no custom headers", async () => {
  const calls: Array<{ input: unknown; init: RequestInit | undefined }> = [];
  const pending = deferred<Response>();

  startGatewayCheck(cameraUrl, {
    fetchImpl: (input, init) => {
      calls.push({ input, init });
      return pending.promise;
    },
  });
  startGatewayCheck(cameraUrl, {
    fetchImpl: () => {
      throw new Error("second health check must not start");
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.input, healthUrl);
  assert.equal(calls[0]?.init?.method, HEALTH_FETCH_OPTIONS.method);
  assert.equal(calls[0]?.init?.cache, HEALTH_FETCH_OPTIONS.cache);
  assert.equal(calls[0]?.init?.credentials, HEALTH_FETCH_OPTIONS.credentials);
  assert.equal(calls[0]?.init?.headers, undefined);
  assert.ok(calls[0]?.init?.signal);

  pending.resolve(new Response(null, { status: 204 }));
  await pending.promise;
  await Promise.resolve();
});

test("timeout aborts the outstanding health request and routes to setup", async () => {
  const pending = deferred<Response>();
  let signal: AbortSignal | undefined;

  startGatewayCheck(cameraUrl, {
    timeoutMs: 15,
    fetchImpl: (_input, init) => {
      signal = init?.signal ?? undefined;
      signal?.addEventListener("abort", () => {
        pending.reject(new DOMException("Aborted", "AbortError"));
      });
      return pending.promise;
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(signal?.aborted, true);
  assert.equal(getGatewaySnapshot().status, "failed");
  assert.equal(takeNavigationTarget(cameraUrl), "/setup");
  assert.equal(takeNavigationTarget(cameraUrl), null);
});

test("successful health starts a countdown then opens the camera URL once", async () => {
  startGatewayCheck(cameraUrl, {
    intervalMs: 10,
    fetchImpl: async () => new Response(null, { status: 204 }),
  });

  await waitUntil(() => getGatewaySnapshot().status === "connected");
  assert.ok(getGatewaySnapshot().secondsLeft > 0);
  assert.equal(takeNavigationTarget(cameraUrl), null);

  await waitUntil(
    () =>
      getGatewaySnapshot().status === "connected" &&
      getGatewaySnapshot().secondsLeft === 0,
  );
  assert.equal(takeNavigationTarget(cameraUrl), cameraUrl);
  assert.equal(takeNavigationTarget(cameraUrl), null);
});

test("cancel during the check aborts fetch and suppresses a later failure redirect", async () => {
  const pending = deferred<Response>();
  let signal: AbortSignal | undefined;

  startGatewayCheck(cameraUrl, {
    fetchImpl: (_input, init) => {
      signal = init?.signal ?? undefined;
      return pending.promise;
    },
  });

  cancelGatewayCheck();
  pending.reject(new DOMException("Aborted", "AbortError"));
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(signal?.aborted, true);
  assert.equal(getGatewaySnapshot().status, "cancelled");
  assert.equal(takeNavigationTarget(cameraUrl), "/setup");
});

test("cancel during countdown prevents the camera redirect", async () => {
  startGatewayCheck(cameraUrl, {
    intervalMs: 20,
    fetchImpl: async () => new Response(null, { status: 204 }),
  });

  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(getGatewaySnapshot().status, "connected");

  cancelGatewayCheck();
  await new Promise((resolve) => setTimeout(resolve, 40));

  assert.equal(getGatewaySnapshot().status, "cancelled");
  assert.equal(takeNavigationTarget(cameraUrl), "/setup");
});
