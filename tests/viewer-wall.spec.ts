import { test, expect, type Page } from '@playwright/test';
import { VIEWER_CAMERAS } from '../lib/viewer-protocol';

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

test('walls, fullscreen and menu keep Ring behind explicit Play', async ({ page }, testInfo) => {
  // The isolated fixture uses HTTP; production retains its HTTPS upgrade policy.
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
    if (action === 'snapshot') return route.fulfill({ status:503, json:{error:'snapshot_unavailable'} });
    if (action === 'sessions') return route.fulfill({ json: { limit:3, sessions:[
      {id:currentId, issuedAt:1800000000, expires:1800604800, current:true},
      ...(!revoked.length ? [{id:otherId, issuedAt:1800000000, expires:1800604800, current:false}] : []),
    ] } });
    if (action === 'revoke-session') { revoked.push(route.request().postDataJSON().id); return route.fulfill({json:{ok:true}}); }
    if (action === 'config') { configs.push(route.request().postDataJSON()); return route.fulfill({ status:503,json:{error:'test_unavailable'} }); }
    return route.fulfill({ json:{ok:true} });
  });
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/watch');
  await expect(page.locator('main')).toHaveAttribute('inert','');
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.closest('main') === null)).toBe(true);
  releaseSession();
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
    await page.getByRole('button',{name:'Open menu'}).click();
    await page.getByRole('dialog',{name:'Vision menu'}).getByRole('button',{name:/All Cameras/}).click();
    await expect(page.locator('.vision-grid')).toHaveAttribute('data-layout','grid');
    await expectRows(page,[3,3,4]);
  } else await expectRows(page,[1,1,2,2,2,2]);
  const grid = await page.locator('.vision-grid').boundingBox();
  expect(grid?.x).toBe(0); expect(grid?.y).toBe(0);
  expect(grid?.width).toBe(page.viewportSize()?.width);
  expect(grid?.height).toBe(page.viewportSize()?.height);
  for (const player of originalPlayers) expect(await player.evaluate(node=>node.isConnected)).toBe(true);
  expect(configs).toHaveLength(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('all-wall.png'),fullPage:true});
  await page.getByRole('button',{name:'Ring',exact:true}).click();
  await expect(page.locator('.vision-tile:visible')).toHaveCount(5);
  await expectRows(page, testInfo.project.name === 'desktop' ? [2,3] : [1,1,1,2]);
  await page.screenshot({path:testInfo.outputPath('ring-wall.png'),fullPage:true});
  await expect(page.getByRole('button',{name:'Play',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Open Front fullscreen',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Front ring camera fullscreen'})).toBeVisible();
  expect(configs).toHaveLength(0);
  await page.getByRole('button',{name:'Play',exact:true}).click();
  await expect.poll(()=>configs.length).toBe(1);
  expect(configs[0]).toEqual({camera:'ring-front',mode:'manual'});
  await page.getByRole('button',{name:'Close fullscreen'}).click();
  await page.getByRole('button',{name:'Open Front fullscreen',exact:true}).click();
  expect(configs).toHaveLength(1);
  await page.getByRole('button',{name:'Close fullscreen'}).click();
  await page.getByRole('button',{name:'Open menu'}).click();
  await expect(page.getByRole('dialog',{name:'Vision menu'})).toBeVisible();
  await page.getByRole('button',{name:'Manage saved sign-ins'}).click();
  const saved = page.getByRole('dialog',{name:'Saved sign-ins',exact:true});
  await expect(saved.getByRole('heading',{name:'This browser'})).toBeVisible();
  await expect(saved.getByRole('button',{name:'Sign out this session'})).toHaveCount(1);
  await page.screenshot({path:testInfo.outputPath('saved-sign-ins.png')});
  await saved.getByRole('button',{name:'Sign out this session'}).click();
  await expect(saved.getByRole('heading',{name:'Other saved sign-in'})).toHaveCount(0);
  expect(revoked).toEqual([otherId]);
  expect(configs).toHaveLength(1);
  await page.keyboard.press('Escape');
  await expect(saved).toHaveCount(0);
  await page.getByRole('button',{name:'Open menu'}).click();
  await page.getByRole('checkbox',{name:/Data Saver/}).check();
  await page.getByRole('button',{name:'Close menu'}).click();
  await page.getByRole('button',{name:'Open Front fullscreen',exact:true}).click();
  await expect(page.getByRole('button',{name:'Play',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Close fullscreen'}).click();
  await page.getByRole('button',{name:'Swann',exact:true}).click();
  await expect(page.locator('.vision-tile:visible')).toHaveCount(5);
  await page.getByRole('button',{name:'Start wall',exact:true}).filter({visible:true}).click();
  await expect.poll(()=>configs.length).toBe(6);
  expect(configs.slice(1).every(c=>c.mode==='live'&&!c.camera.startsWith('ring-'))).toBe(true);
  await page.getByRole('button',{name:'Open Shed fullscreen',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Shed swann camera fullscreen'})).toBeVisible();
  expect(configs).toHaveLength(6);
  await page.getByRole('button',{name:'Close fullscreen'}).click();
  await page.getByRole('button',{name:'All Cameras',exact:true}).click();
  await page.getByRole('button',{name:'Open Front fullscreen',exact:true}).click();
  await page.getByRole('button',{name:'Close fullscreen'}).click();
  await expect(page.locator('.vision-start-floating')).toBeVisible();
  expect(configs).toHaveLength(6);
  await page.getByRole('button',{name:'Open menu'}).click();
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await page.getByLabel('Username',{exact:true}).fill('test');
  await page.getByLabel('Password',{exact:true}).fill('fixture-password');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.locator('.vision-start-floating')).toBeVisible();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  expect(configs).toHaveLength(6);
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
  await expect(page.getByRole('status',{name:'Starting MPDEE Vision'})).toHaveCount(0,{timeout:16000});
  const nodes=await page.locator('.vision-tile video').elementHandles();
  await page.getByRole('button',{name:'Open menu'}).click();
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
  expect(calls.filter(action=>action==='config')).toHaveLength(0);
  await page.getByRole('button',{name:'Close fullscreen'}).click();
  for(const node of nodes) expect(await node.evaluate(item=>item.isConnected)).toBe(true);
  await page.getByRole('button',{name:'Open menu'}).click();
  await page.getByRole('dialog',{name:'Vision menu'}).getByRole('button',{name:'All Cameras',exact:true}).click();
  await expect(page.locator('.vision-grid')).toHaveAttribute('data-layout','featured');
  await page.reload();
  await expect(page.getByRole('status',{name:'Starting MPDEE Vision'})).toHaveCount(0,{timeout:16000});
  await expect(page.locator('.vision-grid')).toHaveAttribute('data-layout','featured');
  expect(calls.filter(action=>action==='config')).toHaveLength(0);
});
