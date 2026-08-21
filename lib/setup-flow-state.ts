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

export function canContinueVerify(probe: VerifyProbe): boolean {
  return probe === "ok";
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
