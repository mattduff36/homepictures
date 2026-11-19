import {test, expect, type Locator, type Page} from '@playwright/test';
import {VIEWER_CAMERAS} from '../lib/viewer-protocol';
import {VISION_PREFERENCES_KEY} from '../lib/vision-layout';

test.use({serviceWorkers:'block', reducedMotion:'reduce', hasTouch:true});
const ring = VIEWER_CAMERAS.find(camera => camera.id === 'ring-front')!;
// A valid public colour swatch, never a private camera image.
const snapshotImage = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDyOiiitTM//9k=';

async function tap(page: Page, target: Locator) {
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  await page.touchscreen.tap(box!.x + box!.width / 2, box!.y + box!.height / 2);
}

async function finishStartup(page: Page) {
  await expect(page.getByRole('status',{name:'Starting MPDEE Vision'})).toBeVisible();
  // Advance while React can still be scheduling the next startup phase.
  await expect.poll(async () => {
    await page.clock.runFor(1000);
    return page.getByRole('status',{name:'Starting MPDEE Vision'}).count();
  },{timeout:16000}).toBe(0);
  await expect(page.getByRole('button',{name:'Open menu'})).toBeVisible();
}

async function viewer(page: Page, all = false) {
  const configs: Array<{camera:string; mode:string}> = [];
  await page.clock.install();
  await page.addInitScript(() => {
    // The config fixture fails before peer construction; preserve this path in Windows WebKit.
    if (!window.RTCPeerConnection) Object.defineProperty(window,'RTCPeerConnection',{value:class {},configurable:true});
    if (!window.MediaStream) Object.defineProperty(window,'MediaStream',{value:class {},configurable:true});
  });
  await page.route('**/watch?**', async route => {
    const response = await route.fetch();
    const headers = response.headers();
    headers['content-security-policy'] = (headers['content-security-policy'] || '').replace(/upgrade-insecure-requests;?/g,'');
    await route.fulfill({response,headers});
  });
  await page.route('**/api/diagnostics', route => route.fulfill({json:{ok:true}}));
  await page.route('**/api/viewer/**', route => {
    const action = new URL(route.request().url()).pathname.split('/').pop();
    if (action === 'session') return route.fulfill({json:{username:'fixture', cameras:all ? VIEWER_CAMERAS : [ring], expires:Date.now()/1000 + 3600}});
    if (action === 'snapshot') return route.fulfill({json:{camera:route.request().postDataJSON().camera, image:snapshotImage,capturedAt:null,cachedAt:Math.floor(Date.now()/1000)-180,stale:true,battery:94,weakWifi:true}});
    if (action === 'recording') return route.fulfill({json:{cameras:{}}});
    if (action === 'config') { configs.push(route.request().postDataJSON()); return route.fulfill({status:503,json:{error:'fixture_unavailable'}}); }
    return route.fulfill({json:{ok:true}});
  });
  await page.goto('/watch?wallLayout=grid');
  await finishStartup(page);
  return configs;
}

test('idle touch wakes controls without opening or playing a camera, and the next tap acts normally', async ({page}, info) => {
  const configs = await viewer(page);
  const tile = page.getByRole('region',{name:'Front ring camera',exact:true});
  await page.clock.fastForward(3100);
  await expect(page.getByRole('button',{name:'Open menu'})).toBeHidden();
  await tap(page,tile);
  await expect(page.getByRole('button',{name:'Open menu'})).toBeVisible();
  await expect(page.getByRole('dialog',{name:'Front ring camera fullscreen'})).toHaveCount(0);
  expect(configs).toHaveLength(0);
  await tap(page,tile);
  const fullscreen = page.getByRole('dialog',{name:'Front ring camera fullscreen'});
  await expect(fullscreen).toBeVisible();
  const play = fullscreen.getByRole('button',{name:'Play',exact:true});
  await expect(play).toBeVisible();
  await expect(play).toHaveText('');
  await expect(play.locator('path')).toHaveAttribute('fill-rule','evenodd');
  await expect(play).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
  await page.screenshot({path:info.outputPath('pwa-play-icon.png')});
  await page.clock.fastForward(3100);
  await expect(play).toBeHidden();
  await tap(page,fullscreen);
  await expect(play).toBeVisible();
  expect(configs).toHaveLength(0);
  await tap(page,play);
  await expect.poll(()=>configs.length).toBe(1);
  expect(configs[0]).toEqual({camera:ring.id,mode:'manual'});
});

