# Home Camera Access

Website camera viewer and private-access onboarding for authorised friends and
family. `/watch` offers individually authorised Swann/Ring cameras without
Tailscale or installation. Live media travels through WebRTC/TURN, not Vercel.
Only small authenticated Ring stills pass through the portal. Existing private
access still uses Tailscale; the setup password **never authorises viewing**.

## Vision website presentation

`/watch` uses the Dell MPDEE Vision artwork and startup animation, an edge-to-edge
wall, square controls, the floating burger menu, and Swann / All / Ring wall
navigation. Automatic layout uses Featured on wide desktop pointers and Grid on
phones. Settings > Viewing can pin either layout, set rotation timing, and choose
Fill or Fit. Select All Cameras again in the menu while Automatic is selected to
temporarily switch Featured/Grid. Tap a Featured thumbnail to feature it, tap the
large view to pause/resume rotation, and use Expand for fullscreen. Horizontal
swipes change walls on touch screens.

The startup layer respects reduced motion and cannot trap a failed connection;
it supports Skip and a bounded fallback. Its video and still are copied unchanged
from the Dell frontend. Player instances remain mounted across wall/layout
changes; a repeated Ring thumbnail reuses its existing in-memory still. Layout
preferences are the only viewer data kept in localStorage. Credentials, account
data, media, TURN configuration and snapshots are never persisted there.

Visiting `/` opens `/watch` directly. After a new or restored sign-in, the
startup animation plays and the Swann wall starts once, muted. Ring remains snapshot-only
until fullscreen plus explicit Play, for at most five minutes. Opening Ring
fullscreen stops the Swann wall; close it and press Start wall to resume. Settings
contain only browser-supported controls; private appliance operations stay on the
Dell. The existing receive-only WebRTC/TURN path, finite leases, per-account
permissions, one-audio rule and saved-sign-in controls remain in effect.

Website accounts are managed on the Dell under Settings > System > Website
accounts. Its local-only controls create accounts, assign cameras, reset passwords,
enable/disable access and revoke remembered sessions. Public website accounts
have no administrative role. Account changes restart only the isolated website
gateway, briefly stopping website streams; recording and private Dell playback
continue. The companion Vision repository contains the installer and rollback
procedure.

## Dell cutover

The canonical camera app is **https://mpdee-vision.tail03543e.ts.net/**.
`lib/constants.ts` supplies this address to the gateway, authenticated setup, and
the exact-origin CSP allowlist. The legacy `CAMERA_URL` environment variable is ignored,
so an old deployment setting cannot send users back to the Raspberry Pi.
Changing the camera address now requires a code change and deployment.

Existing users must remove the old Raspberry Pi home-screen shortcut or installed
app, replace old bookmarks, and install the app again from the Dell origin.
Adding this public website to Home Screen is separate from installing private MPDEE Vision.
An existing installation cannot change its origin automatically.

The old shared Google identity is disabled. Each family member must use their
**own working Tailscale account**, then accept a **Dell-only private device share
invite** supplied privately by the owner. Accept the invite with the same account
used in Tailscale on the viewing device. Do not join the owner's home tailnet.
Machine sharing is user-specific; repeat the private invitation for each intended
recipient account. The portal publishes no invitation, credentials, or auth key.

The owner must share only the Dell camera device and confirm the recipient can
reach it. This repository does not create or accept shares, change tailnet ACLs,
configure Dell services, or alter the old Pi. Do not restrict access to HTTPS
alone without checking the app's WebRTC/media requirements.

## User flow

1. With website viewing enabled, `https://cctv.mpdee.uk/` redirects directly to
   `/watch`. A saved sign-in launches Vision automatically; otherwise the sign-in
   form opens, and successful login launches it. Private setup stays at `/setup`.
   When website viewing is disabled, root retains the private Dell health check.
2. Only HTTP `204 No Content` counts as successful reachability. Success opens the
   Dell app after the existing short countdown; failure or Cancel opens `/setup`.
3. `/setup` retains the setup password gate and existing one-step-at-a-time design:
   install Tailscale; sign in with a personal account and accept the private Dell
   invite; verify reachability; open MPDEE Vision; install the new app.
4. Verification unlocks Continue but never auto-advances. If it fails, check
   Tailscale Connected, invite acceptance under the same account, and Dell
   availability. A failure does not prove the person's password is wrong.
