import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { SETUP_STAGE_TITLES } from "./setup-copy";
import {
  canContinueVerify,
  completeSetupStage,
  wizardViewFor,
} from "./setup-flow-state";
import { DEFAULT_SETUP_PROGRESS, type SetupProgress } from "./setup-progress";
import type { PlatformId } from "./platforms";

const flow = readFileSync(
  join(process.cwd(), "components", "setup-flow.tsx"),
  "utf8",
);

const stage3: SetupProgress = {
  ...DEFAULT_SETUP_PROGRESS,
  currentStage: 3,
  completedUpTo: 2,
};

test("WIZARD-FLOW-01: every platform has five stages and verify does not auto-advance", () => {
  const platforms: Array<PlatformId | null> = [
    "ios",
    "android",
    "windows",
    "macos",
    "linux",
    null,
  ];

  for (const platform of platforms) {
    const stages = ([1, 2, 3, 4, 5] as const).map((stage) =>
      wizardViewFor(platform, stage, "ok"),
    );
    assert.deepEqual(
      stages.map((view) => view.title),
      [...SETUP_STAGE_TITLES],
    );
    assert.equal(stages[2]?.verifyContinueEnabled, true);
    assert.equal(wizardViewFor(platform, 3, "checking").verifyContinueEnabled, false);
    assert.equal(wizardViewFor(platform, 3, "failed").verifyContinueEnabled, false);
  }

  assert.deepEqual(wizardViewFor("ios", 1), {
    stage: 1,
    title: "Install Tailscale",
    home: "ios",
    usesWindowsInstaller: false,
    usesWindowsHelper: false,
    usesAppStore: true,
    verifyContinueEnabled: false,
  });
  assert.deepEqual(wizardViewFor("windows", 2), {
    stage: 2,
    title: "Sign in to Camera Access",
    home: "desktop",
    usesWindowsInstaller: true,
    usesWindowsHelper: true,
    usesAppStore: false,
    verifyContinueEnabled: false,
  });
  assert.deepEqual(wizardViewFor("android", 5), {
    stage: 5,
    title: "Add Cameras to your Home Screen",
    home: "android",
    usesWindowsInstaller: false,
    usesWindowsHelper: false,
    usesAppStore: false,
    verifyContinueEnabled: false,
  });

  assert.equal(canContinueVerify("ok"), true);
  assert.equal(canContinueVerify("checking"), false);
  assert.deepEqual(completeSetupStage(stage3, "ok").currentStage, 4);
  assert.deepEqual(completeSetupStage(stage3, "checking"), stage3);
  assert.deepEqual(completeSetupStage(stage3, "failed"), stage3);
  assert.equal(completeSetupStage(stage3, "ok").currentStage, 4);
  assert.equal(stage3.currentStage, 3);

  assert.match(flow, /wizardViewFor\(platform, stage, probe\)/);
  assert.match(flow, /completeSetupStage\(progress, probe\)/);
  assert.match(flow, /canContinueVerify\(probe\)/);
  assert.doesNotMatch(flow, /if \(result === "ok"\) \{\s*completeCurrentStage/);
  assert.doesNotMatch(flow, /Connect Camera Access/);
  assert.doesNotMatch(flow, /shareUrl/);
});
