# Home Camera Access

Public onboarding portal for authorised friends and family. It first checks whether the browser can already reach the private camera server. If not, it walks them through installing Tailscale, signing in to a shared Camera Access identity, verifying reachability, and opening the private camera app.

This site does **not** host or proxy camera streams or health checks. The cameras stay private behind Tailscale. This repository is public, so treat every committed file as readable by anyone.

User flow:

1. `https://cctv.mpdee.uk/` tests whether the visitor's browser can reach the private CCTV server.
2. If `/healthz` is reachable, the browser opens the private camera URL after a short countdown.
3. If the check fails, is cancelled, or `CAMERA_URL` is missing, the visitor is sent to `/setup`.
4. `/setup` is the password-protected, one-step-at-a-time setup wizard.

`/healthz` is deployed and verified on the Raspberry Pi. It is not hosted on this Vercel site. The dedicated `cctv-healthz.service` unit binds to `127.0.0.1:8766` and is published through Tailscale Serve. It returns `204 No Content`, `Cache-Control: no-store`, and CORS limited to `https://cctv.mpdee.uk`. It contains no camera, version, hostname, or authentication data. It exists only so the browser can detect Tailscale HTTP reachability. A successful `/healthz` check does **not** prove that WebRTC or other media paths work.

Current persistent Tailscale Serve routes:

- `/` → `http://127.0.0.1:1984` — CCTV PWA
- `/recordings-api` → `http://127.0.0.1:8765` — playback API
- `/healthz` → `http://127.0.0.1:8766` — reachability check

Verified on the Pi: CCTV root works, `/recordings-api/health` returns `200`, and `/healthz` returns `204` with the expected CORS header. Existing camera and NVR behaviour was not changed.

There are two security layers:

1. **Setup portal password.** `SETUP_PASSWORD` hides the setup wizard and the shared Camera Access credentials.
2. **Tailscale.** This is the real access-control boundary for the cameras. Discovering the private camera URL is not enough. The visitor still needs authorised Tailscale access.

The public gateway at `/` necessarily receives `CAMERA_URL` so it can test and then navigate to the camera server. It does **not** receive shared login details or an auth key.

The portal password cannot bypass Tailscale. If the portal is compromised, an attacker may obtain the shared Camera Access credentials or auth key. Treat those like passwords. Rotate them and remove unexpected machines immediately.

## Camera Access architecture

Family devices must **not** join the home Tailscale tailnet.

```
Home tailnet
  -> Raspberry Pi camera node
  -> machine shared once to the Camera Access identity
  -> Camera Access tailnet
  -> family devices signed in as that identity
```

Tailscale machine sharing is **user-specific**, not tailnet-wide. The design works because every family camera device uses the same dedicated Camera Access identity. An administrator shares the Pi once to that identity. The Camera Access tailnet and identity must have no relationship to the home tailnet beyond that one machine share.

Do not invite family members as users of the home tailnet. Do not generate family auth keys in the home tailnet.

The camera app is served over HTTPS (`CAMERA_URL`). Live video uses WebRTC/go2rtc as well. Do not tighten shared-node access to TCP 443 only. Do not change Pi ACLs, Serve routes, or media ports as part of this portal.

The shared Camera Access identity must be used only for this project. The provider account should hold no email, storage, recovery, or unrelated privileges that family members should not share. Anyone who knows those credentials can control this identity and enrol new devices.

## Administrator bootstrap

Do this once before handing the portal to family members. Do not automate it against the Pi.

1. Create a **new** SSO identity used only for MPDEE Vision / Camera Access. Do not reuse the home Tailscale owner.
2. Sign that identity into Tailscale so it owns a dedicated Camera Access tailnet.
3. From the **home** tailnet, share the Pi camera machine to that identity. Use a machine share. Do not invite the identity as a home-tailnet user.
4. Accept the share once while signed in as Camera Access.
5. From a device signed into Camera Access, confirm `CAMERA_URL` opens **and** live video/WebRTC still works. If this fails, stop.
6. Optionally create a reusable auth key in the **Camera Access** tailnet only, for Windows helper sign-in. Use the shortest practical expiry, keep it manually revocable, and never tag it as a server or home-tailnet device. The same key can be replayed until it expires.
7. Put the secrets below in Vercel. Redeploy.

Family users never see or accept a share link.

## Setup wizard

After the portal password, `/setup` shows one stage at a time:

1. Install Tailscale for the detected platform.
2. Sign in to Camera Access with the shared SSO identity. Windows PCs with no existing Tailscale account may use the authenticated sign-in helper.
3. Verify camera access with the existing `/healthz` probe. Success unlocks **Continue**. The wizard never auto-advances.
4. Open Cameras.
5. Add to Home Screen / install, using only that platform's instructions. On iPhone/iPad, open MPDEE Vision in Safari, then Share → Add to Home Screen.

