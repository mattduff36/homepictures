# Password-protected web camera access

Date: 16 November 2026. Owner authorised implementation and publication of a single-camera test, with an explicit stop for iPhone confirmation before expanding.

## Findings and architecture

- homepictures is the existing Next.js/Vercel portal at cctv.mpdee.uk. Its setup cookie protects instructions, not cameras; do not reuse that cookie as viewing authority.
- Dell currently serves Vision v372 (a9002b93), five Swann bridges and healthy Frigate. Local mpdee-vision has valuable concurrent changes and an older HEAD; preserve these.
- Existing production go2rtc 1.9.14 restricts HTTP endpoints and uses private LAN/Tailscale candidates. Avoid restarting or widening this instance.
- mpdee.uk uses IONOS nameservers. Avoid DNS migration. Use an isolated Tailscale Funnel on HTTPS port 10000 for authenticated server-to-server JSON signalling only. Keep existing private Serve 443/9443/9444 unchanged. This requires Funnel entitlement; verify before activation. No iPhone Tailscale client.
- Run a separate go2rtc sidecar using the already-installed image, consuming the existing Back Garden SD+audio RTSP alias. No new direct camera connection, encoder or recording configuration changes. Publish its HTTP API only to loopback; the gateway exposes no generic proxy.
- homepictures handles the UI and same-origin requests. A loopback Dell gateway authenticates signed Vercel requests, verifies individual viewer credentials/sessions, and permits only the selected camera.
- Browser WebRTC uses short-lived Cloudflare Realtime TURN credentials and relay-only ICE for the pilot. Video never traverses Vercel or Funnel. Prove this from the selected ICE candidate, decoded frames and audio counters, not page load.
- Cloudflare Realtime activation was completed by the owner during this task. The checkout states $0/month base, 1,000 GB included, and $0.05/GB overage; it requires a payment method and explicit overage agreement. TURN credentials are provisioned and were verified with a successful temporary-credential request. No provider-enforced zero-spend cap is established.

## Phase 1: single-camera pilot

1. Capture existing runtime/service baseline and private Serve configuration. Inspect account access and provider requirements. Preserve original routes and current viewing/recordings.
2. Implement /watch with a simple individual username/password sign-in, remembered secure HttpOnly session, one Back Garden video, muted startup, explicit sound button, Stop and Retry. Existing /setup remains available. Root should prominently offer the pilot without forcing existing private viewers away.
3. Implement a narrowly scoped Dell gateway: HMAC body/timestamp/nonce verification; replay protection; bounded JSON; fixed upstream and camera mapping; persistent login/issuance limits; password hashes; per-user revocable sessions; fail closed on absent configuration; generic errors without secrets. Reject setup cookies, arbitrary URLs/camera aliases and unexpected fields.
4. Implement Vercel routes for login/logout/session/config/offer; require viewer session plus same-origin checks where applicable, no-store responses, bounded upstream timeouts, no secret or SDP logging. TURN master key stays server-side; return only expiring credentials after Dell authorisation. No camera/microphone capture permission is requested.
5. Limit pilot viewing to 15 minutes per connection and stop on hidden/page-exit/logout; make restart explicit. Limit issued sessions and offers server-side. Explain that app-side controls are not provider-enforced billing caps. No paid upgrades or auto-reload.
6. Add offline security and protocol tests, frontend lifecycle checks, typecheck/lint/build. Review the actual auth boundary before exposure. Test failures, expired/revoked sessions, malformed/oversized offers, replay, disallowed camera, no config, stop/retry and hidden-tab cleanup.
7. Install only the isolated gateway and media sidecar with restrictive permissions and backups. Provision a single owner viewer account privately; never commit credentials. Enable Funnel only to the authenticated gateway. Configure production Vercel secrets and deploy the reviewed candidate.
8. Verify anonymous requests cannot obtain video/relay credentials and public requests cannot reach camera/admin APIs. Verify actual relayed video/audio, no ongoing stream after stop, bounded resource usage, unchanged original camera app and Frigate health.
9. Send the owner the live /watch link and concise iPhone mobile-data test instructions with Tailscale off. **Stop expansion until the owner explicitly confirms it works.**

