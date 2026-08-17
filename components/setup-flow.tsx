"use client";

import { useState, useSyncExternalStore } from "react";
import { AndroidLogo } from "@phosphor-icons/react/dist/csr/AndroidLogo";
import { AppleLogo } from "@phosphor-icons/react/dist/csr/AppleLogo";
import { CaretDown } from "@phosphor-icons/react/dist/csr/CaretDown";
import { Check } from "@phosphor-icons/react/dist/csr/Check";
import { LinuxLogo } from "@phosphor-icons/react/dist/csr/LinuxLogo";
import { LockSimple } from "@phosphor-icons/react/dist/csr/LockSimple";
import { ShieldCheck } from "@phosphor-icons/react/dist/csr/ShieldCheck";
import { WindowsLogo } from "@phosphor-icons/react/dist/csr/WindowsLogo";
import { PROGRESS_STORAGE_KEY } from "@/lib/constants";
import {
  detectPlatform,
  PLATFORM_ORDER,
  TAILSCALE_DOWNLOADS,
} from "@/lib/platforms";

type Progress = {
  tailscaleInstalled: boolean;
  tailscaleSignedIn: boolean;
  cameraAccessAccepted: boolean;
  cameraOpened: boolean;
};

const DEFAULT_PROGRESS: Progress = {
  tailscaleInstalled: false,
  tailscaleSignedIn: false,
  cameraAccessAccepted: false,
  cameraOpened: false,
};

const PLATFORM_ICONS = {
  windows: WindowsLogo,
  macos: AppleLogo,
  ios: AppleLogo,
  android: AndroidLogo,
  linux: LinuxLogo,
} as const;

function readProgress(): Progress {
  try {
    const raw = localStorage.getItem(PROGRESS_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_PROGRESS;
    }

    const parsed = JSON.parse(raw) as Partial<Progress> & { v?: number };
    if (parsed.v !== 1) {
      return DEFAULT_PROGRESS;
    }

    return {
      tailscaleInstalled: Boolean(parsed.tailscaleInstalled),
      tailscaleSignedIn: Boolean(parsed.tailscaleSignedIn),
      cameraAccessAccepted: Boolean(parsed.cameraAccessAccepted),
      cameraOpened: Boolean(parsed.cameraOpened),
    };
  } catch {
    return DEFAULT_PROGRESS;
  }
}

function writeProgress(progress: Progress) {
  localStorage.setItem(
    PROGRESS_STORAGE_KEY,
    JSON.stringify({ v: 1, ...progress }),
  );
}

function useIsClient() {
  return useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
}

function scrollToId(id: string) {
  const reduce =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.getElementById(id)?.scrollIntoView({
    behavior: reduce ? "auto" : "smooth",
    block: "start",
  });
}

function Step({
  id,
  number,
  title,
  complete,
  children,
}: {
  id: string;
  number: number;
  title: string;
  complete: boolean;
  children: React.ReactNode;
}) {
  return (
    <li id={id} className="panel scroll-mt-24 p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="step-index mt-0.5" data-complete={complete}>
          {complete ? <Check size={14} weight="regular" aria-hidden="true" /> : number}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold tracking-tight">
            {number}. {title}
          </h2>
          <div className="mt-3 space-y-4 text-[0.95rem] leading-relaxed text-mute">
            {children}
          </div>
        </div>
      </div>
    </li>
  );
}

function Disclosure({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <details className="disclosure rounded-[var(--radius)] border border-line bg-panel-2">
      <summary className="flex min-h-12 items-center justify-between gap-3 px-4 py-3 text-ink">
        <span className="font-medium">{title}</span>
        <CaretDown size={16} weight="regular" aria-hidden="true" />
      </summary>
      <div className="border-t border-line px-4 py-3 text-sm leading-relaxed text-mute">
        {children}
      </div>
    </details>
  );
}

