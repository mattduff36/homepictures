"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { AndroidLogo } from "@phosphor-icons/react/dist/csr/AndroidLogo";
import { AppleLogo } from "@phosphor-icons/react/dist/csr/AppleLogo";
import { CaretDown } from "@phosphor-icons/react/dist/csr/CaretDown";
import { Check } from "@phosphor-icons/react/dist/csr/Check";
import { LinuxLogo } from "@phosphor-icons/react/dist/csr/LinuxLogo";
import { LockSimple } from "@phosphor-icons/react/dist/csr/LockSimple";
import { ShieldCheck } from "@phosphor-icons/react/dist/csr/ShieldCheck";
import { WindowsLogo } from "@phosphor-icons/react/dist/csr/WindowsLogo";
import { createCameraHealthProbe } from "@/lib/camera-health";
import type { CameraHealthResult } from "@/lib/camera-health";
import { SETUP_STAGE_TITLES } from "@/lib/setup-copy";
import {
  applyDetectedAccess,
  canContinueVerify,
  completeSetupStage,
  parseStepParam,
  resolveLandingProgress,
  setupStepSearch,
  wizardViewFor,
  type WizardView,
} from "@/lib/setup-flow-state";
import { SETUP_STAGE_COUNT, type SetupStage } from "@/lib/setup-progress";
import {
  DEFAULT_SETUP_PROGRESS,
  clearSetupProgress,
  readSetupProgress,
  writeSetupProgress,
  type SetupProgress,
} from "@/lib/setup-progress";
import { detectPlatform, TAILSCALE_DOWNLOADS, type PlatformId } from "@/lib/platforms";
import {
  WINDOWS_INSTALLER_FILENAME,
  WINDOWS_INSTALLER_PATH,
  WINDOWS_INSTALLER_STEPS,
  WINDOWS_PRIMARY_ACTION,
  WINDOWS_PRIMARY_HEADING_RECOMMENDED,
  WINDOWS_PRIMARY_SUPPORTING,
  WINDOWS_SECONDARY_ACTION,
  WINDOWS_SECONDARY_SUPPORTING,
} from "@/lib/windows-installer";

const PLATFORM_LABELS: Record<PlatformId, string> = {
  ios: "iPhone / iPad",
  android: "Android",
  windows: "Windows",
  macos: "macOS",
  linux: "Linux",
};

const PAGE_GUTTER =
  "px-[max(1.25rem,env(safe-area-inset-left))] pr-[max(1.25rem,env(safe-area-inset-right))]";

type PrimaryAction = {
  label: string;
  onClick: () => void;
  disabled: boolean;
  hint: string;
};

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

function StageProgress({
  stage,
  completedUpTo,
}: {
  stage: SetupStage;
  completedUpTo: SetupProgress["completedUpTo"];
}) {
  return (
    <>
      <p className="text-sm text-mute">
        Step {stage} of {SETUP_STAGE_COUNT}
      </p>
      <ol className="mt-3 flex gap-2" aria-hidden="true">
        {SETUP_STAGE_TITLES.map((label, index) => {
          const number = (index + 1) as SetupStage;
          const complete = completedUpTo >= number;
          const current = stage === number;
          return (
            <li
              key={label}
              className={`h-1.5 flex-1 rounded-full ${
                complete || current ? "bg-secure" : "bg-line"
              }`}
            />
          );
        })}
      </ol>
    </>
  );
}

function DeviceSelect({
  detected,
  platform,
  onChange,
}: {
  detected: PlatformId | null;
  platform: PlatformId | null;
  onChange: (value: PlatformId | null) => void;
}) {
  return (
    <label className="block text-sm text-mute">
      This device
      <select
        className="field mt-2"
        value={platform ?? ""}
        onChange={(event) => {
          const value = event.target.value;
          onChange(value ? (value as PlatformId) : null);
        }}
      >
        {detected ? (
          <option value="">
            Detected: {PLATFORM_LABELS[detected]}
          </option>
        ) : (
          <option value="">Choose a platform</option>
        )}
        {(Object.keys(PLATFORM_LABELS) as PlatformId[]).map((id) => (
          <option key={id} value={id}>
            {PLATFORM_LABELS[id]}
          </option>
        ))}
      </select>
    </label>
  );
}

