# Offline fallback

After one successful online visit in a browser that supports service workers and CacheStorage, MPDEE Vision can show a small recovery page when a full navigation to `/`, `/watch` or `/setup` cannot reach the website. The page has **Try again** and **Private access setup** links. It has no JavaScript, analytics, account information or camera display. Coming back online does not reload the page or resume a camera automatically; Try again returns to the normal viewer and its existing sign-in/startup policy.

The worker also uses this page for gateway 502/503/504 responses and a navigation response-header timeout of ten seconds. Other HTTP responses, including authentication errors, redirects, 404 and application 500 recovery pages, pass through unchanged. Client-side React navigation and data requests retain the application's existing error handling.

## Exact cache boundary

`public/offline-worker.js` writes only these three fixed public files during installation:

- `/offline.html`: generic static recovery copy and links.
- `/offline.css`: its styling, including mobile safe areas and keyboard focus.
- `/icon.svg`: the public website icon.

Installation fetches omit credentials, bypass the HTTP cache and reject redirects or unexpected content types. All files must be fetched successfully before cache writes begin. No viewer page, API response, username, session, cookie, diagnostic report, snapshot, audio or video is added to CacheStorage. There is no runtime cache write. Non-GET, API, media, cross-origin and RSC requests are left to the browser. The only cache reads outside a failed document navigation are the same three exact asset paths without query strings.

The worker's own script uses no-store headers and updateViaCache none. Registration happens after page load and does not delay the viewer. Installation/activation does not reload a page or start a camera. Old caches are removed only within the `mpdee-vision-offline-` prefix; unrelated caches are preserved. The static recovery document has a separate script-free CSP; authenticated pages retain nonce-based CSP and add only an explicit same-origin worker allowance.

## Limits and maintenance

The first-ever visit still needs a connection. Browser settings, private browsing, cleared site data, browser eviction or unsupported service workers can prevent an offline page. A minimal recovery page remains available if the worker runs but its cache is missing. Camera viewing and sign-in always require a working connection. This feature adds no external uptime monitor or notification schedule.

Bump `CACHE_NAME` in `public/offline-worker.js` when changing any of the three cached files. The new worker installs the complete public cache before activation; the previous version remains available if installation fails. Keep the cache list narrow.

For an intentional full removal, do not simply delete the worker URL: installed workers can survive a code rollback. Remove the registration component and temporarily serve a retirement worker at the same `/offline-worker.js` URL, retaining its no-store headers. Its install handler should call `skipWaiting`; its activate handler should delete only this feature's cache prefix and unregister itself. It should have no fetch handler and should never navigate/reload clients. Keep that retirement response available for returning browsers, and update the focused tests for the intended retirement. A previous functional worker version can otherwise be restored with a new cache version without touching accounts or camera services.

## Checks

`npm test` includes the real worker script in a VM fixture to check the cache allowlist, credential omission, excluded requests, failure/timeout fallback, explicit retry, cache eviction and scoped cleanup. `npm run test:browser` adds a real installed-worker test: online visit, new tab while offline, styled fallback, unchanged cache contents, restored connectivity and explicit Retry. Engines without a service-worker API are explicitly reported as unsupported by that test.

For real iPhone Safari acceptance, open the website online once, wait a few seconds, turn off both Wi-Fi and mobile data, then reload or reopen the website. The recovery page should appear. Restore connectivity: it should remain until Try again is tapped. Verify normal sign-in/viewing returns. Repeat in the Home Screen app if that is how the site is used; visit online in that mode first. Do not clear site data between the online visit and offline test.

The owner intentionally took Shed and Back Door offline for other testing. Exclude both from live-camera acceptance until the owner says they are available again.