export function SetupFlow({
  cameraUrl,
  shareUrl,
}: {
  cameraUrl: string;
  shareUrl: string;
}) {
  const isClient = useIsClient();
  const [progress, setProgress] = useState<Progress>(DEFAULT_PROGRESS);
  const [storageLoaded, setStorageLoaded] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);
  const [locking, setLocking] = useState(false);
  const recommended = isClient ? detectPlatform() : null;

  if (isClient && !storageLoaded) {
    setStorageLoaded(true);
    setProgress(readProgress());
  }

  const camerasReady =
    progress.tailscaleInstalled &&
    progress.tailscaleSignedIn &&
    progress.cameraAccessAccepted;

  function update(partial: Partial<Progress>) {
    setProgress((current) => {
      const next = { ...current, ...partial };
      writeProgress(next);
      return next;
    });
  }

  async function lockSetupPage() {
    setLocking(true);
    setLockError(null);

    try {
      const response = await fetch("/api/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });

      if (!response.ok) {
        setLockError("Unable to lock the setup page. Try again.");
        return;
      }

      window.location.replace("/");
    } catch {
      setLockError("Unable to lock the setup page. Check your connection and try again.");
    } finally {
      setLocking(false);
    }
  }

  function openCameras() {
    update({ cameraOpened: true });
    window.location.assign(cameraUrl);
  }

  function resetProgress() {
    setProgress(DEFAULT_PROGRESS);
    localStorage.removeItem(PROGRESS_STORAGE_KEY);
  }

  return (
    <div className="min-h-[100dvh] pb-[max(6rem,calc(env(safe-area-inset-bottom)+5.5rem))] md:pb-[max(2rem,env(safe-area-inset-bottom))]">
      <header className="border-b border-line">
        <div className="mx-auto flex w-full max-w-2xl flex-col items-start justify-between gap-4 px-[max(1.25rem,env(safe-area-inset-left))] pt-[max(1.25rem,env(safe-area-inset-top))] pr-[max(1.25rem,env(safe-area-inset-right))] pb-5 sm:flex-row">
          <div>
            <h1 className="text-[1.65rem] font-semibold tracking-tight">
              Home Camera Access
            </h1>
            <p className="mt-2 max-w-prose text-mute">
              Secure private access to the home camera system.
            </p>
            <p className="mt-3 inline-flex items-center gap-2 text-sm text-secure-soft">
              <ShieldCheck size={16} weight="regular" aria-hidden="true" />
              Private connection via Tailscale
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost shrink-0 px-3 text-sm"
            onClick={lockSetupPage}
            disabled={locking}
            aria-busy={locking}
          >
            <LockSimple size={16} weight="regular" aria-hidden="true" />
            Lock Setup Page
          </button>
        </div>
        {lockError ? (
          <p className="mx-auto max-w-2xl px-5 pb-4 text-sm text-danger" role="alert">
            {lockError}
          </p>
        ) : null}
      </header>

      <main className="mx-auto w-full max-w-2xl px-[max(1.25rem,env(safe-area-inset-left))] pr-[max(1.25rem,env(safe-area-inset-right))] pt-6">
        <ol className="space-y-4">
          <Step
            id="step-1"
            number={1}
            title="Install Tailscale"
            complete={progress.tailscaleInstalled}
          >
            <p>
              Tailscale creates the secure private connection required to access
              the cameras. The cameras are not exposed directly to the internet.
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {PLATFORM_ORDER.map((id) => {
                const platform = TAILSCALE_DOWNLOADS[id];
                const Icon = PLATFORM_ICONS[id];
                const isRecommended = recommended === id;

                return (
                  <a
                    key={id}
                    className="btn btn-platform"
                    href={platform.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-recommended={isRecommended}
                  >
                    <Icon size={18} weight="regular" aria-hidden="true" />
                    <span>
                      {platform.label}
                      {isRecommended ? (
                        <span className="mt-0.5 block text-xs font-medium text-secure-soft">
                          Recommended for this device
                        </span>
                      ) : null}
                    </span>
                  </a>
                );
              })}
            </div>
            <button
              type="button"
              className="text-left font-medium text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
              onClick={() => {
                update({ tailscaleInstalled: true });
                scrollToId("step-2");
              }}
            >
              Already have Tailscale? Continue to Step 2.
            </button>
          </Step>

          <Step
            id="step-2"
            number={2}
            title="Sign in to Tailscale"
            complete={progress.tailscaleSignedIn}
          >
            <p>Open Tailscale and sign in using your own account.</p>
            <p>You normally only need to do this once on each device.</p>
            <p>
              Do not share one Tailscale account across several people. Each
              person should use their own account.
            </p>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                update({
                  tailscaleInstalled: true,
                  tailscaleSignedIn: true,
                });
                scrollToId("step-3");
              }}
            >
              I have signed in
            </button>
          </Step>

          <Step
            id="step-3"
            number={3}
            title="Connect Camera Access"
            complete={progress.cameraAccessAccepted}
          >
            <p>
              This securely adds the camera server to your Tailscale account. It
              does not give you access to the rest of the home network.
            </p>
            <p>
              If Tailscale asks you to confirm the shared device, accept the
              invitation.
            </p>
            <a
              className="btn btn-primary w-full sm:w-auto"
              href={shareUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Connect Camera Access
            </a>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                update({
                  tailscaleInstalled: true,
                  tailscaleSignedIn: true,
                  cameraAccessAccepted: true,
                });
                scrollToId("step-4");
              }}
            >
              I have accepted camera access
            </button>
          </Step>

          <Step
            id="step-4"
            number={4}
            title="Open Cameras"
            complete={progress.cameraOpened}
          >
            <p>
              If the camera page does not open, make sure Tailscale shows
              Connected and try again.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                className="btn btn-primary min-w-44"
                onClick={openCameras}
              >
                Open Cameras
              </button>
              <button
                type="button"
                className="btn btn-secondary min-w-32"
                onClick={openCameras}
              >
                Try Again
              </button>
            </div>
          </Step>

          <Step
            id="step-5"
            number={5}
            title="Add Cameras to your Home Screen"
            complete={false}
          >
            <p>
              The private camera page itself is an installable app. After it
              opens, you can add it to your home screen.
            </p>
            <div className="space-y-2">
              <Disclosure title="iPhone / iPad">
                <ol className="list-decimal space-y-1 pl-5">
                  <li>Open the camera page in Safari.</li>
                  <li>Tap Share.</li>
                  <li>Tap Add to Home Screen.</li>
                  <li>Confirm Add.</li>
                </ol>
              </Disclosure>
              <Disclosure title="Android">
                <p>
                  In Chrome, open the browser menu and choose Install app or Add
                  to Home Screen.
                </p>
              </Disclosure>
              <Disclosure title="Windows / macOS">
                <p>
                  Chrome or Edge may show Install App in the address bar or the
                  browser menu.
                </p>
              </Disclosure>
            </div>
          </Step>
        </ol>

        <section className="mt-6">
          <Disclosure title="Having trouble?">
            <h3 className="font-medium text-ink">Camera page will not load</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Check Tailscale is installed.</li>
              <li>Check Tailscale says Connected.</li>
              <li>Confirm Camera Access was accepted.</li>
              <li>Return here and press Open Cameras again.</li>
            </ul>

            <h3 className="mt-4 font-medium text-ink">
              Camera page opens but video does not immediately appear
            </h3>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                Allow approximately 10 seconds for the initial remote
                connection.
              </li>
              <li>Refresh the camera page.</li>
              <li>Confirm Tailscale remains connected.</li>
            </ul>

            <h3 className="mt-4 font-medium text-ink">New phone or computer</h3>
            <p className="mt-2">Repeat Steps 1 to 3 on the new device.</p>
          </Disclosure>
        </section>

        <div className="mt-8 mb-4">
          <button
            type="button"
            className="text-sm text-mute underline decoration-line underline-offset-4 hover:text-ink"
            onClick={resetProgress}
          >
            Reset setup progress
          </button>
        </div>
      </main>

      {camerasReady ? (
        <div className="fixed right-0 bottom-0 left-0 border-t border-line bg-canvas/95 p-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden">
          <button type="button" className="btn btn-primary w-full" onClick={openCameras}>
            Open Cameras
          </button>
        </div>
      ) : null}
    </div>
  );
}