5. On iPhone/iPad, open the Dell app in Safari, then Share > Add to Home Screen.
   On Android use Chrome's Install app / Add to Home Screen. On desktop use the
   browser's Install App option or bookmark the new Dell address.

The Dell `/healthz` service must return HTTP `204`, `Cache-Control: no-store`,
and CORS allowing `https://cctv.mpdee.uk`. It must be reachable through the Dell
HTTPS origin, without exposing camera or authentication data. This is an external
deployment prerequisite, **not a claim that Dell has been verified by this change**.
A successful health check proves HTTP reachability, not WebRTC or live video.

Progress uses `localStorage` key `homepictures.setup.v3`. Old `v1`/`v2` progress
is ignored so the Pi/shared-account flow is not resumed. Only stage numbers and
an optional platform override are stored, never URLs, passwords, invitations,
keys, or health results. An explicit `?step=` still selects a wizard step; the
Dell migration notice remains visible on every step. `?windows=installed` returns
to personal sign-in; the obsolete `?windows=signedin` flag no longer advances.

## Windows installer

Windows users without Tailscale can download `/Install-CCTV-Tailscale.cmd`,
double-click it, and approve the administrator prompt. It downloads the auditable
`/Install-CCTV-Tailscale.ps1` and runs it with `-File`, never `Invoke-Expression`.

The script downloads the stable official installer from
`https://pkgs.tailscale.com/stable/`, verifies the published SHA-256 checksum and
a valid Tailscale Inc. Authenticode signature, and applies camera-safe policies
without subnet routing or an exit node. Existing installations and existing
Tailscale policies are left untouched. On success it returns to
`https://cctv.mpdee.uk/setup?windows=installed`. Errors keep the window open.

Sign in manually in Tailscale with your own working account and accept the
owner's private Dell-only invite. There is **no automatic sign-in helper**.
Delete any previously downloaded `Complete-CCTV-Tailscale-Signin.cmd`; do not run
it. The retired `/api/setup/credentials` and `/api/setup/windows-signin` endpoints
return `410 Gone` with `Cache-Control: private, no-store` for every GET, regardless
of session or legacy environment configuration. They cannot emit a secret or
download. Old helper copies cannot be recalled by a website update; the owner
must revoke any legacy auth key separately.

Trusted installer state remains in `C:\ProgramData\MPDEE-HomePictures`.
To undo only policies that still match the install record, run
`C:\ProgramData\MPDEE-HomePictures\Restore-Tailscale-Defaults.ps1`.
This does not uninstall Tailscale or change a user's account.

## Local development

Requirements: Node.js 22 or later and npm.

```powershell
npm install
Copy-Item .env.example .env.local
```

Set local-only `SETUP_PASSWORD` (at least 8 characters) and `SESSION_SECRET`
(at least 32 bytes). Generate independent random values; never reuse production
secrets or commit `.env.local`. Then run `npm run dev` and open
`http://localhost:3000`. The root is the gateway and `/setup` is password-protected.

```powershell
npm test
npm run lint
npm run typecheck
npm run build
```

## Deployment configuration

| Name | Purpose |
| --- | --- |
| `SETUP_PASSWORD` | Server-only password unlocking `/setup` |
| `SESSION_SECRET` | Server-only signing secret for the HttpOnly session cookie |

Neither uses `NEXT_PUBLIC_`. The public Dell camera origin is fixed in code:
`https://mpdee-vision.tail03543e.ts.net/`. No camera URL variable is required.
Legacy `CAMERA_URL`, `TAILSCALE_SHARED_LOGIN_EMAIL`,
`TAILSCALE_SHARED_LOGIN_PASSWORD`, `TAILSCALE_SHARED_LOGIN_PROVIDER`,
`TAILSCALE_AUTHKEY`, and `TAILSCALE_SHARE_URL` are unused and should be removed
from deployment configuration. Do not replace them with personal credentials or
a private invite. Revocation of legacy credentials/keys is a separate owner action.

Import `mattduff36/homepictures` into Vercel with the Next.js preset, preserve the
two authentication variables, attach the public domain, and deploy through the
owner's normal release process. Environment changes require redeployment.
This code change does not deploy anything.

After deployment, confirm root gateway and locked `/setup` behavior, successful
unlock/hydration, and Lock Setup Page returning to locked `/setup` even on Back.
Root, setup, and auth API responses must remain `private, no-store`, never a
Vercel cache HIT/PRERENDER. Confirm CSP permits only the Dell origin for the
cross-origin health request. Another site must not frame this portal.

