import { test, expect, type Page } from '@playwright/test';
import { VIEWER_CAMERAS } from '../lib/viewer-protocol';

// These API-mocked scenarios need predictable Playwright request interception.
// Real service-worker installation/offline/recovery stays enabled in offline.spec.ts.
test.use({serviceWorkers: "block"});

test.beforeEach(async ({page}) => {
  // These UI tests deliberately reject mocked config requests before peer construction.
  // Supply the absent capability in Windows WebKit so the same mocked failure path is exercised.
  // Real unsupported-browser behaviour is independently covered in reliability.spec.ts.
  await page.addInitScript(() => {
    if (typeof window.RTCPeerConnection === 'undefined') Object.defineProperty(window, 'RTCPeerConnection', {value: class {}, configurable:true});
    if (typeof window.MediaStream === 'undefined') Object.defineProperty(window, 'MediaStream', {value: class {}, configurable:true});
  });
});

async function openMenu(page: Page) {
  // A slow browser step can outlast the three-second idle timer. Wake first,
  // as a keyboard user would, before asking Playwright to click the menu.
  await page.keyboard.press('Tab');
  await page.getByRole('button',{name:'Open menu'}).click();
}

async function expectRows(page: Page, expected: number[]) {
  await expect.poll(() => page.locator('.vision-tile:visible').evaluateAll(tiles => {
    const counts = new Map<number, number>();
    for (const tile of tiles) {
      const top = Math.round(tile.getBoundingClientRect().top);
      counts.set(top, (counts.get(top) ?? 0) + 1);
    }
    return [...counts].sort((a,b) => a[0]-b[0]).map(row => row[1]);
  })).toEqual(expected);
}

async function openHome(page: Page) {
  if (page.context().browser()?.browserType().name() === 'webkit') {
    // WebKit cannot intercept a 3xx response to strip the HTTP fixture's HTTPS
    // upgrade. Verify the real redirect, then browser-test its observed target.
    const entry = await page.request.get('/', {maxRedirects:0});
    expect(entry.status()).toBe(307);
    expect(entry.headers().location).toBe('/watch');
    await page.goto(entry.headers().location);
  } else await page.goto('/');
}

