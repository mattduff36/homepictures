import assert from "node:assert/strict";

const base = process.env.VERIFY_BASE_URL ?? "http://127.0.0.1:3000";
const password = process.env.SETUP_PASSWORD;
const shareCanary = "CANARY_SHARE_TOKEN_DO_NOT_SHIP";
const cameraCanary = "canary-camera.example.ts.net";

if (!password) {
  throw new Error("SETUP_PASSWORD is required for live verification.");
}

function header(headers, name) {
  return headers.get(name);
}

function cookieMap(setCookie) {
  const map = new Map();
  for (const part of setCookie.split(";")) {
    const [rawName, ...rest] = part.trim().split("=");
    if (!rawName) continue;
    map.set(rawName.toLowerCase(), rest.join("="));
  }
  return map;
}

async function read(path, init = {}) {
  const response = await fetch(`${base}${path}`, {
    redirect: "manual",
    ...init,
  });
  const text = await response.text();
  return { response, text };
}

const origin = new URL(base).origin;

const gateway = await read("/");
assert.equal(gateway.response.status, 200);
assert.match(gateway.text, /Attempting to connect to your CCTV system/);
assert.match(gateway.text, new RegExp(cameraCanary));
assert.doesNotMatch(gateway.text, new RegExp(shareCanary));
assert.doesNotMatch(gateway.text, /Private authorised access only/);
assert.doesNotMatch(gateway.text, /Install Tailscale/);
assert.doesNotMatch(gateway.text, /Install Tailscale for Camera Access/);
assert.match(
  header(gateway.response.headers, "cache-control") ?? "",
  /no-store/i,
);
assert.match(
  header(gateway.response.headers, "content-security-policy") ?? "",
  /connect-src 'self' https:\/\/canary-camera\.example\.ts\.net/,
);
assert.doesNotMatch(
  header(gateway.response.headers, "content-security-policy") ?? "",
  /connect-src \*/,
);

const unauthenticatedSetup = await read("/setup");
assert.equal(unauthenticatedSetup.response.status, 200);
assert.doesNotMatch(unauthenticatedSetup.text, new RegExp(shareCanary));
assert.doesNotMatch(unauthenticatedSetup.text, new RegExp(cameraCanary));
assert.match(unauthenticatedSetup.text, /Home Camera Access/);
assert.match(unauthenticatedSetup.text, /Private authorised access only/);
assert.doesNotMatch(unauthenticatedSetup.text, /Install Tailscale/);
assert.doesNotMatch(unauthenticatedSetup.text, /Install Tailscale for Camera Access/);
assert.match(
  header(unauthenticatedSetup.response.headers, "cache-control") ?? "",
  /no-store/i,
);

const portalHealth = await read("/healthz");
assert.notEqual(portalHealth.response.status, 200);
assert.doesNotMatch(portalHealth.text, new RegExp(shareCanary));

const installer = await read("/Install-CCTV-Tailscale.ps1");
assert.equal(installer.response.status, 200);
assert.match(installer.text, /HomePictures camera-safe Tailscale installer/);
assert.match(installer.text, /UseTailscaleDNSSettings/);
assert.doesNotMatch(installer.text, /SETUP_PASSWORD/);
assert.doesNotMatch(installer.text, /SESSION_SECRET/);
assert.doesNotMatch(installer.text, /TAILSCALE_SHARE_URL/);
assert.doesNotMatch(installer.text, /TAILSCALE_SHARED_LOGIN/);
assert.doesNotMatch(installer.text, /TAILSCALE_AUTHKEY/);
assert.doesNotMatch(installer.text, /CAMERA_URL/);
assert.doesNotMatch(installer.text, new RegExp(shareCanary));
assert.doesNotMatch(installer.text, new RegExp(cameraCanary));
assert.doesNotMatch(installer.text, new RegExp(password));
assert.match(
  header(gateway.response.headers, "content-security-policy") ?? "",
  /frame-ancestors 'none'/,
);

const robots = await read("/robots.txt");
assert.match(robots.text, /Disallow:\s*\//i);

const missingOrigin = await read("/api/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ password }),
});
assert.equal(missingOrigin.response.status, 403);
assert.equal(missingOrigin.response.headers.get("set-cookie"), null);
assert.doesNotMatch(missingOrigin.text, new RegExp(password));

const crossOrigin = await read("/api/login", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    origin: "https://evil.example",
  },
  body: JSON.stringify({ password }),
});
assert.equal(crossOrigin.response.status, 403);
assert.equal(crossOrigin.response.headers.get("set-cookie"), null);

const wrongType = await read("/api/login", {
  method: "POST",
  headers: {
    "content-type": "text/plain",
    origin,
  },
  body: JSON.stringify({ password }),
});
assert.equal(wrongType.response.status, 400);

const oversized = await read("/api/login", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    origin,
  },
  body: JSON.stringify({ password: "x".repeat(2000) }),
});
assert.equal(oversized.response.status, 413);

const malformed = await read("/api/login", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    origin,
  },
  body: "{not-json",
});
assert.equal(malformed.response.status, 400);

const wrongPassword = await read("/api/login", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    origin,
  },
  body: JSON.stringify({ password: "definitely-not-the-password" }),
});
assert.equal(wrongPassword.response.status, 401);
assert.equal(wrongPassword.response.headers.get("set-cookie"), null);
assert.match(wrongPassword.text, /Incorrect password/);
assert.doesNotMatch(wrongPassword.text, /definitely-not-the-password/);

