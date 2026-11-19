# Website reliability and incident handling

This covers `cctv.mpdee.uk` (`homepictures`), not the Dell's private camera UI or recording services.
It adds no camera start, reconnect loop, third-party monitoring service or public administration role.

## What a viewer sees

- Expected sign-in rejection, expired sessions, service limits, manual Stop and cancellation retain their normal messages. They are not crash incidents.
- Viewer requests have a 20-second deadline, including response-body parsing. Setup sign-in/lock requests have a 15-second browser deadline and setup body reads have a five-second server deadline.
- A failed initial saved-sign-in check offers **Check saved sign-in again** without another password attempt. Saved sign-ins have an explicit retry button.
- Network, timeout, unreadable response and unavailable gateway errors use fixed safe wording. Unexpected exception messages never become UI copy. Where available, a reference joins the message to a diagnostic record.
- App/page render errors show Try again, Reload page, Open cameras and Private access setup. A root-layout error has its own fallback. A camera render boundary unmounts only that tile: its existing unregister cleanup stops its peer/tracks and releases its lease; the other tiles remain mounted.
- Unexpected asynchronous browser errors show a dismissible recovery notice. Reload is always an explicit user action.
- Unsupported WebRTC is detected before requesting a lease. Available snapshots and navigation remain usable.
- Missing pages and loading states have useful return paths. JavaScript-disabled browsers receive an explanatory message. After a successful online visit, a supported browser can show a script-free offline recovery page on a later full navigation, with explicit Retry. It caches only three public fallback assets; see [OFFLINE.md](OFFLINE.md) for exact bounds and first-visit/browser limitations.

Camera policies are unchanged: Swann starts once after authentication; Ring live requires fullscreen and explicit Play; hidden/offline/Stop/expired leases require explicit resume. Do not label an intentional camera outage as a fault needing repair. The owner confirmed both Shed and Back Door were intentionally offline for separate testing.

Switching to the Ring wall retains only already-active Swann peers and leases for up to twenty seconds. Swann audio is muted while held. A return within that period resumes the same mounted media elements without new config/offer requests; staying longer releases the held streams, and returning then requires Play or Start wall. A deadline check also handles delayed timer callbacks. While held, only the decoded-frame stall check is suspended because hidden video can stop decoding; normal connection failures, startup/authorization deadlines and playback/lease limits still apply. Page hide, offline, sign-out, Stop and opening Ring fullscreen cancel the hold immediately. Ring wall selection cancels queued Swann starts and never starts a new stream. An old timer cannot close a replacement player or a newer session.

The burger menu has no visible title row or close X. Its accessible dialog name remains Vision menu; Escape, a tap outside, or selecting an action closes it.

The camera overlay actions hide after three idle seconds. The first touch restores them without opening a camera or requesting live viewing; subsequent touches work normally. Keyboard focus, an open menu/settings/saved-sign-in dialog, and a held pointer keep controls available. Activity restores the overlays. Passive badge backgrounds and borders fade after ten idle seconds, retaining white text and a contrast shadow; recording indicators and error messages remain visible. Large camera Play controls use an accessible circular icon with a transparent triangle.

The document, camera wall, fullscreen camera and startup layer share the same large viewport height (`100lvh`), with percentage fallback for older browsers. This matches the live Dell v409 frontend and its physically accepted v205 sizing fix: stretching only the wall inside shorter html/body or splash layers can leave a bottom strip or clip the final row. The camera canvas has no safe-area padding. Only camera overlays use the actual cell distance from each screen edge and CSS safe-area insets, so interior cells do not acquire unnecessary notch padding. Insets are remeasured after layout/resize/pageshow, without a polling loop or camera restart. Desktop/WebKit layout fixtures are not proof of a physical iPhone Home Screen launch: confirm a cold portrait launch before rotating when accepting sizing changes.