test('walls, fullscreen and menu keep Ring behind explicit Play', async ({ page }, testInfo) => {
  // The isolated HTTP fixture strips the viewer HTTPS upgrade. Production retains its HTTPS policy.
  await page.route('**/watch', async route => {
    const response = await route.fetch();
    const headers = response.headers();
    headers['content-security-policy'] = (headers['content-security-policy'] || '').replace(/upgrade-insecure-requests;?/g, '');
    await route.fulfill({ response, headers });
  });
  const configs: Array<{camera:string; mode:string}> = [];
  const revoked: string[] = [];
  const currentId = 'a'.repeat(64);
  const otherId = 'b'.repeat(64);
  let releaseSession!: () => void;
  const initialSession = new Promise<void>(resolve => { releaseSession = resolve; });
  let firstSession = true;
  await page.route('**/api/viewer/**', async route => {
    const action = new URL(route.request().url()).pathname.split('/').pop();
    if (action === 'session') {
      if (firstSession) { firstSession = false; await initialSession; }
      return route.fulfill({ json: { username:'test', cameras:VIEWER_CAMERAS, expires:Date.now()/1000+3600 } });
    }
    if (action === 'recording') return route.fulfill({ json: { cameras: {
      'shed': {state:'recording', validForMs:20000},
    } } });
    if (action === 'snapshot') return route.fulfill({ json: {
      camera: route.request().postDataJSON().camera, image:'/9j/2Q==', capturedAt:null, stale:true,
      cachedAt:Math.floor(Date.now()/1000)-185, battery:94, weakWifi:true,
    } });
    if (action === 'sessions') return route.fulfill({ json: { limit:5, sessions:[
      {id:currentId, issuedAt:1800000000, expires:1800604800, current:true},
      ...(!revoked.length ? [{id:otherId, issuedAt:1800000000, expires:1800604800, current:false}] : []),
    ] } });
    if (action === 'revoke-session') { revoked.push(route.request().postDataJSON().id); return route.fulfill({json:{ok:true}}); }
    if (action === 'config') { configs.push(route.request().postDataJSON()); return route.fulfill({ status:503,json:{error:'test_unavailable'} }); }
    return route.fulfill({ json:{ok:true} });
  });
  await openHome(page);
  await expect(page).toHaveURL(/\/watch$/);
  await expect(page.getByRole('heading',{name:'Home Camera Access'})).toHaveCount(0);
  await expect(page.locator('.vision-startup')).toHaveCount(0);
  expect(configs).toHaveLength(0);
  releaseSession();
  await expect(page.locator('main')).toHaveAttribute('inert','');
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.closest('main') === null)).toBe(true);
  await expect.poll(()=>configs.length).toBe(5);
  expect(configs.every(c=>c.mode==='live'&&!c.camera.startsWith('ring-'))).toBe(true);
  await expect(page.getByRole('status',{name:'Starting MPDEE Vision'})).toHaveCount(0,{timeout:16000});
  await expect(page.locator('main')).not.toHaveAttribute('inert');
  await expect(page.getByRole('button',{name:'Open menu'})).toBeVisible();
  await expect(page.locator('.vision-tile:visible')).toHaveCount(10);
  const originalPlayers = await page.locator('.vision-tile video').elementHandles();
  if (testInfo.project.name === 'desktop') {
    await expect(page.locator('.vision-grid')).toHaveAttribute('data-layout','featured');
    const feature = await page.locator('.vision-feature-main').boundingBox();
    expect(feature?.x).toBeCloseTo(288,0); expect(feature?.width).toBeCloseTo(1152,0);
    await page.getByRole('button',{name:'Pause camera rotation'}).click();
    await expect(page.getByRole('button',{name:'Resume camera rotation'})).toHaveAttribute('aria-pressed','true');
    await openMenu(page);
    await page.getByRole('dialog',{name:'Vision menu'}).getByRole('button',{name:/All Cameras/}).click();
    await expect(page.locator('.vision-grid')).toHaveAttribute('data-layout','grid');
    await expectRows(page,[3,3,4]);
  } else await expectRows(page,[1,1,2,2,2,2]);
  const grid = await page.locator('.vision-grid').boundingBox();
  expect(grid?.x).toBe(0); expect(grid?.y).toBe(0);
  expect(grid?.width).toBe(page.viewportSize()?.width);
  expect(grid?.height).toBe(page.viewportSize()?.height);
  for (const player of originalPlayers) expect(await player.evaluate(node=>node.isConnected)).toBe(true);
  expect(configs).toHaveLength(5);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('all-wall.png'),fullPage:true});
  await expect(page.getByRole('button',{name:/Refresh.*snapshot/})).toHaveCount(0);
  await expect(page.locator('[data-camera-id="ring-front"] .vision-age')).toHaveText('3m');
  await expect(page.locator('[data-camera-id="ring-front"] .vision-ring-status')).toHaveText('94%Wi-Fi');
  const dots = await page.getByRole('navigation',{name:'Camera walls'}).boundingBox();
  const footer = await page.locator('[data-camera-id="ring-back"] .vision-name').boundingBox();
  expect(dots!.y + dots!.height).toBeLessThan(footer!.y);
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('button',{name:'Swann',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button',{name:'All Cameras',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.vision-tile:visible')).toHaveCount(5);
  await expectRows(page, testInfo.project.name === 'desktop' ? [2,3] : [1,1,1,2]);
  await page.screenshot({path:testInfo.outputPath('ring-wall.png'),fullPage:true});
  await expect(page.getByRole('button',{name:'Play',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Open Front fullscreen',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Front ring camera fullscreen'})).toBeVisible();
  expect(configs).toHaveLength(5);
  await page.getByRole('button',{name:'Play',exact:true}).click();
  await expect.poll(()=>configs.length).toBe(6);
  expect(configs[5]).toEqual({camera:'ring-front',mode:'manual'});
  await page.getByRole('button',{name:'Close fullscreen'}).click();
  await page.getByRole('button',{name:'Open Front fullscreen',exact:true}).click();
  expect(configs).toHaveLength(6);
  await page.getByRole('button',{name:'Close fullscreen'}).click();
  await openMenu(page);
  await expect(page.getByRole('dialog',{name:'Vision menu'})).toBeVisible();
  await page.getByRole('button',{name:'Manage saved sign-ins'}).click();
  const saved = page.getByRole('dialog',{name:'Saved sign-ins',exact:true});
  await expect(saved.getByRole('heading',{name:'This browser'})).toBeVisible();
  await expect(saved).toContainText('Up to 5 saved sign-ins');
  await expect(saved.getByRole('button',{name:'Sign out this session'})).toHaveCount(1);
  await page.screenshot({path:testInfo.outputPath('saved-sign-ins.png')});
  await saved.getByRole('button',{name:'Sign out this session'}).click();
  await expect(saved.getByRole('heading',{name:'Other saved sign-in'})).toHaveCount(0);
  expect(revoked).toEqual([otherId]);
  expect(configs).toHaveLength(6);
  await page.keyboard.press('Escape');
  await expect(saved).toHaveCount(0);
  await openMenu(page);
  await page.getByRole('checkbox',{name:/Data Saver/}).check();
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Open Front fullscreen',exact:true}).click();
  await expect(page.getByRole('button',{name:'Play',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Close fullscreen'}).click();
  await page.getByRole('button',{name:'Swann',exact:true}).click();
  await expect(page.locator('.vision-tile:visible')).toHaveCount(5);
  await expect(page.getByRole('button',{name:'Start wall',exact:true})).toBeHidden();
  await openMenu(page);
  await page.getByRole('dialog',{name:'Vision menu'}).getByRole('button',{name:'Start wall',exact:true}).click();
  await expect.poll(()=>configs.length).toBe(11);
  expect(configs.slice(6,11).every(c=>c.mode==='live'&&!c.camera.startsWith('ring-'))).toBe(true);
  const shed = page.getByRole('region',{name:'Shed swann camera'});
  const playShed = shed.getByRole('button',{name:'Play Shed',exact:true});
  await expect(playShed).toBeVisible();
  await expect(shed.locator('.vision-recording')).toHaveAttribute('data-recording-state','recording');
  await expect(shed).not.toContainText('PAUSED');
  await playShed.click({position:{x:12,y:35}});
  await expect.poll(()=>configs.length).toBe(12);
  expect(configs[11]).toEqual({camera:'shed',mode:'live'});
  await expect(page.getByRole('dialog',{name:'Shed swann camera fullscreen'})).toHaveCount(0);
  await page.getByRole('button',{name:'All Cameras',exact:true}).click();
  await page.getByRole('button',{name:'Open Front fullscreen',exact:true}).click();
  await page.getByRole('button',{name:'Close fullscreen'}).click();
  await expect(page.getByRole('button',{name:'Start wall',exact:true})).toBeHidden();
  expect(configs).toHaveLength(12);
  await openMenu(page);
  await expect(page.getByRole('dialog',{name:'Vision menu'}).getByRole('button',{name:'Start wall',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await page.getByLabel('Username',{exact:true}).fill('test');
  await page.getByLabel('Password',{exact:true}).fill('fixture-password');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect.poll(()=>configs.length).toBe(17);
  await expect(page.getByRole('status',{name:'Starting MPDEE Vision'})).toHaveCount(0,{timeout:16000});
  await expect(page.locator('.vision-start-floating')).toHaveCount(0);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  expect(configs.slice(12).every(c=>c.mode==='live'&&!c.camera.startsWith('ring-'))).toBe(true);
  await page.getByRole('button',{name:'Swann',exact:true}).click();
  await page.setViewportSize({width:844,height:390});
  await expectRows(page, [2,3]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('landscape-wall.png'),fullPage:true});
});


test('settings and Featured reuse mounted players, respect preference and never start Ring',async({page},testInfo)=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.route('**/watch',async route=>{const response=await route.fetch();const headers=response.headers();headers['content-security-policy']=(headers['content-security-policy']||'').replace(/upgrade-insecure-requests;?/g,'');await route.fulfill({response,headers});});
  const calls:string[]=[];
  await page.route('**/api/viewer/**',route=>{const action=new URL(route.request().url()).pathname.split('/').pop()!;calls.push(action);return route.fulfill(action==='session'?{json:{username:'test',cameras:VIEWER_CAMERAS,expires:Date.now()/1000+3600}}:action==='snapshot'?{status:503,json:{error:'snapshot_unavailable'}}:{json:{ok:true}});});
  await page.goto('/watch');
  await expect.poll(()=>calls.filter(action=>action==='config').length).toBe(5);
  await expect(page.getByRole('status',{name:'Starting MPDEE Vision'})).toHaveCount(0,{timeout:16000});
  const nodes=await page.locator('.vision-tile video').elementHandles();
  await openMenu(page);
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  const settings=page.getByRole('dialog',{name:'Settings',exact:true});
  await settings.getByLabel('Featured wall',{exact:false}).selectOption('featured');
  await settings.getByLabel('Seconds per camera',{exact:false}).fill('5');
  await settings.getByLabel('Picture size').selectOption('contain');
  await page.getByRole('button',{name:'Close settings'}).click();
  await expect(page.locator('.vision-grid')).toHaveAttribute('data-layout','featured');
  await page.getByRole('button',{name:'Feature Front',exact:true}).click();
  await expect(page.locator('.vision-feature-main')).toHaveAttribute('data-camera-id','ring-front');
  await expect(page.locator('.vision-feature-ring-copy')).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('featured-ring.png')});
  await page.getByRole('button',{name:'Open Front fullscreen',exact:true}).click();
  await expect(page.getByRole('button',{name:'Play',exact:true})).toBeVisible();
  expect(calls.filter(action=>action==='config')).toHaveLength(5);
  await page.getByRole('button',{name:'Close fullscreen'}).click();
  for(const node of nodes) expect(await node.evaluate(item=>item.isConnected)).toBe(true);
  await openMenu(page);
  await page.getByRole('dialog',{name:'Vision menu'}).getByRole('button',{name:'All Cameras',exact:true}).click();
  await expect(page.locator('.vision-grid')).toHaveAttribute('data-layout','featured');
  await page.reload();
  await expect.poll(()=>calls.filter(action=>action==='config').length).toBe(10);
  await expect(page.getByRole('status',{name:'Starting MPDEE Vision'})).toHaveCount(0,{timeout:16000});
  await expect(page.locator('.vision-grid')).toHaveAttribute('data-layout','featured');
  expect(calls.filter(action=>action==='config')).toHaveLength(10);
});


