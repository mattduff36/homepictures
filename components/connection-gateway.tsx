"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  cancelGatewayCheck,
  getGatewayServerSnapshot,
  getGatewaySnapshot,
  startGatewayCheck,
  subscribeGateway,
  takeNavigationTarget,
} from "@/lib/connection-gateway";

export function ConnectionGateway({ cameraUrl, pilotEnabled = false }: { cameraUrl: string; pilotEnabled?: boolean }) {
  const [privateAccess, setPrivateAccess] = useState(!pilotEnabled);
  const state = useSyncExternalStore(
    subscribeGateway,
    getGatewaySnapshot,
    getGatewayServerSnapshot,
  );

  useEffect(() => {
    if (privateAccess) startGatewayCheck(cameraUrl);
  }, [cameraUrl, privateAccess]);

  useEffect(() => {
    const target = privateAccess ? takeNavigationTarget(cameraUrl) : null;
    if (target) {
      window.location.replace(target);
    }
  }, [cameraUrl, privateAccess, state.secondsLeft, state.status]);

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
        {pilotEnabled && !privateAccess ? (
          <>
            <h1 className="text-3xl font-semibold tracking-tight">Home Camera Access</h1>
            <p className="text-mute">Watch your home cameras with your individual camera account. No installation or Tailscale needed.</p>
            <Link className="btn btn-primary mt-2" href="/watch">Watch cameras</Link>
            <button className="btn btn-secondary" onClick={() => setPrivateAccess(true)}>Open existing private cameras</button>
            <Link className="text-sm text-mute underline" href="/setup">Private access setup</Link>
          </>
        ) : null}
        {privateAccess && state.status === "checking" ? (
          <span className="gateway-spinner" aria-hidden="true" />
        ) : null}
        {privateAccess ? <><p className="text-lg font-semibold tracking-tight lg:text-2xl" aria-live="polite">
          {status}
        </p>
        <p className="text-sm leading-relaxed text-mute">
          MPDEE Vision has moved to Dell. Remove the old home-screen shortcut
          or installed app and install again from the new camera page at{" "}
          <a className="underline" href={cameraUrl}>{cameraUrl}</a>.
          Choose Cancel for setup instructions.
        </p></> : null}
      </div>
      {privateAccess ? <div className="setup-sticky-cta mt-8">
        <button type="button" className="btn btn-secondary w-full min-w-32 lg:w-auto" onClick={onCancel}>
          Cancel
        </button>
      </div> : null}
    </main>
  );
}
