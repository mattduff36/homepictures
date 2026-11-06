# Home Camera Access

Public onboarding portal for authorised friends and family using MPDEE Vision on
the Dell camera server. It does not host or proxy camera streams or health checks.
Tailscale is the camera access-control boundary; the setup password only protects
the onboarding wizard.

## Dell cutover

The canonical camera app is **https://mpdee-vision.tail03543e.ts.net/**.
`lib/constants.ts` supplies this address to the gateway, authenticated setup, and
the exact-origin CSP allowlist. The legacy `CAMERA_URL` environment variable is ignored,
so an old deployment setting cannot send users back to the Raspberry Pi.
Changing the camera address now requires a code change and deployment.

Existing users must remove the old Raspberry Pi home-screen shortcut or installed
app, replace old bookmarks, and install the app again from the Dell origin.
Installing this public setup website is not the same as installing MPDEE Vision.
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

1. `https://cctv.mpdee.uk/` tests the Dell origin's `/healthz`.
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

## Security and revocation

Authentication remains server-side. The session cookie is HttpOnly, host-only,
`SameSite=Lax`, and `Secure` in production. Rotate `SETUP_PASSWORD` to change the
portal password; rotate `SESSION_SECRET` to invalidate all sessions. Existing
sessions otherwise remain valid until expiry. There is no single-session revoke.

The public gateway necessarily receives the public Dell hostname, but neither
knowing that URL nor unlocking setup bypasses Tailscale. No account credentials,
private share links, keys, RTSP URLs, or private records belong in this public
repository, HTML, logs, or browser storage. Crawlers remain disallowed.

Revoke a recipient's device share in Tailscale to revoke their camera access.
Do not rely on changing the setup password for this. Remove obsolete shares and
revoke the old helper auth key separately; key revocation does not remove devices
that were already enrolled. The disabled shared identity must not be reintroduced.

Login attempts are throttled in memory per serverless instance (about 5 attempts
per 15 minutes per client IP). This is a speed bump, not distributed lockout.

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