Progress is stored in `localStorage` as `homepictures.setup.v2`. It stores only stage numbers and an optional platform override. It never stores passwords, auth keys, URLs, or probe results. A previous successful probe is not treated as current connectivity. Old `v1` progress is ignored.

## Windows camera installer

Windows visitors who do not already have Tailscale can download a public, auditable script:

`/Install-CCTV-Tailscale.ps1`

On a PC where Tailscale is not installed, the script downloads the current stable official installer from `https://pkgs.tailscale.com/stable/`, checks the published SHA-256 hash, requires a valid Authenticode signature from Tailscale Inc., then writes camera-safe machine policies. It does not use an auth key and does not sign the person in.

If Tailscale is already installed, or if `HKLM\SOFTWARE\Policies\Tailscale` already has policy values, the script makes no changes.

The public script contains no `SETUP_PASSWORD`, session secret, shared login, camera URL, or Tailscale auth key.

After a fresh install, the wizard can download a **separate**, session-gated sign-in helper. That helper:

- is generated at request time and is never a static public file
- uses an auth key from the Camera Access tailnet only
- refuses to run `up`, `login`, `logout`, `reset`, or `switch` if Tailscale already has an account
- passes the key through an ACL-protected temporary `file:` argument, then deletes that file
- must be deleted after use; copies may remain in Downloads, backups, or endpoint telemetry

If Tailscale is already signed in, or the helper is unavailable, the person signs in with the shared SSO account shown in the wizard.

Trusted installer state is stored only in `C:\ProgramData\MPDEE-HomePictures`. The installer does not use `C:\ProgramData\MPDEE`, which may be writable by other MPDEE software.

To undo only the camera-specific policies on a PC that used this installer, run:

`C:\ProgramData\MPDEE-HomePictures\Restore-Tailscale-Defaults.ps1`

That restore script reads `C:\ProgramData\MPDEE-HomePictures\homepictures-tailscale-record.json` and deletes a policy only when it still matches the HomePictures record. It does not uninstall Tailscale.

## Local development

Requirements: Node.js 22 or later, npm.

```bash
git clone https://github.com/mattduff36/homepictures.git
cd homepictures
npm install
cp .env.example .env.local
```

Generate local values. Do not reuse production secrets.

```bash
openssl rand -base64 18
openssl rand -base64 32
```

Put them in `.env.local`:

```bash
SETUP_PASSWORD=
SESSION_SECRET=
CAMERA_URL=
TAILSCALE_SHARED_LOGIN_EMAIL=
TAILSCALE_SHARED_LOGIN_PASSWORD=
TAILSCALE_SHARED_LOGIN_PROVIDER=
TAILSCALE_AUTHKEY=
```

Rules:

- `SETUP_PASSWORD` must be at least 8 characters.
- `SESSION_SECRET` must be at least 32 bytes. `openssl rand -base64 32` is enough.
- `CAMERA_URL` must be the private `https://` camera PWA URL, for example `https://<machine>.<tailnet>.ts.net/`. Do not commit the real hostname.
- Shared login values are required for wizard sign-in. `TAILSCALE_SHARED_LOGIN_PROVIDER` must be one of `google`, `microsoft`, `apple`, or `github`.
- `TAILSCALE_SHARED_LOGIN_PASSWORD` is preserved exactly. Do not add leading or trailing spaces unless they are part of the real password.
- `TAILSCALE_AUTHKEY` is optional. If set, it must be a Camera Access tailnet key (`tskey-…`), not a home-tailnet key.

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The root page is the connection gateway. Setup remains at [http://localhost:3000/setup](http://localhost:3000/setup).

Useful checks:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Never commit `.env.local` or any file that contains real values.

## Environment variables

| Name | Where it is read | Purpose |
| --- | --- | --- |
| `SETUP_PASSWORD` | Server only | Unlocks the setup portal |
| `SESSION_SECRET` | Server only | Signs the HttpOnly session cookie |
| `CAMERA_URL` | Server only; sent to the `/` gateway and authenticated `/setup` | Private Tailscale Serve URL for the camera PWA and `/healthz` check |
| `TAILSCALE_SHARED_LOGIN_EMAIL` | Server only, after `/setup` login | Shared Camera Access SSO email |
| `TAILSCALE_SHARED_LOGIN_PASSWORD` | Server only, after `/setup` login | Shared SSO password, preserved exactly |
| `TAILSCALE_SHARED_LOGIN_PROVIDER` | Server only, after `/setup` login | `google`, `microsoft`, `apple`, or `github` |
| `TAILSCALE_AUTHKEY` | Server only, after `/setup` login | Optional Camera Access tailnet auth key for the Windows helper |

None of these use `NEXT_PUBLIC_*`. None of them belong in Git. There is no `TAILSCALE_API_KEY` in this pass.

In Vercel:

1. Open the project.
2. Go to **Settings → Environment Variables**.
3. Add the values above for Production, Preview, and Development as needed.
4. Redeploy after any change.

## Production deployment on Vercel

1. Import `mattduff36/homepictures` into Vercel.
2. Select the Next.js framework preset if it is not detected automatically.
3. Add the environment variables.
4. Deploy.
5. Attach the custom domain.
6. Redeploy after environment-variable changes when required.

The gateway is on `main` and deploys on Vercel. The Pi `/healthz` route is already complete.

After a production deploy, open the site and confirm:

- `/` shows the connection gateway, not the password screen.
- `/` does not include shared login details or an auth key.
- Setup instructions and shared credentials appear only after `/setup` login. The password and auth key are not in the first HTML payload; they are loaded from session-gated APIs.
- The document responses for `/` and `/setup` include `Cache-Control: private, no-store`.
- `x-vercel-cache` is not `HIT` or `PRERENDER` for `/`, `/setup`, `/api/login`, `/api/setup/credentials`, or `/api/setup/windows-signin`.
- After **Lock Setup Page**, the browser stays on locked `/setup` and Back does not return you to the unlocked setup page. Setup progress checkmarks remain unless you reset them.
- The unlocked setup page hydrates and works. Another site cannot show this portal in an iframe.

## Changing secrets

### Change `SETUP_PASSWORD`

1. Generate a new password of at least 8 characters.
2. Update `SETUP_PASSWORD` in Vercel.
3. Redeploy.
4. Share the new password with authorised people through a private channel.

Existing sessions stay valid until they expire or you also rotate `SESSION_SECRET`.

### Rotate `SESSION_SECRET`

1. Generate a new secret with `openssl rand -base64 32`.
2. Update `SESSION_SECRET` in Vercel.
3. Redeploy.

This signs all visitors out. Sessions are stateless, so there is no way to revoke one session without rotating the secret.

### Rotate shared Camera Access SSO

1. Change the dedicated provider-account password or passkey.
2. Update `TAILSCALE_SHARED_LOGIN_PASSWORD` and related values in Vercel.
3. Redeploy.
4. Tell remaining family members the new sign-in details through a private channel.

### Replace `TAILSCALE_AUTHKEY`

1. Revoke the old Camera Access tailnet auth key in Tailscale admin.
2. Create a new Camera Access tailnet key if Windows helper sign-in is still required.
3. Update `TAILSCALE_AUTHKEY` in Vercel.
4. Redeploy.

Revoking a key does **not** remove devices that already authenticated with it. Remove those machines separately.

### Replace `CAMERA_URL`

1. Confirm the new HTTPS Tailscale Serve URL.
2. Update `CAMERA_URL` in Vercel.
3. Redeploy.

Do not put the real hostname in this repository.

## Revoke camera access

Family devices appear as separate machines under the same Camera Access user. Deleting one machine does not stop a person who still knows the shared credentials from signing in again.

- Lost, stolen, or replaced phone: remove that individual machine in the Tailscale admin console.
- Person should no longer have camera access: remove their machines and rotate the shared SSO password or passkey.
- Auth key exposed: revoke and rotate `TAILSCALE_AUTHKEY`, and remove machines that used it.
- Portal password exposed: rotate `SETUP_PASSWORD` and `SESSION_SECRET` if needed.
- Full compromise: remove affected machines and rotate the portal password, shared SSO credentials, and auth key.

## Rate-limit limitation

Login attempts are throttled in memory on each serverless instance, about 5 attempts per 15 minutes per client IP. Vercel instances do not share that memory, so this is only a speed bump. It is not a distributed lockout. Tailscale remains the camera boundary.

## Security notes

- Authentication is checked on the server. The session cookie is HttpOnly, host-only, `SameSite=Lax`, and `Secure` in production.
- The gateway, authenticated setup page, and auth API responses use `Cache-Control: private, no-store`.
- `/api/setup/credentials` and `/api/setup/windows-signin` require a valid session. They return generic `401` / `503` errors and never put secrets in URLs, logs, or error bodies.
- The site sends `noindex` metadata and disallows crawlers in `robots.txt`.
- Submitted passwords, environment values, shared credentials, auth keys, and the camera URL are never logged.
- The public `/` page necessarily receives `CAMERA_URL` so the browser can check `/healthz` and then open the cameras. Tailscale still controls who can reach that host.
- Do not commit camera credentials, RTSP URLs, or Raspberry Pi LAN addresses. The Tailscale Serve localhost routes above are the published camera HTTPS surface.

## License

Private family use. The GitHub repository is public, so keep secrets out of Git.
