"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  cancelGatewayCheck,
  getGatewayServerSnapshot,
  getGatewaySnapshot,
  startGatewayCheck,
  subscribeGateway,
  takeNavigationTarget,
} from "@/lib/connection-gateway";

export function ConnectionGateway({ cameraUrl }: { cameraUrl: string }) {
  const state = useSyncExternalStore(
    subscribeGateway,
    getGatewaySnapshot,
    getGatewayServerSnapshot,
  );

  useEffect(() => {
    startGatewayCheck(cameraUrl);
  }, [cameraUrl]);

  useEffect(() => {
    const target = takeNavigationTarget(cameraUrl);
    if (target) {
      window.location.replace(target);
    }
  }, [cameraUrl, state.secondsLeft, state.status]);

  const connected = state.status === "connected";
  const seconds = Math.max(state.secondsLeft, 1);
  const status = connected
    ? `Connected. Opening CCTV in ${seconds} second${seconds === 1 ? "" : "s"}…`
    : "Attempting to connect to your CCTV system";

  function onCancel() {
    cancelGatewayCheck();
    window.location.replace("/setup");
  }

  return (
    <main className="page-shell mx-auto flex min-h-[100dvh] w-full flex-col items-center justify-center px-[max(1.25rem,env(safe-area-inset-left))] py-[max(2rem,env(safe-area-inset-bottom))] pr-[max(1.25rem,env(safe-area-inset-right))] text-center">
      <div className="flex max-w-2xl flex-col items-center gap-4">
        {state.status === "checking" ? (
          <span className="gateway-spinner" aria-hidden="true" />
        ) : null}
        <p className="text-lg font-semibold tracking-tight lg:text-2xl" aria-live="polite">
          {status}
        </p>
      </div>
      <div className="setup-sticky-cta mt-8">
        <button type="button" className="btn btn-secondary w-full min-w-32 lg:w-auto" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </main>
  );
}