test('badge backgrounds disappear after ten seconds while white camera text stays visible', async ({page}) => {
  await viewer(page);
  const name = page.locator('.vision-name');
  await expect(name).toHaveCSS('background-color','rgba(8, 8, 8, 0.78)');
  await page.clock.fastForward(10100);
  await expect(name).toBeVisible();
  await expect(name).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
  await expect(name).toHaveCSS('border-top-color','rgba(0, 0, 0, 0)');
  await expect(name).toHaveCSS('color','rgb(255, 255, 255)');
  await tap(page,page.getByRole('region',{name:'Front ring camera',exact:true}));
  await expect(name).toHaveCSS('background-color','rgba(8, 8, 8, 0.78)');
  await expect(page.getByRole('dialog',{name:'Front ring camera fullscreen'})).toHaveCount(0);
});

test('keyboard focus and open menus stay usable while idle', async ({page}) => {
  await viewer(page);
  // Let the final startup effect schedule idle timers before testing keyboard wake.
  await expect.poll(async () => {
    await page.clock.runFor(1000);
    return page.getByRole('button',{name:'Open menu'}).isVisible();
  }).toBe(false);
  await page.keyboard.press('Tab');
  const burger = page.getByRole('button',{name:'Open menu'});
  await burger.focus();
  await page.clock.fastForward(4000);
  await expect(burger).toBeVisible();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('dialog',{name:'Vision menu'});
  await expect(menu).toBeVisible();
  await page.clock.fastForward(11000);
  await expect(menu.getByRole('button',{name:'Settings',exact:true})).toBeVisible();
  await menu.getByRole('button',{name:'Close menu'}).click();
  await expect(menu).toBeHidden();
});

test('wall and solo fill the viewport and only screen-edge controls receive safe-area insets', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await viewer(page,true);
  // Keep controls present while measuring geometry, including on slower live HTTPS.
  await page.keyboard.press('Tab');
  await page.getByRole('button',{name:'Open menu'}).focus();
  const screen = page.getByRole('main',{name:'MPDEE Vision'});
  async function insets(top: number, right: number, bottom: number, left: number) {
    await screen.evaluate((element, values) => {
      for (const [edge,value] of Object.entries(values)) (element as HTMLElement).style.setProperty(`--vision-safe-${edge}`,`${value}px`);
    },{top,right,bottom,left});
  }
  async function fillsViewport() {
    await expect.poll(()=>screen.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return {x:rect.x,y:rect.y,width:Math.round(rect.width),height:Math.round(rect.height),viewportWidth:innerWidth,viewportHeight:innerHeight};
    })).toEqual({x:0,y:0,width:page.viewportSize()!.width,height:page.viewportSize()!.height,viewportWidth:page.viewportSize()!.width,viewportHeight:page.viewportSize()!.height});
  }
  await insets(59,0,34,0);
  await fillsViewport();
  expect((await page.getByRole('button',{name:'Open menu'}).boundingBox())!.y).toBeGreaterThanOrEqual(71);
  const recordings = await page.locator('.vision-tile:visible:has(.vision-recording)').evaluateAll(tiles => tiles.map(tile => {
    const box = tile.getBoundingClientRect();
    return {top:box.top,dotTop:tile.querySelector('.vision-recording')!.getBoundingClientRect().top};
  }));
  expect(recordings.some(row=>row.top === 0)).toBe(true);
  for (const row of recordings) expect(row.dotTop).toBeCloseTo(row.top + 7 + Math.max(0,59-row.top),0);
  await page.setViewportSize({width:844,height:390});
  await insets(0,59,21,59);
  await fillsViewport();
  await expect.poll(async () => {
    const box = await page.getByRole('button',{name:'Open menu'}).boundingBox();
    return box!.x + box!.width;
  }).toBeLessThanOrEqual(844-59-12);
  await page.setViewportSize({width:390,height:844});
  await insets(59,0,34,0);
  await fillsViewport();
  await page.getByRole('button',{name:'Open Front fullscreen',exact:true}).click();
  const solo = page.getByRole('dialog',{name:'Front ring camera fullscreen'});
  await expect(solo).toBeVisible();
  await page.keyboard.press('Tab');
  await solo.getByRole('button',{name:'Close fullscreen'}).focus();
  await expect.poll(()=>solo.evaluate(element=>Math.round(element.getBoundingClientRect().height))).toBe(844);
  await expect.poll(async ()=>(await solo.getByRole('button',{name:'Close fullscreen'}).boundingBox())!.y).toBeGreaterThanOrEqual(71);
  const name = await solo.locator('.vision-name').boundingBox();
  expect(name!.y + name!.height).toBeLessThanOrEqual(844-34-16);
});

