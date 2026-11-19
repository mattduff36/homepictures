import {test, expect, type Route} from "@playwright/test";

test("a previously visited browser can open offline, keeps only public assets and retries explicitly", async ({page, context}, testInfo) => {
  // The isolated HTTP fixture removes only the production HTTPS upgrade.
  const stripHttpsUpgrade = async (route: Route) => {
    const response = await route.fetch(); const headers = response.headers();
    headers["content-security-policy"] = (headers["content-security-policy"] ?? "").replace(/upgrade-insecure-requests;?/g, "");
    await route.fulfill({response, headers});
  };
  await context.route("**/watch", stripHttpsUpgrade);
  await context.route("**/api/viewer/session", route => route.fulfill({status:401, json:{error:"PRIVATE-SESSION-FIXTURE"}}));
  await context.route("**/api/diagnostics", route => route.fulfill({json:{ok:true}}));
  await page.goto("/watch");
  await expect(page.getByRole("heading", {name:"Sign in to Vision"})).toBeVisible();
  test.skip(!await page.evaluate(() => "serviceWorker" in navigator), "This engine lacks service workers; physical Safari acceptance is separate.");
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? ""), {timeout:15000}).toContain("/offline-worker.js");
  const entries = await page.evaluate(async () => {
    const names = await caches.keys();
    return Promise.all(names.flatMap(name => name.startsWith("mpdee-vision-offline-") ? [name] : [])
      .map(async name => ({name, paths:(await (await caches.open(name)).keys()).map(request => new URL(request.url).pathname).sort()})));
  });
  expect(entries).toHaveLength(1);
  expect(entries[0].paths).toEqual(["/icon.svg", "/offline.css", "/offline.html"]);
  const html = await page.evaluate(async name => (await (await caches.open(name)).match("/offline.html"))!.text(), entries[0].name);
  expect(html).not.toContain("PRIVATE-SESSION-FIXTURE");
  expect(html).not.toContain("<script");

  // route.fetch uses a separate API context and would bypass simulated offline.
  // Remove the HTTP-only header fixture so the worker sees a real network failure.
  await context.unroute("**/watch", stripHttpsUpgrade);
  await context.setOffline(true);
  // A new tab proves offline entry without retaining an already rendered app.
  const offline = await context.newPage();
  const response = await offline.goto("/watch");
  expect(response?.status()).toBe(503);
  expect(response?.headers()["x-vision-offline"]).toBe("1");
  await expect(offline.getByRole("heading", {name:"Vision is unavailable"})).toBeVisible();
  await expect(offline.getByRole("link", {name:"Try again"})).toHaveAttribute("href", "/watch");
  await expect(offline.getByRole("link", {name:"Private access setup"})).toHaveAttribute("href", "/setup");
  expect(await offline.locator("html").evaluate(node => getComputedStyle(node).backgroundColor)).toBe("rgb(12, 13, 15)");
  expect(await offline.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await offline.screenshot({path:testInfo.outputPath("offline.png"), fullPage:true});
  const cachePaths = await offline.evaluate(async name => (await (await caches.open(name)).keys()).map(request => new URL(request.url).pathname).sort(), entries[0].name);
  expect(cachePaths).toEqual(entries[0].paths);

  await context.route("**/watch", stripHttpsUpgrade);
  await context.setOffline(false);
  await expect(offline.getByRole("heading", {name:"Vision is unavailable"})).toBeVisible();
  await offline.getByRole("link", {name:"Try again"}).click();
  await expect(offline.getByRole("heading", {name:"Sign in to Vision"})).toBeVisible({timeout:15000});
  await expect(offline.getByRole("heading", {name:"Vision is unavailable"})).toHaveCount(0);
});