Start wall is available only in the burger menu. During development, **Reload App** in that menu stops this viewer's streams and performs a full document navigation with a fresh `_reload` query value. It retains the current path and other query parameters, saved sign-in and local preferences. It does not clear browser storage or unregister the offline worker: the worker never caches the app HTML/API/media, navigation fetches use `no-store`, and new releases have content-hashed JS/CSS. A successful reload runs the normal startup policy; Ring still requires explicit Play. A fresh navigation also checks the offline worker for updates through the existing registration.

The iOS `apple-mobile-web-app-status-bar-style` tag uses `black-translucent`, matching the Dell app, so the camera image can extend behind the status bar. Capability/title metadata, the standalone manifest and `viewport-fit=cover` remain. The owner confirmed that the earlier omission removed the bottom strip but reserved an opaque status-bar area above the cameras; it did not satisfy the edge-to-edge image requirement. Restoring the overlay is paired with the consistent document/wall/startup sizing above, rather than restoring the previous short fixed-inset canvas. Do not use physical `screen.height` or manually subtract status-bar pixels. [Apple's meta-tag reference](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariHTMLRef/Articles/MetaTags.html) describes the overlay behavior; WebKit [316008](https://bugs.webkit.org/show_bug.cgi?id=316008) records installation-time differences, and [313800](https://bugs.webkit.org/show_bug.cgi?id=313800) records a related native viewport limitation. Existing Home Screen icons can retain installation-time settings: check a cold portrait launch and landscape-to-portrait return; if the top remains opaque, remove the Home Screen app and add it again from Safari, then sign in. Browser automation verifies markup and page geometry, not the native iOS shell. Require physical confirmation that camera pixels cover the top and bottom while controls remain inset.

## Event path and privacy

`instrumentation-client.ts`, React boundaries and controlled request/player failures create a closed-schema event. The browser sends up to five events (at most 16 KiB) to same-origin POST `/api/diagnostics`. The server validates exact fields and reconstructs source, receipt timestamp, release and severity. Client trace IDs are discarded. Same-origin checks are not a claim of trusted identity: these reports remain untrusted operational observations.

The website signs a separate POST `/v1/diagnostics` using the existing website-to-Dell HMAC contract. It sends no viewer session or password. The Dell gateway acknowledges with `200 {"ok":true}` only after its dedicated SQLite ledger commits. Browser diagnostics can therefore work before login. There is no public read, resolve or administration endpoint. The camera account named `admin` has no special website authority.

Server failures first emit one JSON console record:

```json
{"event":"website_incident","incident":{"version":1}}
```

The real `incident` object contains the complete validated schema from `lib/diagnostics.ts`; the abbreviated example is explanatory, not an importable event. Next.js `after()` then attempts delivery without delaying the camera response. Caught viewer server failures return `X-Vision-Error-Reference`; the client retains it. Existing detailed gateway transport logs remain available for correlation using the signed request nonce (`traceId`).

Records contain only an opaque event ID, time, source, fixed code/operation/page, warning/error severity, numeric status, allowlisted camera ID, allowlisted exception class, a known code basename with line/column when safely available, release commit, and safe references. No username, password, cookie, token, SDP, ICE credential, image, arbitrary URL, query, request/response body or exception message/stack is stored. Full source maps and raw browser stacks are not uploaded.

## Bounds and outage behaviour

- Browser: memory-only queue of 20; batches of five; same-fingerprint deduplication for 60 seconds; at most three delivery attempts per event; five-second transport deadline; records older than ten minutes expire. Pending events wait while offline. No localStorage, IndexedDB, cookies or media cache is used for diagnostics.
- Collector: per-process source allowance 12 batches/minute; global allowance 120 batches/minute; at most 256 source buckets. Only Vercel's overwritten trusted address header contributes to the hashed in-memory key. Raw addresses are not included in incident records. The gateway adds its own persistent ingress limits.
- Server reporter: fingerprint deduplication for 15 seconds, 256 cached fingerprints and at most 60 new reports/minute/process. Identical failures reuse their earlier reference. The diagnostic sink has a 30-second circuit breaker after a failed request/acknowledgement. None of these limits alters camera requests.
- Dell ledger: up to 1,000 grouped issues, 10,000 idempotency IDs and 20 lifecycle history entries per issue. Resolved issues expire after 30 days since both last occurrence and resolution. Open issues are retained; at capacity, the oldest resolved issue is removed first. New groups are rejected if all retained issues remain open.

Counts are **recorded, sampled occurrences**, not an exact count of every failure. During a Dell outage, the safe website record remains in Vercel runtime logs, while the browser retains a bounded retry queue. The memory queue disappears on page close; repeated failures, capacity limits and platform log retention can lose evidence. This is deliberately bounded best-effort reporting, not a lossless audit log. Logging failure does not prevent viewing or recovery.

## Owner review and resolution

On the Dell, use the local CLI (sudo is for the existing state-file ownership):

```sh
sudo /opt/mpdee-web-viewer/venv/bin/python -B /opt/mpdee-web-viewer/diagnostics.py --database /var/lib/mpdee-web-viewer/diagnostics.sqlite3 list --status open --limit 100
sudo /opt/mpdee-web-viewer/venv/bin/python -B /opt/mpdee-web-viewer/diagnostics.py --database /var/lib/mpdee-web-viewer/diagnostics.sqlite3 show ID
sudo /opt/mpdee-web-viewer/venv/bin/python -B /opt/mpdee-web-viewer/diagnostics.py --database /var/lib/mpdee-web-viewer/diagnostics.sqlite3 resolve ID --note 'Fixed in COMMIT; verified the failing operation and recovery'
sudo /opt/mpdee-web-viewer/venv/bin/python -B /opt/mpdee-web-viewer/diagnostics.py --database /var/lib/mpdee-web-viewer/diagnostics.sqlite3 reopen ID --note 'Further investigation required'
```

`ID` can be the 24-hex issue ID or the full 32-hex reference shown to the viewer. Resolution records a note and history; a new occurrence reopens the group. Expected service limits or a deliberately offline camera are not reasons to change camera policy or weaken authentication. When fixing a real issue, retain the relevant release/reference, change the failing behaviour, verify the specific recovery and record the result. Improved diagnostics alone should be described honestly if the cause remains unconfirmed.

To recover safe console events after an outage, privately export the relevant Vercel runtime JSON records and import them locally:

```sh
sudo /opt/mpdee-web-viewer/venv/bin/python -B /opt/mpdee-web-viewer/diagnostics.py --database /var/lib/mpdee-web-viewer/diagnostics.sqlite3 import /private/safe-export.jsonl
```

The importer accepts `website_incident` JSON lines or Vercel records whose `message` contains that JSON, validates the schema again, and deduplicates event IDs. Limits are 32 MiB/50,000 lines. Export only relevant diagnostic records; do not import an arbitrary credential-bearing log dump.

## Verification and rollout

Run `npm run check:release`, then `npm run test:browser` for browser behaviour changes. The release command runs TypeScript, lint, the full unit suite and a production build; GitHub and Vercel source builds run it automatically as described in [RELEASE-CHECKS.md](RELEASE-CHECKS.md). Browser tests use local mocked APIs and deliberate failures; they never start real cameras or weaken production CSP/authentication. The old wall UI fixture explicitly supplies absent Windows WebKit capability because it tests a mocked config-failure path. The separate unsupported-browser case proves that a real missing capability allocates no cameras. Neither is proof of physical iPhone live playback.

The companion gateway must provide `/v1/diagnostics` before expecting durable delivery. If website and gateway releases temporarily differ, console fallback and bounded retries continue safely. Deploy/revert only the website and isolated website gateway components; do not restart Frigate, Neolink, the private viewer or recording services for this change. The gateway ledger is separate from accounts/security state and should be retained across code rollback.