test('Start wall stays in the menu and Reload App fetches a new document without losing preferences or cookies', async ({page,context}) => {
  const configs = await viewer(page,true);
  await page.keyboard.press('Tab');
  await page.getByRole('button',{name:'Open menu'}).focus();
  await expect(page.locator('meta[name="apple-mobile-web-app-status-bar-style"]')).toHaveCount(0);
  await expect(page.locator('meta[name="mobile-web-app-capable"]')).toHaveAttribute('content','yes');
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content','yes');
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content','MPDEE Vision');
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content',/viewport-fit=cover/);
  await expect(page.getByRole('button',{name:'Start wall',exact:true})).toBeHidden();
  await expect(page.getByRole('button',{name:'Start wall',exact:true,includeHidden:true})).toHaveCount(1);
  await page.getByRole('button',{name:'Open menu'}).click();
  const menu = page.getByRole('dialog',{name:'Vision menu'});
  await expect(menu.getByRole('button',{name:'Start wall',exact:true})).toBeVisible();
  await menu.getByRole('button',{name:'Stop all cameras'}).click();
  await expect(page.getByRole('button',{name:'Start wall',exact:true})).toBeHidden();
  await page.getByRole('button',{name:'Open menu'}).click();
  await menu.getByRole('checkbox',{name:'Data Saver'}).check();
  await context.addCookies([{name:'reload_cookie_fixture',value:'kept',url:new URL(page.url()).origin,httpOnly:true}]);
  await page.evaluate(() => { Object.assign(window,{reloadDocumentProbe:'old document'}); });
  const navigations: string[] = [];
  page.on('request', request => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations.push(request.url());
  });
  await menu.getByRole('button',{name:'Reload App',exact:true}).click();
  await page.waitForURL(url => url.searchParams.has('_reload'));
  await finishStartup(page);
  expect(navigations).toHaveLength(1);
  expect(new URL(navigations[0]).pathname).toBe('/watch');
  expect(new URL(page.url()).searchParams.get('wallLayout')).toBe('grid');
  expect(new URL(page.url()).searchParams.get('_reload')).toBeTruthy();
  expect(await page.evaluate(() => Object.hasOwn(window,'reloadDocumentProbe'))).toBe(false);
  expect((await context.cookies()).find(cookie=>cookie.name==='reload_cookie_fixture')?.value).toBe('kept');
  expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).dataSaver,VISION_PREFERENCES_KEY)).toBe(true);
  await page.getByRole('button',{name:'Open menu'}).click();
  await expect(menu.getByRole('checkbox',{name:'Data Saver'})).toBeChecked();
  expect(configs.every(config=>config.mode==='live' && !config.camera.startsWith('ring-'))).toBe(true);
});