## Existing private-access security and revocation

Setup authentication remains server-side. The setup session cookie is HttpOnly, host-only,
`SameSite=Lax`, and `Secure` in production. Rotate `SETUP_PASSWORD` to change the
portal password; rotate `SESSION_SECRET` to invalidate all sessions. Existing
sessions otherwise remain valid until expiry. There is no single-session revoke.

The public gateway necessarily receives the public Dell hostname, but neither
knowing that URL nor unlocking setup bypasses Tailscale. No account credentials,
private share links, keys, RTSP URLs, or private records belong in this public
repository, HTML, logs, or browser storage. Crawlers remain disallowed.

Revoke a recipient's device share in Tailscale to revoke their private camera access.
Do not rely on changing the setup password for this. Remove obsolete shares and
revoke the old helper auth key separately; key revocation does not remove devices
that were already enrolled. This does not revoke separate `/watch` accounts.
The disabled shared identity must not be reintroduced.

Login attempts are throttled in memory per serverless instance (about 5 attempts
per 15 minutes per client IP). This is a speed bump, not distributed lockout.

## Password-protected website viewer

`/watch` is disabled unless server-only `VIEWER_ENABLED=true`. It uses individual
username/password accounts checked by a separate Dell Python gateway, never setup
credentials. Existing private access and `/setup` remain available. The viewer
matches the dark/green Barlow UI and lists only the account's authorised cameras:
Back Garden, Front Door, Shed, Front Caravan, Back Door; Ring Doorbell, Front,
Side, Garden and Back. Camera administration, remote controls, sirens, recordings
and arbitrary upstream requests remain private. `_Gate`/`_Indoor` are excluded.

Additional **server-only** Vercel configuration:

| Name | Purpose |
| --- | --- |
| `VIEWER_ENABLED` | Exactly `true` enables viewer UI/APIs; otherwise closed |
| `VIEWER_GATEWAY_ORIGIN` | Must be `https://mpdee-vision.tail03543e.ts.net:10000` |
| `VIEWER_SHARED_SECRET` | Independent >=32-byte secret shared only with Dell gateway |
| `CF_TURN_KEY_ID` | Cloudflare Realtime TURN key ID |
| `CF_TURN_API_TOKEN` | Cloudflare credential-generation bearer token |

Do not use `NEXT_PUBLIC_` for these. `SESSION_SECRET`/`SETUP_PASSWORD` remain
independent and unchanged. All production viewer requests must originate from
`https://cctv.mpdee.uk`; Vercel preview domains are deliberately not authorized.
The `__Host-mpdee-viewer` cookie is always Secure, HttpOnly, SameSite=Strict and
host-only, lasting at most seven days. Full local sign-in needs HTTPS; do not
weaken cookie security for HTTP development. No viewer secrets go in HTML,
browser storage, diagnostic summaries or logs.

Only same-origin POST `/api/viewer/{login,session,config,offer,poll,heartbeat,snapshot,stop,logout}` exists.
Unknown actions/fields and user-supplied session/URL/camera overrides are rejected.
Camera IDs/modes are fixed allowlists, with per-account permission checks on Dell.
Requests are signed to the fixed Dell path using HMAC-SHA256 over
`timestamp + "\n" + nonce + "\nPOST\n" + path + "\n" + exact_JSON_body`.
Dell checks clock/nonce replay and persists authentication/issuance limits in
SQLite. Login source grouping uses only Vercel's overwritten trusted client IP
header, HMAC-hashed server-side; missing/untrusted IPs share an `unknown` bucket.
The existing setup rate limiter does not authorize or protect this boundary.

Dell authorizes each config issuance before Vercel requests Cloudflare TURN
credentials with `ttl:1200`. Only filtered short-lived TURN URLs/credentials reach
the browser; master credentials stay server-side. Requests/responses are bounded
and timed out, redirects are rejected, and `/watch` plus APIs are no-store.
The browser uses no capture permission or WebSockets. Watch explicitly creates
receive-only audio/video with relay-only ICE; a complete gathered SDP is posted
as JSON. **Playing requires advancing decoded video frames and a selected relay
candidate**, not page load or signalling success. Diagnostic summaries expose
only relay confirmation and decoded-frame/audio packet/byte counters, no IP/SDP.
Audio counters alone do not prove audible sound.

