import { PROGRESS_STORAGE_KEY, PROGRESS_VERSION } from "./constants";
import { type PlatformId } from "./platforms";

export const SETUP_STAGE_COUNT = 5;
export type SetupStage = 1 | 2 | 3 | 4 | 5;
export type CompletedStage = 0 | SetupStage;

export type SetupProgress = {
  v: typeof PROGRESS_VERSION;
  currentStage: SetupStage;
  completedUpTo: CompletedStage;
  platformOverride: PlatformId | null;
};

export const DEFAULT_SETUP_PROGRESS: SetupProgress = {
  v: PROGRESS_VERSION,
  currentStage: 1,
  completedUpTo: 0,
  platformOverride: null,
};

const PLATFORM_IDS = new Set<PlatformId>([
  "windows",
  "macos",
  "ios",
  "android",
  "linux",
]);

const FORBIDDEN_PROGRESS_KEYS =
  /password|authkey|auth_key|shareurl|cameraurl|email|secret|health|probe/i;

function isSetupStage(value: unknown): value is SetupStage {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

function isCompletedStage(value: unknown): value is CompletedStage {
  return value === 0 || isSetupStage(value);
}

function isPlatformId(value: unknown): value is PlatformId {
  return typeof value === "string" && PLATFORM_IDS.has(value as PlatformId);
}

export function parseSetupProgress(raw: string | null): SetupProgress {
  if (!raw) {
    return DEFAULT_SETUP_PROGRESS;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return DEFAULT_SETUP_PROGRESS;
    }

    if (parsed.v !== PROGRESS_VERSION) {
      return DEFAULT_SETUP_PROGRESS;
    }

    for (const key of Object.keys(parsed)) {
      if (FORBIDDEN_PROGRESS_KEYS.test(key)) {
        return DEFAULT_SETUP_PROGRESS;
      }
    }

    if (
      !isSetupStage(parsed.currentStage) ||
      !isCompletedStage(parsed.completedUpTo)
    ) {
      return DEFAULT_SETUP_PROGRESS;
    }

    if (
      parsed.platformOverride !== null &&
      !isPlatformId(parsed.platformOverride)
    ) {
      return DEFAULT_SETUP_PROGRESS;
    }

    return {
      v: PROGRESS_VERSION,
      currentStage: parsed.currentStage,
      completedUpTo: parsed.completedUpTo,
      platformOverride: parsed.platformOverride,
    };
  } catch {
    return DEFAULT_SETUP_PROGRESS;
  }
}

export function serializeSetupProgress(progress: SetupProgress): string {
  return JSON.stringify({
    v: PROGRESS_VERSION,
    currentStage: progress.currentStage,
    completedUpTo: progress.completedUpTo,
    platformOverride: progress.platformOverride,
  });
}

export function readSetupProgress(): SetupProgress {
  return parseSetupProgress(localStorage.getItem(PROGRESS_STORAGE_KEY));
}

export function writeSetupProgress(progress: SetupProgress) {
  localStorage.setItem(PROGRESS_STORAGE_KEY, serializeSetupProgress(progress));
}

export function clearSetupProgress() {
  localStorage.removeItem(PROGRESS_STORAGE_KEY);
}

export function nextStage(stage: SetupStage): SetupStage {
  return Math.min(stage + 1, SETUP_STAGE_COUNT) as SetupStage;
}
