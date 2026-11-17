import { test, expect } from '@playwright/test';
import { VIEWER_CAMERAS } from '../lib/viewer-protocol';

test('walls, fullscreen and menu keep Ring behind explicit Play', async ({ page }, testInfo) => {
  // The isolated fixture uses HTTP; production retains its HTTPS upgrade policy.
  await page.route('**/watch', async route => {
    const response = await route.fetch();
    const headers = response.headers();
    headers['content-security-policy'] = (headers['content-security-policy'] || '').replace(/upgrade-insecure-requests;?/g, '');
    await route.fulfill({ response, headers });
  });
  const configs: Array<{camera:string; mode:string}> = [];
  await page.route('**/api/viewer/**', async route => {
    const action = new URL(route.request().url()).pathname.split('/').pop();
    if (action === 'session') return route.fulfill({ json: { username:'test', cameras:VIEWER_CAMERAS, expires:Date.now()/1000+3600 } });
    if (action === 'snapshot') return route.fulfill({ status:503, json:{error:'snapshot_unavailable'} });
    if (action === 'config') { configs.push(route.request().postDataJSON()); return route.fulfill({ status:503,json:{error:'test_unavailable'} }); }
    return route.fulfill({ json:{ok:true} });
  });
  await page.goto('/watch');
  await expect(page.getByRole('button',{name:'Open menu'})).toBeVisible();
  await expect(page.locator('.vision-tile:visible')).toHaveCount(10);
  expect(configs).toHaveLength(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('all-wall.png'),fullPage:true});
  await page.getByRole('button',{name:'Ring',exact:true}).click();
  await expect(page.locator('.vision-tile:visible')).toHaveCount(5);
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
  await page.getByRole('checkbox',{name:/Data Saver/}).check();
  await page.getByRole('button',{name:'Close menu'}).click();
  await page.getByRole('button',{name:'Open Front fullscreen',exact:true}).click();
  await expect(page.getByRole('button',{name:'Play',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Close fullscreen'}).click();
  await page.getByRole('button',{name:'Swann',exact:true}).click();
  await expect(page.locator('.vision-tile:visible')).toHaveCount(5);
  await page.getByRole('button',{name:'Start wall',exact:true}).click();
  await expect.poll(()=>configs.length).toBe(6);
  expect(configs.slice(1).every(c=>c.mode==='live'&&!c.camera.startsWith('ring-'))).toBe(true);
  await page.getByRole('button',{name:'Open Shed fullscreen',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Shed swann camera fullscreen'})).toBeVisible();
  expect(configs).toHaveLength(6);
  await page.getByRole('button',{name:'Close fullscreen'}).click();
  await page.setViewportSize({width:844,height:390});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