function PrimaryCta({
  action,
  className,
}: {
  action: PrimaryAction;
  className?: string;
}) {
  return (
    <div className={className}>
      <button
        type="button"
        className="btn btn-primary w-full"
        data-setup-cta="primary"
        onClick={action.onClick}
        disabled={action.disabled}
      >
        {action.label}
      </button>
      <p className="mt-2 text-sm text-mute">{action.hint}</p>
    </div>
  );
}

function useIsClient() {
  return useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
}

export function SetupFlow({ cameraUrl }: { cameraUrl: string }) {
  const isClient = useIsClient();
  const [progress, setProgress] = useState<SetupProgress>(DEFAULT_SETUP_PROGRESS);
  const [storageLoaded, setStorageLoaded] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);
  const [locking, setLocking] = useState(false);
  const [probe, setProbe] = useState<CameraHealthResult | "checking">("checking");
  const [probeAttempt, setProbeAttempt] = useState(0);
  const [honorExplicitStep, setHonorExplicitStep] = useState(false);

  const detected = isClient ? detectPlatform() : null;
  const platform = progress.platformOverride ?? detected;

  if (isClient && !storageLoaded) {
    const params = new URLSearchParams(window.location.search);
    const stored = readSetupProgress();
    setHonorExplicitStep(parseStepParam(params.get("step")) !== null);
    const next = resolveLandingProgress(stored, {
      stepParam: params.get("step"),
      windowsFlag: params.get("windows"),
    });
    setStorageLoaded(true);
    setProgress(next);
    if (next !== stored) {
      writeSetupProgress(next);
    }
  }

  function update(partial: Partial<SetupProgress>) {
    setProgress((current) => {
      const next = { ...current, ...partial };
      writeSetupProgress(next);
      return next;
    });
  }

  function completeCurrentStage() {
    const next = completeSetupStage(progress, probe);
    if (next === progress) {
      return;
    }
    if (next.currentStage === 3) {
      setProbe("checking");
    }
    update({
      completedUpTo: next.completedUpTo,
      currentStage: next.currentStage,
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

      window.location.replace("/setup");
    } catch {
      setLockError("Unable to lock the setup page. Check your connection and try again.");
    } finally {
      setLocking(false);
    }
  }

  function openCameras() {
    update({
      completedUpTo: Math.max(progress.completedUpTo, 4) as SetupProgress["completedUpTo"],
      currentStage: 5,
    });
    window.location.assign(cameraUrl);
  }

  function resetProgress() {
    setHonorExplicitStep(true);
    setProgress(DEFAULT_SETUP_PROGRESS);
    clearSetupProgress();
    setProbe("checking");
    setProbeAttempt((value) => value + 1);
  }

  useEffect(() => {
    if (!isClient || !storageLoaded) {
      return;
    }

    const search = setupStepSearch(
      new URLSearchParams(window.location.search),
      progress.currentStage,
    );
    const nextUrl = `${window.location.pathname}${search}${window.location.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl !== currentUrl) {
      window.history.replaceState({}, "", nextUrl);
    }
  }, [isClient, progress.currentStage, storageLoaded]);

  useEffect(() => {
    if (progress.currentStage !== 3) {
      return;
    }

    let cancelled = false;
    const active = createCameraHealthProbe(cameraUrl);

    void active.promise.then((result) => {
      if (!cancelled) {
        setProbe(result === "ok" ? "ok" : "failed");
      }
    });

    return () => {
      cancelled = true;
      active.abort();
    };
  }, [cameraUrl, progress.currentStage, probeAttempt]);

  useEffect(() => {
    if (!storageLoaded || honorExplicitStep || progress.currentStage >= 3) {
      return;
    }

    let cancelled = false;
    const active = createCameraHealthProbe(cameraUrl);

    void active.promise.then((result) => {
      if (cancelled || result !== "ok") {
        return;
      }

      setProgress((current) => {
        const detected = applyDetectedAccess(current, "ok");
        if (detected === current) {
          return current;
        }
        writeSetupProgress(detected);
        return detected;
      });
    });

    return () => {
      cancelled = true;
      active.abort();
    };
  }, [cameraUrl, honorExplicitStep, progress.currentStage, storageLoaded]);

  const stage = progress.currentStage;
  const view = wizardViewFor(platform, stage, probe);
  const title = view.title;
  const primaryAction: PrimaryAction =
    stage === 1
      ? {
          label: "Installed",
          onClick: completeCurrentStage,
          disabled: !platform,
          hint: platform
            ? "Press this after Tailscale is installed."
            : "Choose this device first.",
        }
      : stage === 2
        ? {
            label: "Signed in and invite accepted",
            onClick: completeCurrentStage,
            disabled: false,
            hint: "Press this after signing in and accepting the owner's Dell device invite.",
          }
        : stage === 3
          ? {
              label: "Continue",
              onClick: completeCurrentStage,
              disabled: !canContinueVerify(probe),
              hint:
                probe === "ok"
                  ? "Camera access is ready on this device."
                  : "This unlocks when camera access is detected.",
            }
          : {
              label: "Open MPDEE Vision",
              onClick: openCameras,
              disabled: false,
              hint: "Opens the private camera page.",
            };

  function goBack() {
    const previous = (stage - 1) as SetupStage;
    if (previous === 3) {
      setProbe("checking");
    }
    update({ currentStage: previous });
  }

  return (
    <div className="min-h-[100dvh] pb-[max(7rem,calc(env(safe-area-inset-bottom)+6rem))] lg:pb-[max(2rem,env(safe-area-inset-bottom))]">
      <header className="border-b border-line">
        <div
          className={`page-shell flex flex-col items-start justify-between gap-4 ${PAGE_GUTTER} pt-[max(1.25rem,env(safe-area-inset-top))] pb-5 sm:flex-row sm:items-end`}
        >
          <div className="max-w-3xl">
            <h1 className="text-[1.65rem] font-semibold tracking-tight lg:text-[1.85rem]">
              Home Camera Access
            </h1>
            <p className="mt-2 text-mute">
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
          <p className={`page-shell ${PAGE_GUTTER} pb-4 text-sm text-danger`} role="alert">
            {lockError}
          </p>
        ) : null}
      </header>

      <main
        className={`page-shell grid items-start gap-8 ${PAGE_GUTTER} pt-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-10 xl:grid-cols-[minmax(0,1fr)_22rem] xl:gap-14`}
      >
        <div className="min-w-0">
          <div className="panel mb-6 p-5 text-sm leading-relaxed text-mute" role="note">
            <p className="font-medium text-ink">MPDEE Vision has moved to Dell</p>
            <p className="mt-2">
              Remove the old Raspberry Pi home-screen shortcut or installed app.
              Open the new Dell app at{" "}
              <a className="underline" href={cameraUrl}>{cameraUrl}</a>{" "}
              and install it again from that address after setup. Old bookmarks
              must be replaced too. The old shared Google sign-in is disabled;
              use your own working Tailscale account and ask the owner privately
              for a Dell-only device share invite.
            </p>
          </div>
          <div className="lg:hidden">
            <StageProgress stage={stage} completedUpTo={progress.completedUpTo} />
            <div className="mt-5">
              <DeviceSelect
                detected={detected}
                platform={platform}
                onChange={(value) => update({ platformOverride: value })}
              />
            </div>
            <p className="mt-2 text-sm text-mute">
              Change this only if detection is wrong.
            </p>
          </div>

          <section className="panel mt-6 p-5 sm:p-6 lg:mt-0 lg:p-8">
            <div className="flex items-start gap-3 lg:gap-4">
              <span className="step-index mt-0.5" data-complete={progress.completedUpTo >= stage}>
                {progress.completedUpTo >= stage ? (
                  <Check size={14} weight="regular" aria-hidden="true" />
                ) : (
                  stage
                )}
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold tracking-tight lg:text-xl">
                  {stage}. {title}
                </h2>
                <div className="mt-3 max-w-3xl space-y-4 text-[0.95rem] leading-relaxed text-mute lg:text-base">
                  {stage === 1 ? (
                    <InstallStage
                      platform={platform}
                      view={view}
                      onInstalled={completeCurrentStage}
                    />
                  ) : null}
                  {stage === 2 ? (
                    <SignInStage />
                  ) : null}
                  {stage === 3 ? (
                    <VerifyStage
                      probe={probe}
                      onRetry={() => {
                        setProbe("checking");
                        setProbeAttempt((value) => value + 1);
                      }}
                    />
                  ) : null}
                  {stage === 4 ? (
                    <>
                      <p>
                        If the camera page does not open, make sure Tailscale shows
                        Connected and try again.
                      </p>
                      <button
                        type="button"
                        className="btn btn-secondary min-w-32"
                        onClick={completeCurrentStage}
                      >
                        Continue to Home Screen
                      </button>
                    </>
                  ) : null}
                  {stage === 5 ? (
                    <>
                      <p>
                        Remove the old home-screen shortcut or installed app first.
                        Install only from the new Dell camera page:{" "}
                        <a className="underline" href={cameraUrl}>{cameraUrl}</a>.
                        Do not install this setup website.
                      </p>
                      <HomeScreenStage view={view} />
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          </section>

          {stage > 1 ? (
            <div className="mt-4 lg:hidden">
              <button
                type="button"
                className="btn btn-ghost px-3 text-sm"
                onClick={goBack}
              >
                Back
              </button>
            </div>
          ) : null}

          <section className="mt-6 space-y-2 lg:mt-8">
            <Disclosure title="Troubleshooting">
              <h3 className="font-medium text-ink">Camera page will not load</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>
                  The camera box may be temporarily offline. Wait a minute and
                  press Try again. That does not mean your password or Tailscale
                  sign-in is wrong.
                </li>
                <li>Check Tailscale is installed and says Connected.</li>
                <li>Use your own working Tailscale account and accept the owner&apos;s Dell-only private device share invite with that same account.</li>
                <li>Return here and press Try again, then Open MPDEE Vision.</li>
                <li>
                  If your browser asks whether CCTV can access devices on your
                  local network, allow it. This is used only to check whether
                  your private camera server is reachable.
                </li>
                <li>
                  A successful setup check only confirms the camera page is
                  reachable. It does not prove live video.
                </li>
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
                <li>
                  A successful setup check only confirms Tailscale HTTP
                  reachability, not live video.
                </li>
              </ul>
              <h3 className="mt-4 font-medium text-ink">New phone or computer</h3>
              <p className="mt-2">Start setup again on the new device.</p>
            </Disclosure>
            <Disclosure title="Show all instructions">
              <ol className="list-decimal space-y-1 pl-5">
                <li>Install Tailscale for this device.</li>
                <li>Sign in with your own Tailscale account and accept the owner&apos;s private Dell-only device invite.</li>
                <li>Wait until camera access is detected, then press Continue.</li>
                <li>Open MPDEE Vision.</li>
                <li>Add the camera page to your home screen or install it.</li>
              </ol>
            </Disclosure>
          </section>

          <div className="mt-8 mb-4 lg:hidden">
            <button
              type="button"
              className="text-sm text-mute underline decoration-line underline-offset-4 hover:text-ink"
              onClick={resetProgress}
            >
              Start setup again
            </button>
          </div>
        </div>

        <aside className="hidden lg:block">
          <div className="setup-rail panel p-5 xl:p-6">
            <StageProgress stage={stage} completedUpTo={progress.completedUpTo} />
            <div className="mt-5">
              <DeviceSelect
                detected={detected}
                platform={platform}
                onChange={(value) => update({ platformOverride: value })}
              />
            </div>
            <p className="mt-2 text-sm text-mute">
              Change this only if detection is wrong.
            </p>
            <PrimaryCta action={primaryAction} className="mt-6" />
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {stage > 1 ? (
                <button
                  type="button"
                  className="btn btn-ghost px-3 text-sm"
                  onClick={goBack}
                >
                  Back
                </button>
              ) : null}
              <button
                type="button"
                className="text-sm text-mute underline decoration-line underline-offset-4 hover:text-ink"
                onClick={resetProgress}
              >
                Start setup again
              </button>
            </div>
          </div>
        </aside>
      </main>

      <div className="setup-sticky-cta lg:hidden">
        <PrimaryCta action={primaryAction} />
      </div>
    </div>
  );
}

function InstallStage({
  platform,
  view,
  onInstalled,
}: {
  platform: PlatformId | null;
  view: WizardView;
  onInstalled: () => void;
}) {
  if (!platform) {
    return <p>Choose your device above, then install Tailscale.</p>;
  }

  if (view.usesWindowsInstaller) {
    return (
      <>
        <div className="windows-install space-y-3 rounded-[var(--radius)] border p-4" data-recommended="true">
          <p className="font-semibold text-ink">{WINDOWS_PRIMARY_HEADING_RECOMMENDED}</p>
          <p>{WINDOWS_PRIMARY_SUPPORTING}</p>
          <a
            className="btn btn-primary w-full sm:w-auto"
            href={WINDOWS_INSTALLER_PATH}
            download={WINDOWS_INSTALLER_FILENAME}
          >
            <WindowsLogo size={18} weight="regular" aria-hidden="true" />
            {WINDOWS_PRIMARY_ACTION}
          </a>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {WINDOWS_INSTALLER_STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p className="text-sm">{WINDOWS_SECONDARY_SUPPORTING}</p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={onInstalled}>
          {WINDOWS_SECONDARY_ACTION}
        </button>
      </>
    );
  }

  const download = TAILSCALE_DOWNLOADS[platform];
  const Icon =
    platform === "ios" || platform === "macos"
      ? AppleLogo
      : platform === "android"
        ? AndroidLogo
        : LinuxLogo;

  return (
    <>
      <p>
        Tailscale creates the secure private connection required to access the
        cameras. The cameras are not exposed directly to the internet.
      </p>
      <a
        className="btn btn-primary w-full sm:w-auto"
        href={download.href}
        target="_blank"
        rel="noopener noreferrer"
      >
        <Icon size={18} weight="regular" aria-hidden="true" />
        Install Tailscale
        {view.usesAppStore ? " from the App Store" : ""}
      </a>
      {view.usesAppStore ? (
        <p>
          After you tap Get, return here and confirm that Tailscale is
          installed.
        </p>
      ) : (
        <p>Install Tailscale, then return here.</p>
      )}
      <p className="text-sm">
        When Tailscale is installed, press Installed.
      </p>
    </>
  );
}

function SignInStage() {
  return (
    <>
      <p>
        Open Tailscale and sign in with your own working account. If you already
        have a working Tailscale account on this device, keep using it.
        On iPhone or iPad, allow the VPN prompt.
      </p>
      <ol className="list-decimal space-y-2 pl-5">
        <li>Ask the owner privately for a device share invite for the Dell camera server only.</li>
        <li>Open that private invite and accept it while signed in with the same Tailscale account you use on this device.</li>
        <li>Return to Tailscale and check it says Connected, then continue here.</li>
      </ol>
      <p>
        Do not join the owner&apos;s home tailnet. The invite shares only the Dell
        camera device, not the home network. No invite or account password is
        published on this page. The old shared Google identity and automatic
        Windows sign-in helper are retired. Delete any previously downloaded
        sign-in helper; do not run it.
      </p>
    </>
  );
}

function VerifyStage({
  probe,
  onRetry,
}: {
  probe: CameraHealthResult | "checking";
  onRetry: () => void;
}) {
  return (
    <>
      <p>
        This checks whether this device can already reach the private camera
        server through Tailscale. It does not test live video.
      </p>
      {probe === "checking" ? (
        <p className="inline-flex items-center gap-2">
          <span className="gateway-spinner" aria-hidden="true" />
          Checking camera access…
        </p>
      ) : null}
      {probe === "ok" ? (
        <p className="font-medium text-secure-soft">
          Camera access detected
        </p>
      ) : null}
      {probe === "failed" ? (
        <div className="space-y-2 text-danger" role="alert">
          <p className="font-medium">Camera system isn&apos;t reachable yet</p>
          <p>
            The camera box may be offline or still starting. This does not mean
            your password or Tailscale sign-in is wrong.
          </p>
        </div>
      ) : null}
      <button type="button" className="btn btn-secondary" onClick={onRetry}>
        Try again
      </button>
    </>
  );
}

function HomeScreenStage({ view }: { view: WizardView }) {
  const kind = view.home;
  if (kind === "ios") {
    return (
      <>
        <p>
          The private camera page itself is an installable app. Open MPDEE
          Vision in Safari before you add it to your Home Screen.
        </p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Open the camera page in Safari.</li>
          <li>Tap Share.</li>
          <li>Tap Add to Home Screen.</li>
          <li>Confirm Add.</li>
        </ol>
      </>
    );
  }

  if (kind === "android") {
    return (
      <p>
        In Chrome, open the browser menu and choose Install app or Add to Home
        Screen.
      </p>
    );
  }

  if (kind === "desktop") {
    return (
      <p>
        Chrome or Edge may show Install App in the address bar or the browser
        menu.
      </p>
    );
  }

  if (kind === "linux") {
    return (
      <p>
        If your browser offers Install App, use that. Otherwise keep the camera
        page bookmarked.
      </p>
    );
  }

  return <p>Choose your device above to see install instructions.</p>;
}
