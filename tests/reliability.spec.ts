import {test, expect, type Page} from '@playwright/test';
import {VIEWER_CAMERAS} from '../lib/viewer-protocol';
import {validIncident, type Incident} from '../lib/diagnostics';

// These API-mocked scenarios need predictable Playwright request interception.
// Real service-worker installation/offline/recovery stays enabled in offline.spec.ts.
test.use({serviceWorkers: "block"});

async function localPage(page: Page) {
  await page.route('**/watch', async route => {
    const response = await route.fetch(); const headers = response.headers();
    headers['content-security-policy'] = (headers['content-security-policy'] || '').replace(/upgrade-insecure-requests;?/g, '');
    await route.fulfill({response, headers});
  });
}
const ring = VIEWER_CAMERAS.find(camera => camera.id === 'ring-front')!;
const session = () => ({username:'fixture', cameras:[ring], expires:Math.floor(Date.now()/1000)+3600});

test('a gateway interruption can recheck the saved sign-in without another login or live allocation', async ({page}) => {
  await localPage(page);
  let checks = 0, logins = 0, allocations = 0;
  const events: Incident[] = [];
  await page.route('**/api/diagnostics', async route => {events.push(...route.request().postDataJSON().events); await route.fulfill({json:{ok:true}});});
  await page.route('**/api/viewer/**', async route => {
    const action = new URL(route.request().url()).pathname.split('/').pop();
    if (action === 'session') return ++checks === 1 ? route.fulfill({status:502,json:{error:'unavailable'}}) : route.fulfill({json:session()});
    if (action === 'login') logins++;
    if (action === 'config') allocations++;
    if (action === 'snapshot') return route.fulfill({json:{camera:ring.id,image:'/9j/2Q==',capturedAt:null,stale:true}});
    return route.fulfill({json:{ok:true}});
  });
  await page.goto('/watch');
  await expect(page.getByRole('button',{name:'Check saved sign-in again'})).toBeVisible();
  // Check delivery while the failed request is still displayed, before retry starts media.
  await expect.poll(()=>events.length).toBeGreaterThan(0);
  expect(events.every(validIncident)).toBe(true);
  await page.getByRole('button',{name:'Check saved sign-in again'}).click();
  await expect(page.getByRole('button',{name:'Open menu'})).toBeVisible();
  expect(checks).toBe(2); expect(logins).toBe(0); expect(allocations).toBe(0);
});

test('unexpected browser failures give a usable notice even when the logging service fails', async ({page}) => {
  await localPage(page);
  const events: Incident[] = [];
  await page.route('**/api/viewer/session', route => route.fulfill({status:401,json:{error:'sign in'}}));
  await page.route('**/api/diagnostics', async route => {events.push(...route.request().postDataJSON().events); await route.fulfill({status:503,json:{error:'unavailable'}});});
  await page.goto('/watch');
  await expect(page.getByRole('heading',{name:'Sign in to Vision'})).toBeVisible();
  await page.evaluate(() => {setTimeout(() => {throw new TypeError('private-fixture-value?password=do-not-log');},0);});
  const notice = page.locator('.vision-runtime-notice');
  await expect(notice).toBeVisible();
  await expect(notice.getByRole('button',{name:'Reload page'})).toBeVisible();
  await expect.poll(()=>events.length).toBeGreaterThan(0);
  expect(events.every(validIncident)).toBe(true);
  expect(JSON.stringify(events)).not.toMatch(/private-fixture|password|do-not-log/);
  await notice.getByRole('button',{name:'Dismiss'}).click();
  await expect(notice).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeEnabled();
  await page.evaluate(() => {void Promise.reject(new Error('private-rejection-fixture'));});
  await expect(notice).toBeVisible();
});

test('unsupported WebRTC leaves snapshots and navigation usable and allocates no cameras', async ({page}) => {
  await localPage(page);
  await page.addInitScript(() => Object.defineProperty(window,'RTCPeerConnection',{configurable:true,value:undefined}));
  let allocations = 0;
  await page.route('**/api/diagnostics', route => route.fulfill({json:{ok:true}}));
  await page.route('**/api/viewer/**', async route => {
    const action = new URL(route.request().url()).pathname.split('/').pop();
    if (action === 'session') return route.fulfill({json:{...session(),cameras:[VIEWER_CAMERAS[0],ring]}});
    if (action === 'config') allocations++;
    if (action === 'snapshot') return route.fulfill({json:{camera:ring.id,image:'/9j/2Q==',capturedAt:null,stale:true}});
    if (action === 'recording') return route.fulfill({json:{cameras:{}}});
    return route.fulfill({json:{ok:true}});
  });
  await page.goto('/watch');
  await expect(page.getByText(/This browser cannot play live cameras/)).toBeVisible();
  await expect(page.getByRole('status',{name:'Starting MPDEE Vision'})).toHaveCount(0,{timeout:16000});
  await page.getByRole('button',{name:'Open menu'}).click();
  await expect(page.getByRole('dialog',{name:'Vision menu'})).toBeVisible();
  expect(allocations).toBe(0);
});

test('a real React render exception shows the recovery screen and explicit retry restores the viewer', async ({page}) => {
  await localPage(page);
  await page.route('**/api/diagnostics', route => route.fulfill({json:{ok:true}}));
  await page.route('**/api/viewer/**', async route => {
    const action = new URL(route.request().url()).pathname.split('/').pop();
    if (action === 'session') return route.fulfill({json:session()});
    if (action === 'snapshot') return route.fulfill({json:{camera:ring.id,image:'/9j/2Q==',capturedAt:null,stale:true}});
    if (action === 'sessions') return route.fulfill({json:{limit:5,sessions:[{id:'a'.repeat(64),issuedAt:1800000000,expires:1800604800,current:true}]}});
    return route.fulfill({json:{ok:true}});
  });
  await page.goto('/watch');
  await expect(page.getByRole('status',{name:'Starting MPDEE Vision'})).toHaveCount(0,{timeout:16000});
  await page.evaluate(() => {Date.prototype.toLocaleString = function () {throw new Error('private-render-fixture');};});
  await page.getByRole('button',{name:'Open menu'}).click();
  await page.getByRole('button',{name:'Manage saved sign-ins'}).click();
  await expect(page.getByRole('heading',{name:'Vision could not display this page'})).toBeVisible();
  await expect(page.getByText(/Reference: [0-9a-f]{32}/)).toBeVisible();
  await page.getByRole('button',{name:'Try again',exact:true}).click();
  await expect(page.getByRole('button',{name:'Open menu'})).toBeVisible();
});
