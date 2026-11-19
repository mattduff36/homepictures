import {test, expect, type Locator, type Page} from '@playwright/test';
import {VIEWER_CAMERAS} from '../lib/viewer-protocol';

test.use({serviceWorkers:'block', reducedMotion:'reduce', hasTouch:true});
const ring = VIEWER_CAMERAS.find(camera => camera.id === 'ring-front')!;
// A valid public colour swatch, never a private camera image.
const snapshotImage = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDyOiiitTM//9k=';

async function tap(page: Page, target: Locator) {
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  await page.touchscreen.tap(box!.x + box!.width / 2, box!.y + box!.height / 2);
}

async function viewer(page: Page, all = false) {
  const configs: Array<{camera:string; mode:string}> = [];
  await page.clock.install();
  await page.addInitScript(() => {
    // The config fixture fails before peer construction; preserve this path in Windows WebKit.
    if (!window.RTCPeerConnection) Object.defineProperty(window,'RTCPeerConnection',{value:class {},configurable:true});
    if (!window.MediaStream) Object.defineProperty(window,'MediaStream',{value:class {},configurable:true});
  });
  await page.route('**/watch?wallLayout=grid', async route => {
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
  await expect(page.getByRole('status',{name:'Starting MPDEE Vision'})).toBeVisible();
  // Advance the clock while React and the mocked session settle; do not stop
  // advancing while the startup effect may still be scheduling its next phase.
  await expect.poll(async () => {
    await page.clock.runFor(1000);
    return page.getByRole('status',{name:'Starting MPDEE Vision'}).count();
  },{timeout:16000}).toBe(0);
  await expect(page.getByRole('button',{name:'Open menu'})).toBeVisible();
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
  await page.clock.fastForward(3100);
  await expect(page.getByRole('button',{name:'Open menu'})).toBeHidden();
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
  await expect.poll(()=>solo.evaluate(element=>Math.round(element.getBoundingClientRect().height))).toBe(844);
  await expect.poll(async ()=>(await solo.getByRole('button',{name:'Close fullscreen'}).boundingBox())!.y).toBeGreaterThanOrEqual(71);
  const name = await solo.locator('.vision-name').boundingBox();
  expect(name!.y + name!.height).toBeLessThanOrEqual(844-34-16);
});
