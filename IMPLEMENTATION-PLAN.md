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
- Owner confirmed the iPhone test on 16 November 2026 and authorised completing Phase 2 using engineering judgment, with a completion email to the connected Gmail account.

## Phase 2 implementation decisions

- Keep the existing successful login and password. Add five Swann cameras and five primary Ring roles; exclude secondary underscore-named Ring devices. Use economical existing SD H.264/Opus sources, bounded wall playback and one audible camera at a time.
- Ring defaults to snapshots. Timed viewing returns to snapshots; Always is an explicit foreground choice with a finite session and explicit continuation. Data Saver overrides live modes. No background battery wakeups or changes to the private app's preferences.
- Strengthen server-side peer ownership and cleanup before wider release. Preserve the original private Vision and recording services; only the new isolated components may restart.
- Keep account administration on the protected Dell/operator path. Do not introduce a new public privileged admin surface or paid database.
- Recording delivery review: the present TURN allowance covers real-time relay traffic, not HTTP recording storage/downloads. Vercel would incur its separate transfer/function usage if used as a video proxy. Therefore keep this release live-first, as planned; existing private recorded playback remains available. No paid recording service, cloud storage migration or public recording proxy is being enabled.
- Rechecked Cloudflare pricing on 16 November: shared 1,000 GB/month Realtime allowance, then $0.05/GB. Normal short viewing should fit the allowance, but concurrent/account-wide usage and lack of a provider hard cap prevent a guarantee of zero cost. No new paid subscriptions or billing settings are authorised by this implementation choice.
- Final acceptance: actual live relay frames for all available cameras, wall load and audio checks, server cleanup/revocation, anonymous access rejection, mobile layout and network/lifecycle tests. Document any unavailable source honestly. Send the owner a summary only after final deployment and verification.

## Phase 2 completed — 16 November 2026

The ten-camera live viewer is deployed at https://cctv.mpdee.uk/watch. Homepictures application commit `d95c45a` is on production Vercel deployment `dpl_2Cb3Tm1bhPsADUXCNrsmM5sXpNXk`; gateway code is Vision `0a2c1758`. The existing owner's password is unchanged, with all ten camera permissions granted. The original private Vision frontend and recording services were not redeployed.

Delivered: all ten permitted cameras, camera groups and solo selection, five-Swann SD wall, one audible camera, fullscreen with iPhone fallback, Home Screen manifest/icons/help, Ring snapshots with age/stale labels, 60-second Timed and finite four-minute Always viewing, Data Saver, explicit reconnect, hidden/offline/logout cleanup, and protected account create/update/enable/disable/revoke/password operations. Ring snapshots refresh only on request; no background camera wakeups or automatic live renewal.

The isolated go2rtc 1.9.14 relay now owns consumers through their gateway WebSockets. An exact-context source patch closes actual Pion peers on disconnect/error; a version handshake refuses the unpatched image before creating a stream. Python gateway heartbeats and an autonomous reaper enforce expiry/revocation. The Linux relay was cross-compiled on the PC and installed as image `mpdee-web-viewer-go2rtc:1.9.14-owned-ws`; its binary SHA256 is `0316b9e8f9d4414ebfaa133f6e0266b1059ceba5bd0dc000dc88af98408a9e79`. Only the new sidecar and gateway restarted.

Verification:

- 118 application tests, typecheck, lint and production build passed. The gateway/media suite passed 37 tests; after the live reconnect correction, all 32 gateway tests passed again (unchanged six media tests retain their pass). The upstream Pion/WS fixture verified normal, racing and invalid-offer cleanup.
- All five Swann cameras played concurrently with advancing decoded frames and incoming audio. All five Ring cameras returned snapshots and played genuine relayed video/audio. Single-audio switching, fullscreen, solo connection reuse, 390px layout and Data Saver stopping Ring live all passed.
- Live offline testing found that a lost Stop could leave a temporary allocation blocking retry. Explicit Watch now replaces only the same session's allocation for that camera, closes its old peer and preserves other sessions. Regression coverage and a real offline/online/reconnect retest passed.
- Ring Timed returned to its snapshot after 58.6 seconds. Remembered sessions, logout, anonymous snapshot denial and cross-origin rejection passed. A separate browser test left its peer open: both explicit server Stop and heartbeat expiry stopped incoming bytes, proving server-side media cessation independently of client cleanup.
- Final audit: no viewer leases or Ring sessions remained; private/Funnel routing matched the saved baseline exactly; Frigate was healthy, with all five recording inputs at 5.1 fps and zero skipped frames. The new relay was idle at 0% CPU and approximately 43 MiB memory. The five-Swann sample measured 2.56 Mbps video plus audio; this is a short nighttime observation, not a usage guarantee.

Evidence is retained outside Git in `D:/_storage/Codex-Documents/2026-11-16/camera-web-access`: `phase2-live-report.json` records all-camera successes and the initial reconnect failure; `reconnect-timed-report.json` records the corrected network/timer/session pass; `server-lifetime-report.json` records server enforcement. Private screenshots and credentials remain excluded from Git and email. Physical iPhone pilot acceptance came from the owner; the expanded release was checked in a real browser at desktop/mobile sizes, not on an unattended physical iPhone.

Cost/scope: no additional subscription or database was added. Cloudflare's approved shared free allowance and overage terms remain unchanged. This is the completed live-first release; recorded playback remains in the existing private system. No public HTTP recording delivery or cloud recording storage was enabled. Issued TURN credentials remain time-limited but cannot be recalled individually, and the service is not a provider-enforced spending cap.

Rollback artifacts are root-private at `/var/backups/mpdee-web-viewer/phase1-20261116` (runtime/config/unit, consistent database copy and routing). Restore the matching pilot backend/database/sidecar and pilot Vercel deployment together if reverting the protocol. Do not restart or alter the primary Vision/Frigate services.