const login = await read("/api/login", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    origin,
  },
  body: JSON.stringify({ password }),
});
assert.equal(login.response.status, 200);
const setCookie = login.response.headers.get("set-cookie");
assert.ok(setCookie);
const attrs = cookieMap(setCookie);
assert.ok(setCookie.includes("hp_session="));
assert.ok(attrs.has("httponly"));
assert.ok(attrs.has("secure"));
assert.equal(attrs.get("samesite")?.toLowerCase(), "lax");
assert.equal(attrs.get("path"), "/");
assert.ok(!/domain=/i.test(setCookie));

const sessionCookie = setCookie.split(";", 1)[0];
const authenticatedGateway = await read("/", {
  headers: { cookie: sessionCookie },
});
assert.equal(authenticatedGateway.response.status, 200);
assert.match(authenticatedGateway.text, /Attempting to connect to your CCTV system/);
assert.match(authenticatedGateway.text, new RegExp(cameraCanary));
assert.doesNotMatch(authenticatedGateway.text, new RegExp(shareCanary));
assert.doesNotMatch(authenticatedGateway.text, /Install Tailscale/);

const authenticated = await read("/setup", {
  headers: { cookie: sessionCookie },
});
assert.equal(authenticated.response.status, 200);
assert.doesNotMatch(authenticated.text, new RegExp(shareCanary));
assert.doesNotMatch(authenticated.text, /TAILSCALE_AUTHKEY/);
assert.doesNotMatch(authenticated.text, /tskey-/);
assert.match(authenticated.text, new RegExp(cameraCanary));
assert.match(authenticated.text, /Install Tailscale/);
assert.match(authenticated.text, /Step 1 of 5/);
assert.match(
  header(authenticated.response.headers, "cache-control") ?? "",
  /private/i,
);
assert.match(
  header(authenticated.response.headers, "cache-control") ?? "",
  /no-store/i,
);

const credentialsDenied = await read("/api/setup/credentials");
assert.ok(
  credentialsDenied.response.status === 401 ||
    credentialsDenied.response.status === 403,
);
assert.match(
  header(credentialsDenied.response.headers, "cache-control") ?? "",
  /no-store/i,
);
assert.doesNotMatch(credentialsDenied.text, new RegExp(shareCanary));
assert.doesNotMatch(credentialsDenied.text, /tskey-/);

const credentials = await read("/api/setup/credentials", {
  headers: { cookie: sessionCookie, origin },
});
assert.ok(credentials.response.status === 200 || credentials.response.status === 503);
assert.match(
  header(credentials.response.headers, "cache-control") ?? "",
  /no-store/i,
);
if (credentials.response.status === 200) {
  assert.match(credentials.text, /"email"/);
  assert.match(credentials.text, /"password"/);
  assert.match(credentials.text, /"provider"/);
  assert.doesNotMatch(authenticated.text, JSON.parse(credentials.text).password);
}

const helperDenied = await read("/api/setup/windows-signin");
assert.ok(helperDenied.response.status === 401 || helperDenied.response.status === 403);
assert.doesNotMatch(helperDenied.text, /tskey-/);

const helper = await read("/api/setup/windows-signin", {
  headers: { cookie: sessionCookie, origin },
});
assert.ok(helper.response.status === 200 || helper.response.status === 503);
assert.match(
  header(helper.response.headers, "cache-control") ?? "",
  /no-store/i,
);
if (helper.response.status === 200) {
  assert.match(
    header(helper.response.headers, "content-disposition") ?? "",
    /Complete-CCTV-Tailscale-Signin\.ps1/,
  );
  assert.doesNotMatch(authenticated.text, /tskey-/);
}

const logoutMissingOrigin = await read("/api/logout", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    cookie: sessionCookie,
  },
  body: "{}",
});
assert.equal(logoutMissingOrigin.response.status, 403);

const logoutMalformed = await read("/api/logout", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    origin,
    cookie: sessionCookie,
  },
  body: "{not-json",
});
assert.equal(logoutMalformed.response.status, 400);

const logoutOversized = await read("/api/logout", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    origin,
    cookie: sessionCookie,
  },
  body: JSON.stringify({ padding: "x".repeat(2000) }),
});
assert.equal(logoutOversized.response.status, 413);

const logoutCrossOrigin = await read("/api/logout", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    origin: "https://evil.example",
    cookie: sessionCookie,
  },
  body: "{}",
});
assert.equal(logoutCrossOrigin.response.status, 403);

const logout = await read("/api/logout", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    origin,
    cookie: sessionCookie,
  },
  body: "{}",
});
assert.equal(logout.response.status, 200);
const cleared = logout.response.headers.get("set-cookie") ?? "";
assert.match(cleared, /hp_session=/);
assert.match(cleared, /max-age=0/i);

const locked = await read("/setup");
assert.match(locked.text, /Private authorised access only/);
assert.doesNotMatch(locked.text, new RegExp(shareCanary));
assert.doesNotMatch(locked.text, new RegExp(cameraCanary));
assert.doesNotMatch(locked.text, /Install Tailscale/);

console.log("live verification passed");
