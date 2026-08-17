import assert from "node:assert/strict";
import { test } from "node:test";
import {
  OTHER_PLATFORM_ORDER,
  PLATFORM_ORDER,
  TAILSCALE_DOWNLOADS,
} from "./platforms";
import { WINDOWS_INSTALLER_PATH } from "./windows-installer";

test("Windows uses the public camera installer instead of the generic Tailscale page", () => {
  assert.equal(TAILSCALE_DOWNLOADS.windows.href, WINDOWS_INSTALLER_PATH);
  assert.ok(PLATFORM_ORDER.includes("windows"));
  assert.ok(!OTHER_PLATFORM_ORDER.includes("windows" as never));
});

test("non-Windows platforms stay on official store or Tailscale download pages", () => {
  assert.deepEqual(OTHER_PLATFORM_ORDER, ["macos", "ios", "android", "linux"]);
  for (const id of OTHER_PLATFORM_ORDER) {
    assert.match(TAILSCALE_DOWNLOADS[id].href, /^https:\/\//);
    assert.doesNotMatch(TAILSCALE_DOWNLOADS[id].href, /Install-CCTV-Tailscale/);
  }
});