test('signed-out home opens sign-in and launches once after login', async ({page}) => {
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.route('**/watch',async route=>{const response=await route.fetch();const headers=response.headers();headers['content-security-policy']=(headers['content-security-policy']||'').replace(/upgrade-insecure-requests;?/g,'');await route.fulfill({response,headers});});
  let signedIn=false;
  const configs:Array<{camera:string;mode:string}>=[];
  await page.route('**/api/viewer/**',async route=>{
    const action=new URL(route.request().url()).pathname.split('/').pop();
    if(action==='login'){signedIn=true;return route.fulfill({json:{ok:true}});}
    if(action==='session')return route.fulfill(signedIn?{json:{username:'test',cameras:VIEWER_CAMERAS,expires:Date.now()/1000+3600}}:{status:401,json:{error:'unauthorized'}});
    if(action==='config'){configs.push(route.request().postDataJSON());return route.fulfill({status:503,json:{error:'test_unavailable'}});}
    if(action==='snapshot')return route.fulfill({status:503,json:{error:'snapshot_unavailable'}});
    return route.fulfill({json:{ok:true}});
  });
  await openHome(page);
  await expect(page).toHaveURL(/\/watch$/);
  await expect(page.getByRole('heading',{name:'Sign in to Vision'})).toBeVisible();
  await expect(page.locator('.vision-startup')).toHaveCount(0);
  expect(configs).toHaveLength(0);
  await page.getByLabel('Username',{exact:true}).fill('test');
  await page.getByLabel('Password',{exact:true}).fill('fixture-password');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect.poll(()=>configs.length).toBe(5);
  await expect(page.getByRole('status',{name:'Starting MPDEE Vision'})).toHaveCount(0,{timeout:16000});
  await expect(page.locator('.vision-start-floating')).toHaveCount(0);
  expect(configs.every(c=>c.mode==='live'&&!c.camera.startsWith('ring-'))).toBe(true);
  await page.evaluate(()=>{window.dispatchEvent(new Event('offline'));window.dispatchEvent(new Event('online'));});
  await expect(page.getByRole('button',{name:'Start wall',exact:true})).toBeHidden();
  await openMenu(page);
  await expect(page.getByRole('dialog',{name:'Vision menu'}).getByRole('button',{name:'Start wall',exact:true})).toBeEnabled();
  await page.keyboard.press('Escape');
  expect(configs).toHaveLength(5);
});