Swann starts once after authentication. Stops, network changes, hidden-page
returns and expired playback leases require an explicit resume. Group navigation and single
camera selection preserve one peer/camera; Swann wall uses up to five existing
SD+audio streams with one sound source. Video starts muted/playsInline; Sound on
is explicit. Fullscreen uses the full browser viewport with a close control and keyboard
focus handling. The manifest reuses the existing icon.

All five Ring cameras default to Snapshot. Refresh is explicit, shared/cache
limited to at most one bridge fetch/camera per60s; no background battery polling.
Still age/stale/unknown metadata is shown honestly. Ring live requires opening
fullscreen and pressing Play, with an absolute five-minute maximum. Closing
fullscreen, hiding the page, going offline or signing out stops live viewing.
Data Saver disables Ring Play. Private app preferences are never read/written.

Stop, hidden tab, page exit, offline/online transition, unmount and logout close
all peers/tracks; restarting after network changes is explicit. Swann has an
absolute15min budget. Gateway-owned loopback WebSockets **also close actual
upstream peers**, with45s heartbeat and1s autonomous expiry/revocation cleanup.
Browser polls remote candidates each second and heartbeats each15s; neither
extends the absolute budget. Stale async results cannot revive stopped playback.

The separate repository's new `mpdee-vision/backend/web-viewer/README.md` defines
the exact expanded JSON protocol, safe account CLI/config migration, pinned
dependency and patched sidecar build, Python/actual Pion-WS fixture tests,
revocation, Docker/systemd templates and parent installation checklist.
Only new `backend/web-viewer/` and `config/web-viewer/` Vision files are required;
the existing go2rtc, private Serve and recording configuration must not change.

**Upgrade contract:** retain existing password hashes/secrets. Parent grants
camera permissions with the private account CLI (`update owner --cameras all`),
which increments version and requires sign-in again without changing the password.
Install `websocket-client==1.8.0` in the gateway venv. Build the isolated
`1.9.14-owned-ws` image; stock go2rtc1.9.14 does not own/close WS consumers.
The narrowly scoped patch closes actual Pion peers on transport EOF/error; the
gateway refuses a stock sidecar before sending an offer. Replace/restart only
the isolated sidecar once to remove old pilot JSON peers. SQLite migration
preserves sessions/security limits but clears unowned leases; never delete state.
Systemd LoadCredential account edits require restarting only the gateway.
Portal and gateway are a coordinated protocol upgrade.

**Important limits:** login5/source,8/user,30global per15min;5 remembered7day
sessions/user; config120/user/hour (Ring additionally30). Swann5/user/session,
10global; Ring1/user,2global. Offers single-use within60s; unoffered leases
expire after60s, offered heartbeats after45s; all signed requests1800/minute.
Snapshots<=750KB JPEG, private/no-store. These are **not provider-enforced
bandwidth or spend caps**: issued TURN credentials cannot be recalled and
camera-peer closure does not revoke arbitrary TURN allocations or guarantee
zero charges. Emergency cutoff stops the isolated gateway/sidecar, not just Funnel.

Parent must verify Cloudflare account activation, account-wide allowance/spend
controls and Funnel entitlement, then install/deploy through the owner's release
process. No runtime installation, provider activation or publication is implied
by these files. Real iPhone Safari testing over mobile data with Tailscale off
must prove relay selection, advancing decoded camera frames, audible sound,
Stop/hidden/logout traffic cleanup, bounded Dell load and unchanged original
Vision/Frigate. Owner confirmed the pilot before authorising this local Phase2
work; production release and ten-camera live acceptance remain parent-owned.

## Device acceptance

Use a Windows device with no prior Tailscale account: install via the launcher,
sign in personally, accept the private Dell share, detect access, press Continue,
open the Dell app, remove any old installed app, and install from the new origin.
Confirm normal internet access and **live WebRTC video**.

Repeat on iPhone: App Store Tailscale, personal account, VPN permission, private
Dell invite, successful detect, Continue, Dell app in Safari, Share > Add to Home
Screen, and live video. Also confirm video/playback away from the home LAN.
These require real devices and authorised private access; `/healthz` alone is
not device acceptance.

## License

Private family use. The GitHub repository is public, so keep secrets out of Git.
