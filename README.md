# Home Camera Access

Public onboarding portal for authorised friends and family. It first checks whether the browser can already reach the private camera server. If not, it helps someone install Tailscale, accept camera access, and open the private camera app.

This site does **not** host or proxy camera streams or health checks. The cameras stay private behind Tailscale. This repository is public, so treat every committed file as readable by anyone.

User flow:

1. `https://cctv.mpdee.uk/` tests whether the visitor's browser can reach the private CCTV server.
2. If `/healthz` is reachable, the browser opens the private camera URL after a short countdown.
3. If the check fails, is cancelled, or `CAMERA_URL` is missing, the visitor is sent to `/setup`.
4. `/setup` is the password-protected Tailscale onboarding page.

`/healthz` lives on the Raspberry Pi camera web server, not on this Vercel site. It should return an empty success response (`204` preferred), `Cache-Control: no-store`, and a CORS allow-list limited to `https://cctv.mpdee.uk`. It must not include camera, version, hostname, or authentication data. It exists only so the browser can detect Tailscale reachability. The camera hostname is still protected by Tailscale; the machine-share URL remains behind the portal password.

There are two security layers:

1. **Setup portal password.** `SETUP_PASSWORD` hides the setup instructions and the capability links on `/setup`.
2. **Tailscale.** This is the real access-control boundary for the cameras. Discovering the private camera URL is not enough. The visitor still needs authorised Tailscale access.

The public gateway at `/` necessarily receives `CAMERA_URL` so it can test and then navigate to the camera server. It does **not** receive `TAILSCALE_SHARE_URL`.

The portal password cannot bypass Tailscale. If the portal is compromised, an attacker may still obtain the Tailscale share link. Treat that link like a password. Revoke it and any accepted shares immediately.

## Windows camera installer

Windows visitors who do not already have Tailscale can download a public, auditable script:

`/Install-CCTV-Tailscale.ps1`

On a PC where Tailscale is not installed, the script downloads the current stable official installer from `https://pkgs.tailscale.com/stable/`, checks the published SHA-256 hash, requires a valid Authenticode signature from Tailscale Inc., then writes camera-safe machine policies. It does not use an auth key and does not sign the person in.

If Tailscale is already installed, or if `HKLM\SOFTWARE\Policies\Tailscale` already has policy values, the script makes no changes.

The script contains no `SETUP_PASSWORD`, session secret, share link, camera URL, or Tailscale auth key. Those stay on the server and are only shown after portal login.

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
TAILSCALE_SHARE_URL=
CAMERA_URL=
```

Rules:

- `SETUP_PASSWORD` must be at least 16 characters. Use a randomly generated value.
- `SESSION_SECRET` must be at least 32 bytes. `openssl rand -base64 32` is enough.
- `TAILSCALE_SHARE_URL` must be an `https://` **machine-share** link created from Tailscale → Machines → the camera host → Share. Do not use Users → Invite external users. A user invite can grant tailnet membership, which is more access than this portal should offer.
- `CAMERA_URL` must be the private `https://` camera PWA URL, for example `https://<machine>.<tailnet>.ts.net/`. Do not commit the real hostname.

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
| `TAILSCALE_SHARE_URL` | Server only, after `/setup` login | Capability link that adds the camera server |
| `CAMERA_URL` | Server only; sent to the `/` gateway | Private Tailscale Serve URL for the camera PWA and `/healthz` check |

None of these use `NEXT_PUBLIC_*`. None of them belong in Git.

In Vercel:

1. Open the project.
2. Go to **Settings → Environment Variables**.
3. Add all four values for Production, Preview, and Development as needed.
4. Redeploy after any change.

## Production deployment on Vercel

1. Import `mattduff36/homepictures` into Vercel.
2. Select the Next.js framework preset if it is not detected automatically.
3. Add the four environment variables.
4. Deploy.
5. Attach the custom domain.
6. Redeploy after environment-variable changes when required.

After the first production deploy, open the site and confirm:

