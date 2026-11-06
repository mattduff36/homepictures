import assert from "node:assert/strict";
import { test } from "node:test";
import { PROGRESS_STORAGE_KEY } from "./constants";
import {
  DEFAULT_SETUP_PROGRESS,
  parseSetupProgress,
  serializeSetupProgress,
} from "./setup-progress";

test("WIZARD-STATE-01: Pi progress is ignored and v3 is normalized without secrets", () => {
  assert.equal(PROGRESS_STORAGE_KEY, "homepictures.setup.v3");
  assert.deepEqual(
    parseSetupProgress(JSON.stringify({
      v: 2, currentStage: 5, completedUpTo: 5, platformOverride: "ios",
    })),
    DEFAULT_SETUP_PROGRESS,
  );
  assert.deepEqual(
    parseSetupProgress(
      JSON.stringify({
        v: 1,
        tailscaleInstalled: true,
        cameraOpened: true,
      }),
    ),
    DEFAULT_SETUP_PROGRESS,
  );
  assert.deepEqual(parseSetupProgress("{"), DEFAULT_SETUP_PROGRESS);
  assert.deepEqual(
    parseSetupProgress(
      JSON.stringify({
        v: 3,
        currentStage: 9,
        completedUpTo: 1,
        platformOverride: null,
      }),
    ),
    DEFAULT_SETUP_PROGRESS,
  );
  assert.deepEqual(
    parseSetupProgress(
      JSON.stringify({
        v: 3,
        currentStage: 2,
        completedUpTo: 1,
        platformOverride: "ios",
        password: "nope",
      }),
    ),
    DEFAULT_SETUP_PROGRESS,
  );

  const valid = parseSetupProgress(
    JSON.stringify({
      v: 3,
      currentStage: 3,
      completedUpTo: 2,
      platformOverride: "windows",
    }),
  );
  assert.deepEqual(valid, {
    v: 3,
    currentStage: 3,
    completedUpTo: 2,
    platformOverride: "windows",
  });

  const serialized = serializeSetupProgress(valid);
  assert.doesNotMatch(serialized, /password|authkey|share|cameraUrl|email|http/i);
  assert.equal(serialized, JSON.stringify(valid));
});