## Phase 2: after owner confirmation only

1. Resolve actual iPhone feedback; confirm Wi-Fi/mobile switching and reconnect behaviour.
2. Extend server-side camera permissions and viewer to five Swann cameras, selectable camera/fullscreen and economical wall streams, with bounded simultaneous playback and shared upstreams.
3. Integrate the five Ring roles through a separately allowlisted bridge adapter; preserve battery-saving Snapshot/Timed/Always policy and genuine live-frame status. Do not expose settings, sirens, debug or machine controls by default.
4. Complete individual account enable/revoke administration, session expiry/revocation and logout behaviour. Keep durable limits on Dell, no paid database required.
5. Reuse approved MPDEE Vision viewing behaviour where practical; avoid copying the entire privileged private app into the public portal. Provide optional Add to Home Screen guidance and clear offline/unavailable states.
6. Research/test recorded playback delivery separately: TURN pricing does not cover HTTP recording downloads. Prefer live-first scope; do not quietly proxy large recording files through Vercel/Funnel or ordinary Cloudflare CDN. Report any additional provider/cost decision before enabling it.
7. Check combined-camera bandwidth and Dell load, verify authorised/unauthorised paths and mobile lifecycle, then release the completed viewer and document the final scope and limits.

## Cost and acceptance

Target: zero additional recurring charges within existing Vercel allowance and Cloudflare's shared 1,000 GB/month Realtime allowance. Excess Realtime egress is currently $0.05/GB; verify account-wide usage and available spend controls. Existing domain, broadband and electricity remain. No guarantee of provider-enforced zero cost without confirmed hard limits. No new paid service without owner decision.

Sources: https://developers.cloudflare.com/realtime/sfu/platform/pricing/ ; https://developers.cloudflare.com/realtime/turn/generate-credentials/ ; https://tailscale.com/docs/reference/tailscale-cli/funnel ; go2rtc v1.9.14 internal/webrtc/server.go.

Rollback: disable only Funnel port 10000; stop/remove only the new gateway/sidecar; restore previous Vercel deployment. Existing private Serve routes, primary Vision instance, cameras and recordings remain untouched.

## Pilot release checkpoint

- 16 November 2026: Back Garden pilot deployed at https://cctv.mpdee.uk/watch. Application release 077fc78, Vercel deployment dpl_BV1Q8GTzBtKTREKWGGVWVXcdf1Pw. Gateway and sidecar are installed separately on the Dell; Funnel 10000 is enabled only for signed signalling. Existing private routes were preserved and Frigate remained healthy.
- Offline acceptance: 109 frontend/server tests, 22 Python gateway tests, lint, typecheck and build passed. Live testing found optional TURN transports could remain gathering after relay candidates arrived; bounded fallback and max-bundle fixed startup, with 14 focused player tests and typecheck passing afterward.
- Live browser acceptance confirmed denied anonymous/cross-origin access, individual login, selected relay candidate, decoded 640x360 video, incoming audio packets, sound toggle, mobile layout without overflow, Stop closing the peer, remembered session and logout. This does not substitute for physical iPhone audio/mobile-network acceptance.
- Protected operator credentials and redacted live-test evidence are outside Git at D:/_storage/Codex-Documents/2026-11-16/camera-web-access. Passwords, tokens, SDP and private camera screenshots are excluded from the repositories.
- The 15-minute limit is enforced by the normal client. Issuance limits and revocation prevent further authorisation, but the go2rtc JSON exchange does not provide a handle to force-close an already established malicious peer. This is not a hard billing cap; revisit server-controlled termination before expanding access.
- **Awaiting owner iPhone confirmation. Phase 2 has not started.**