- `/` shows the connection gateway, not the password screen.
- `/` does not include the Tailscale share URL.
- Setup instructions and the share URL appear only on `/setup` after login.
- The document responses for `/` and `/setup` include `Cache-Control: private, no-store`.
- `x-vercel-cache` is not `HIT` or `PRERENDER` for `/`, `/setup`, or `/api/login`.
- After **Lock Setup Page**, the browser stays on locked `/setup` and Back does not return you to the unlocked setup page. Setup progress checkmarks remain unless you reset them.
- The unlocked setup page hydrates and works. Another site cannot show this portal in an iframe.

## Changing secrets

### Change `SETUP_PASSWORD`

1. Generate a new random password of at least 16 characters.
2. Update `SETUP_PASSWORD` in Vercel.
3. Redeploy.
4. Share the new password with authorised people through a private channel.

Existing sessions stay valid until they expire or you also rotate `SESSION_SECRET`.

### Rotate `SESSION_SECRET`

1. Generate a new secret with `openssl rand -base64 32`.
2. Update `SESSION_SECRET` in Vercel.
3. Redeploy.

This signs all visitors out. Sessions are stateless, so there is no way to revoke one session without rotating the secret.

### Replace `TAILSCALE_SHARE_URL`

1. Create a new machine-share link from the camera host only. Do not invite the person as a tailnet user.
2. Prefer a recipient-specific or single-use link when Tailscale offers one.
3. Update `TAILSCALE_SHARE_URL` in Vercel.
4. Redeploy.
5. Revoke the old unused invitation link.

Replacing the URL does not remove access that was already accepted. The shared portal password also cannot identify who logged in, provide an audit trail, or revoke one person without changing the password for everyone.

### Replace `CAMERA_URL`

1. Confirm the new HTTPS Tailscale Serve URL.
2. Update `CAMERA_URL` in Vercel.
3. Redeploy.

Do not put the real hostname in this repository.

## Revoke camera access in Tailscale

Do this if a device is lost, a person should no longer have access, or the portal password may have leaked.

1. Revoke every accepted machine share for that person or device.
2. Revoke unused invitation or share links.
3. Review the Raspberry Pi Tailscale policy so shared recipients can reach only the camera HTTPS service. Deny SSH, administration interfaces, and any other listener.
4. Confirm from a recipient Tailscale account that the camera page works and that unrelated ports fail.
5. Rotate `SETUP_PASSWORD` and `SESSION_SECRET` if the portal may have been exposed.

## Tailscale policy

Machine sharing can expose more than the camera page. Restrict shared recipients to the intended HTTPS service and port. Before inviting family members, sign in from a recipient Tailscale account and confirm:

- The camera HTTPS page opens.
- SSH and every unrelated Pi or administration port fail.
- Revoking the share removes access.

Do this recipient check before you hand out the portal password.

## Rate-limit limitation

Login attempts are throttled in memory on each serverless instance, about 5 attempts per 15 minutes per client IP. Vercel instances do not share that memory, so this is only a speed bump. It is not a distributed lockout. Tailscale remains the camera boundary.

## Security notes

- Authentication is checked on the server. The session cookie is HttpOnly, host-only, `SameSite=Lax`, and `Secure` in production.
- The gateway, authenticated setup page, and auth API responses use `Cache-Control: private, no-store`.
- The site sends `noindex` metadata and disallows crawlers in `robots.txt`.
- Submitted passwords, environment values, Tailscale share URLs, and the camera URL are never logged.
- The public `/` page necessarily receives `CAMERA_URL` so the browser can check `/healthz` and then open the cameras. Tailscale still controls who can reach that host.
- After `/setup` login, the browser also receives the Tailscale share URL so the Connect Camera Access button can work. Keep the portal password private.
- Do not commit camera credentials, RTSP URLs, Raspberry Pi LAN addresses, or internal ports.

## License

Private family use. The GitHub repository is public, so keep secrets out of Git.
