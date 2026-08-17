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

const unauthenticated = await read("/");
assert.equal(unauthenticated.response.status, 200);
assert.doesNotMatch(unauthenticated.text, new RegExp(shareCanary));
assert.doesNotMatch(unauthenticated.text, new RegExp(cameraCanary));
assert.match(unauthenticated.text, /Home Camera Access/);
assert.match(unauthenticated.text, /Private authorised access only/);
assert.doesNotMatch(unauthenticated.text, /Install Tailscale/);
assert.doesNotMatch(unauthenticated.text, /Install Tailscale for Camera Access/);
assert.match(
  header(unauthenticated.response.headers, "cache-control") ?? "",
  /no-store/i,
);

const installer = await read("/Install-CCTV-Tailscale.ps1");
assert.equal(installer.response.status, 200);
assert.match(installer.text, /HomePictures camera-safe Tailscale installer/);
assert.match(installer.text, /UseTailscaleDNSSettings/);
assert.doesNotMatch(installer.text, /SETUP_PASSWORD/);
assert.doesNotMatch(installer.text, /SESSION_SECRET/);
assert.doesNotMatch(installer.text, /TAILSCALE_SHARE_URL/);
assert.doesNotMatch(installer.text, /CAMERA_URL/);
assert.doesNotMatch(installer.text, new RegExp(shareCanary));
assert.doesNotMatch(installer.text, new RegExp(cameraCanary));
assert.doesNotMatch(installer.text, new RegExp(password));
assert.match(
  header(unauthenticated.response.headers, "content-security-policy") ?? "",
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
const authenticated = await read("/", {
  headers: { cookie: sessionCookie },
});
assert.equal(authenticated.response.status, 200);
assert.match(authenticated.text, new RegExp(shareCanary));
assert.match(authenticated.text, new RegExp(cameraCanary));
assert.match(authenticated.text, /Install Tailscale/);
assert.match(authenticated.text, /Install Tailscale for Camera Access/);
assert.match(authenticated.text, /I already have Tailscale/);
assert.match(
  header(authenticated.response.headers, "cache-control") ?? "",
  /private/i,
);
assert.match(
  header(authenticated.response.headers, "cache-control") ?? "",
  /no-store/i,
);

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

const locked = await read("/");
assert.doesNotMatch(locked.text, new RegExp(shareCanary));
assert.doesNotMatch(locked.text, new RegExp(cameraCanary));

console.log("live verification passed");
