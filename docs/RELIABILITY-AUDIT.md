# CCTV website reliability audit — 19 November 2026

Baseline: `homepictures` commit `4bdbe0a`, fetched `origin/main`. The public website is distinct from the Dell private MPDEE Vision application. Source inspection establishes implementation, not current live deployment or physical-device acceptance.

## Existing foundations

The viewer already had finite leases, 20-second requests, a 35-second connection deadline, frozen-frame detection, independent camera players, safe session expiry, explicit resume after offline/hidden/Stop, snapshot ages, one audio source, guarded preference storage, loading/empty states, reduced motion and substantial player/protocol tests. Keep these behaviours.

## Findings and disposition

| Priority | Baseline finding | Action in this change / remaining work |
| --- | --- | --- |
| High | No app/global/per-camera React recovery boundaries | Added app/global fallbacks and tile isolation with explicit recovery and references. |
| High | Transport logs existed but no durable grouped incident workflow | Added a fixed-schema client/server report path to the isolated gateway's dedicated ledger and local review/resolve/reopen/import CLI. |
| High | No broad browser exception/unhandled-rejection capture | Added early instrumentation and a dismissible runtime notice. |
| High | Setup login and lock requests could remain pending indefinitely | Added finite browser/server deadlines and cancellation; failed lock remains explicitly unconfirmed. |
| Medium | Raw browser exception messages could become UI messages | Normalized viewer network/timeout/JSON failures and retained safe server references. |
| Medium | Transient initial session failure encouraged a fresh login | Added an explicit retry of the saved sign-in. |
| Medium | Saved-sign-in list failure required closing/reopening | Added a retry control. |
| Medium | Missing WebRTC discovered only after obtaining a lease | Added capability preflight before allocation, preserving snapshots/navigation. |
| Medium | Failure-path browser coverage absent | Added request, telemetry, unsupported-browser and real React-render failure scenarios without production fault switches. |
| Lower | Default framework loading/404 only; no JavaScript-disabled explanation | Added lightweight branded screens and a no-JavaScript explanation. |
| Lower | Fullscreen focus trap omitted volume input | Included enabled form controls and excluded hidden elements. |
| Lower | No repository CI test workflow found | Remains a suggested follow-up: run existing type/lint/tests/build on changes. This change adds reproducible focused commands but no unrelated CI provisioning. |
| Lower | No website-specific public health/uptime check | Remains optional. A no-secrets website health check would prove HTTP availability only, not moving camera video. Existing gateway diagnostics remain useful. |
| Optional | No offline app shell/service worker | Remains optional. Do not cache authentication, camera APIs or media. Loaded-page offline recovery already exists. |
| Device acceptance | Windows WebKit does not establish physical Safari WebRTC support | Verify an actual iPhone on mobile data for live video/audio when convenient; mocked browser tests cannot replace that check. |

Current incident limitations and the exact owner workflow are in [RELIABILITY.md](RELIABILITY.md). Intentional Shed downtime during another task is expected; no camera source or recording changes are part of this work.

## Release verification

- TypeScript checking, ESLint, all 151 unit tests and the production Next.js build passed on the installed project toolchain.
- All 14 distinct Chromium/WebKit browser scenarios passed. The initial run exposed an HTTP 200 streaming redirect caused by a root loading boundary. Moving loading boundaries to `/watch` and `/setup` preserved the established root HTTP 307; all three affected WebKit wall/sign-in scenarios passed on the rebuilt candidate. The existing redirect assertions were retained.
- Failure scenarios include a saved-session retry without another password attempt or live allocation, browser exceptions and rejected promises with an unavailable logger, unsupported WebRTC without a camera allocation, and a real React render exception followed by recovery.
- Gateway/ledger checks use temporary databases and local fake transports. Production acceptance separately checks the actual browser-to-ledger path and the resolve/recurrence workflow without signing in or starting any camera. Live release evidence is recorded in the companion Vision project's current status.
