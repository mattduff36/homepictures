import type { CameraHealthResult } from "./camera-health";
import type { PlatformId } from "./platforms";
import {
  SETUP_STAGE_TITLES,
  homeScreenKind,
  usesAppStoreInstall,
  usesWindowsInstaller,
  usesWindowsSigninHelper,
  type HomeScreenKind,
} from "./setup-copy";
import {
  nextStage,
  type SetupProgress,
  type SetupStage,
} from "./setup-progress";

export type VerifyProbe = CameraHealthResult | "checking";

export type WizardView = {
  stage: SetupStage;
  title: (typeof SETUP_STAGE_TITLES)[number];
  home: HomeScreenKind;
  usesWindowsInstaller: boolean;
  usesWindowsHelper: boolean;
  usesAppStore: boolean;
  verifyContinueEnabled: boolean;
};

export type WindowsReturnFlag = "installed" | "signedin";

export function canContinueVerify(probe: VerifyProbe): boolean {
  return probe === "ok";
}

export function parseWindowsReturnFlag(value: string | null): WindowsReturnFlag | null {
  if (value === "installed" || value === "signedin") {
    return value;
  }
  return null;
}

export function applyWindowsReturnFlag(
  progress: SetupProgress,
  flag: string | null,
): SetupProgress {
  const parsed = parseWindowsReturnFlag(flag);
  if (parsed === "installed" && progress.currentStage === 1) {
    return completeSetupStage(progress, "checking");
  }
  if (parsed === "signedin" && progress.currentStage === 2) {
    return completeSetupStage(progress, "checking");
  }
  return progress;
}

export function parseStepParam(value: string | null): SetupStage | null {
  if (value === "1" || value === "2" || value === "3" || value === "4" || value === "5") {
    return Number(value) as SetupStage;
  }
  return null;
}

export function applyStepParam(
  progress: SetupProgress,
  step: SetupStage | null,
): SetupProgress {
  if (!step) {
    return progress;
  }

  return {
    ...progress,
    currentStage: step,
  };
}

export function resolveLandingProgress(
  stored: SetupProgress,
  input: { stepParam: string | null; windowsFlag: string | null },
): SetupProgress {
  const afterWindows = applyWindowsReturnFlag(stored, input.windowsFlag);
  return applyStepParam(afterWindows, parseStepParam(input.stepParam));
}

export function applyDetectedAccess(
  progress: SetupProgress,
  probe: VerifyProbe,
): SetupProgress {
  if (probe !== "ok" || progress.currentStage >= 3) {
    return progress;
  }

  return {
    ...progress,
    completedUpTo: Math.max(progress.completedUpTo, 3) as SetupProgress["completedUpTo"],
    currentStage: 4,
  };
}

export function setupStepSearch(
  current: URLSearchParams,
  stage: SetupStage,
): string {
  const params = new URLSearchParams(current);
  params.delete("windows");
  params.set("step", String(stage));
  const search = params.toString();
  return search ? `?${search}` : "";
}

export function completeSetupStage(
  progress: SetupProgress,
  probe: VerifyProbe,
): SetupProgress {
  if (progress.currentStage === 3 && !canContinueVerify(probe)) {
    return progress;
  }

  const completed = progress.currentStage;
  return {
    ...progress,
    completedUpTo: Math.max(progress.completedUpTo, completed) as SetupProgress["completedUpTo"],
    currentStage: nextStage(completed),
  };
}

export function wizardViewFor(
  platform: PlatformId | null,
  stage: SetupStage,
  probe: VerifyProbe = "checking",
): WizardView {
  return {
    stage,
    title: SETUP_STAGE_TITLES[stage - 1],
    home: homeScreenKind(platform),
    usesWindowsInstaller: usesWindowsInstaller(platform),
    usesWindowsHelper: usesWindowsSigninHelper(platform),
    usesAppStore: usesAppStoreInstall(platform),
    verifyContinueEnabled: stage === 3 && canContinueVerify(probe),
  };
}
