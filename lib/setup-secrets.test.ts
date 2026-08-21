import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseExactSecret,
  parseSharedLogin,
  parseSharedLoginEmail,
  parseSharedLoginProvider,
  parseTailscaleAuthKey,
} from "./setup-secrets";

test("shared login password is preserved exactly and provider is allowlisted", () => {
  assert.equal(parseExactSecret(undefined), null);
  assert.equal(parseExactSecret(""), null);
  assert.equal(parseExactSecret("  secret  "), "  secret  ");
  assert.equal(parseSharedLoginEmail("  family@example.com  "), "family@example.com");
  assert.equal(parseSharedLoginEmail("not-an-email"), null);
  assert.equal(parseSharedLoginProvider("Google"), "google");
  assert.equal(parseSharedLoginProvider("yahoo"), null);
  assert.deepEqual(
    parseSharedLogin({
      email: " family@example.com ",
      password: "  keep-spaces  ",
      provider: "MICROSOFT",
    }),
    {
      email: "family@example.com",
      password: "  keep-spaces  ",
      provider: "microsoft",
    },
  );
});

test("auth keys must look like Tailscale keys and reject junk", () => {
  assert.equal(parseTailscaleAuthKey("tskey-auth-abcDEF123"), "tskey-auth-abcDEF123");
  assert.equal(parseTailscaleAuthKey(" tskey-auth-abc "), "tskey-auth-abc");
  assert.equal(parseTailscaleAuthKey("not-a-key"), null);
  assert.equal(parseTailscaleAuthKey("tskey-auth-abc file:oops"), null);
  assert.equal(parseTailscaleAuthKey("tskey-auth-abc'@"), null);
});
