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

async function viewer(page: Page, all = false, liveFixture = false, checkStartup?: () => Promise<void>) {
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
    if (action === 'config') {
      const body = route.request().postDataJSON();
      configs.push(body);
      return route.fulfill(liveFixture ? {json:{lease:body.camera.padEnd(43,'x'),camera:body.camera,expires:Date.now()/1000+900,iceServers:[]}}
        : {status:503,json:{error:'fixture_unavailable'}});
    }
    if (action === 'offer') return route.fulfill({json:{type:'answer',sdp:'v=0\r\ns=fixture\r\n'}});
    if (action === 'poll') return route.fulfill({json:{events:[],closed:false}});
    return route.fulfill({json:{ok:true}});
  });
  await page.goto('/watch?wallLayout=grid');
  await checkStartup?.();
  await finishStartup(page);
  return configs;
}

test('idle touch wakes controls without opening or playing a camera, and the next tap acts normally', async ({page}, info) => {
  const configs = await viewer(page);
  const tile = page.getByRole('region',{name:'Front ring camera',exact:true});
  // Startup can render before React installs the idle timer. Keep advancing
  // the fake clock while waiting, instead of waiting with that clock paused.
  await expect.poll(async () => {
    await page.clock.fastForward(3100);
    return page.getByRole('button',{name:'Open menu'}).isVisible();
  },{timeout:10000}).toBe(false);
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

test('badge backgrounds start fading after eight seconds and fade for four seconds while text stays white', async ({page}) => {
  await viewer(page);
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  // Start a fresh idle window after the startup effects have settled.
  await page.mouse.move(2,2);
  const screen = page.getByRole('main',{name:'MPDEE Vision'});
  const name = page.locator('.vision-name');
  await expect(name).toHaveCSS('background-color','rgba(8, 8, 8, 0.78)');
  await page.clock.fastForward(7500);
  await expect(screen).toHaveAttribute('data-badges','shown');
  await expect(name).toHaveCSS('background-color','rgba(8, 8, 8, 0.78)');
  await page.clock.fastForward(600);
  await expect(screen).toHaveAttribute('data-badges','quiet');
  // Inspect and sample the actual CSS transitions without waiting four real seconds.
  const durations = await name.evaluate(element => element.getAnimations().map(animation => {
    const duration = animation.effect!.getTiming().duration;
    animation.pause();
    animation.currentTime = 2000;
    return duration;
  }));
  expect(durations.length).toBeGreaterThan(0);
  expect(durations.every(duration=>duration === 4000)).toBe(true);
  const alpha = await name.evaluate(element => Number(getComputedStyle(element).backgroundColor.match(/,\s*([\d.]+)\)$/)?.[1]));
  expect(alpha).toBeGreaterThan(0);
  expect(alpha).toBeLessThan(.78);
  await expect(name).toHaveCSS('color','rgb(255, 255, 255)');
  await name.evaluate(element => element.getAnimations().forEach(animation => animation.finish()));
  await expect(name).toBeVisible();
  await expect(name).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
  await expect(name).toHaveCSS('border-top-color','rgba(0, 0, 0, 0)');
  await expect(name).toHaveCSS('color','rgb(255, 255, 255)');
  await tap(page,page.getByRole('region',{name:'Front ring camera',exact:true}));
  await expect(name).toHaveCSS('background-color','rgba(8, 8, 8, 0.78)');
  await expect(page.getByRole('dialog',{name:'Front ring camera fullscreen'})).toHaveCount(0);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.clock.fastForward(8100);
  await expect(screen).toHaveAttribute('data-badges','quiet');
  // The shared reduced-motion rule uses an effectively instant 0.01ms transition.
  expect(await name.evaluate(element => Number.parseFloat(getComputedStyle(element).transitionDuration))).toBeLessThanOrEqual(.001);
  await expect(name).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
});

test('keyboard focus and open menus stay usable while idle', async ({page}) => {
  await viewer(page);
  // Advance a complete idle window once React has installed the startup effect.
  // runFor(1000) uses real time and can exhaust the poll budget in Windows WebKit.
  await expect.poll(async () => {
    await page.clock.fastForward(3100);
    return page.getByRole('button',{name:'Open menu'}).isVisible();
  },{timeout:10000}).toBe(false);
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
  await expect(menu.getByRole('heading',{name:'Vision menu'})).toHaveCount(0);
  await expect(menu.getByRole('button',{name:'Close menu'})).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await page.getByRole('button',{name:'Open menu'}).click();
  await expect(menu).toBeVisible();
  await page.touchscreen.tap(2,2);
  await expect(menu).toBeHidden();
});

test('wall and solo fill the viewport and only screen-edge controls receive safe-area insets', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  const screen = page.getByRole('main',{name:'MPDEE Vision'});
  async function insets(top: number, right: number, bottom: number, left: number) {
    await screen.evaluate((element, values) => {
      for (const [edge,value] of Object.entries(values)) (element as HTMLElement).style.setProperty(`--vision-safe-${edge}`,`${value}px`);
    },{top,right,bottom,left});
  }
  async function fillsViewport() {
    // A full-height wall inside a shorter html/body can still leave a black strip.
    await expect.poll(()=>page.evaluate(()=>[document.documentElement,document.body].map(element=>{
      const box = element.getBoundingClientRect();
      return {x:box.x,y:box.y,width:Math.round(box.width),height:Math.round(box.height)};
    }))).toEqual([0,1].map(()=>({x:0,y:0,...page.viewportSize()!})));
    await expect.poll(()=>screen.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return {x:rect.x,y:rect.y,width:Math.round(rect.width),height:Math.round(rect.height),viewportWidth:innerWidth,viewportHeight:innerHeight};
    })).toEqual({x:0,y:0,width:page.viewportSize()!.width,height:page.viewportSize()!.height,viewportWidth:page.viewportSize()!.width,viewportHeight:page.viewportSize()!.height});
  }
  await viewer(page,true,false,async () => {
    const startup = page.getByRole('status',{name:'Starting MPDEE Vision'});
    await expect(startup).toBeVisible();
    await fillsViewport();
    expect(await startup.boundingBox()).toEqual({x:0,y:0,width:390,height:844});
  });
  // Keep controls present while measuring geometry, including on slower live HTTPS.
  await page.keyboard.press('Tab');
  await page.getByRole('button',{name:'Open menu'}).focus();
  await insets(59,0,34,0);
  await fillsViewport();
  expect((await page.getByRole('button',{name:'Open menu'}).boundingBox())!.y).toBeGreaterThanOrEqual(71);
  const recordings = await page.locator('.vision-tile:visible:has(.vision-recording)').evaluateAll(tiles => tiles.map(tile => {
    const box = tile.getBoundingClientRect();
    return {top:box.top,dotTop:tile.querySelector('.vision-recording')!.getBoundingClientRect().top};
  }));
  expect(recordings.some(row=>row.top === 0)).toBe(true);
  for (const row of recordings) expect(row.dotTop).toBeCloseTo(row.top + 7 + Math.max(0,59-row.top),0);
  await page.getByRole('button',{name:'Ring',exact:true}).click();
  const firstRing = page.locator('.vision-grid-ring > .vision-tile:visible').first();
  const picture = firstRing.locator('img.vision-picture');
  await expect(picture).toBeVisible();
  expect((await picture.boundingBox())!.y).toBe(0);
  expect((await picture.boundingBox())!.x).toBe(0);
  expect((await picture.boundingBox())!.width).toBe(390);
  await expect.poll(async () => (await firstRing.locator('.vision-ring-status').boundingBox())!.y).toBeGreaterThanOrEqual(59);
  await page.getByRole('button',{name:'All Cameras',exact:true}).click();
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
  await expect(page.locator('head meta[name="apple-mobile-web-app-status-bar-style"]')).toHaveCount(1);
  await expect(page.locator('head meta[name="apple-mobile-web-app-status-bar-style"]')).toHaveAttribute('content','black-translucent');
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

async function installStreamFixture(page: Page) {
  // Real viewer state/leases, synthetic peers and media only; no camera connection.
  await page.addInitScript(() => {
    const peers: Array<{closed:boolean}> = [];
    const sources = new WeakMap<HTMLMediaElement, unknown>();
    Object.defineProperty(HTMLMediaElement.prototype,'srcObject',{
      configurable:true,
      get(this: HTMLMediaElement) { return sources.get(this) ?? null; },
      set(this: HTMLMediaElement, value: unknown) { sources.set(this,value); },
    });
    Object.defineProperty(HTMLMediaElement.prototype,'readyState',{configurable:true,get:()=>4});
    Object.defineProperty(HTMLMediaElement.prototype,'play',{configurable:true,value:async function(this: HTMLMediaElement) {
      this.dataset.playCalls=String(Number(this.dataset.playCalls ?? 0)+1);
    }});
    Object.defineProperty(HTMLMediaElement.prototype,'pause',{configurable:true,value:()=>{}});
    class FixturePeer extends EventTarget {
      iceGatheringState='complete'; connectionState='connected'; localDescription: {sdp:string} | null=null;
      closed=false; frames=0;
      constructor() { super(); peers.push(this); }
      addTransceiver() {}
      async createOffer() { return {type:'offer',sdp:'v=0\r\ns=fixture\r\n'}; }
      async setLocalDescription(value: {sdp:string}) { this.localDescription=value; }
      async setRemoteDescription() {}
      async addIceCandidate() {}
      async getStats() {
        // Simulate a browser that stops decoding hidden Swann tiles.
        if (!document.querySelector<HTMLElement>('[data-camera-id="back-garden"]')?.hidden) this.frames+=2;
        return new Map<string, Record<string, unknown>>([
          ['transport',{id:'transport',type:'transport',selectedCandidatePairId:'pair'}],
          ['pair',{id:'pair',type:'candidate-pair',localCandidateId:'local'}],
          ['local',{id:'local',type:'local-candidate',candidateType:'relay'}],
          ['video',{id:'video',type:'inbound-rtp',kind:'video',framesDecoded:this.frames}],
        ]);
      }
      close() { this.closed=true; }
    }
    Object.defineProperty(window,'RTCPeerConnection',{value:FixturePeer,configurable:true});
    Object.defineProperty(window,'MediaStream',{value:class {addTrack() {} getTracks() {return [];}},configurable:true});
    Object.assign(window,{visionRtcPeers:peers});
  });
}

test('Ring wall keeps Swann peers for twenty seconds, reuses them on return and then releases them', async ({page}) => {
  await installStreamFixture(page);
  const stops: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/viewer/stop') stops.push(request.postDataJSON().lease);
  });
  const configs = await viewer(page,true,true);
  const swann = page.getByRole('region',{name:'Back Garden swann camera',exact:true});
  await expect.poll(async () => {
    await page.clock.runFor(1000);
    return swann.getByRole('button',{name:'Unmute Back Garden',exact:true}).isEnabled();
  }).toBe(true);
  await page.keyboard.press('Tab');
  await swann.getByRole('button',{name:'Unmute Back Garden',exact:true}).click();
  expect(configs).toHaveLength(5);
  await page.evaluate(() => Object.assign(window,{visionOriginalStreams:[...document.querySelectorAll<HTMLVideoElement>('.vision-tile:not([data-camera-id^="ring-"]) video')].map(video=>video.srcObject)}));
  const peerState = () => page.evaluate(() => {
    const peers = (window as unknown as {visionRtcPeers:Array<{closed:boolean}>}).visionRtcPeers;
    return {total:peers.length,open:peers.filter(peer=>!peer.closed).length};
  });
  async function wall(name: 'Ring' | 'All Cameras') {
    await page.keyboard.press('Tab');
    await page.getByRole('navigation',{name:'Camera walls'}).getByRole('button',{name,exact:true}).click();
  }
  await wall('Ring');
  await page.clock.fastForward(15000);
  expect(await peerState()).toEqual({total:5,open:5});
  expect(stops).toHaveLength(0);
  await wall('All Cameras');
  await page.clock.runFor(1100);
  expect(await peerState()).toEqual({total:5,open:5});
  expect(configs).toHaveLength(5);
  expect(await page.evaluate(() => [...document.querySelectorAll<HTMLVideoElement>('.vision-tile:not([data-camera-id^="ring-"]) video')].every((video,index)=>
    video.muted && Number(video.dataset.playCalls)>0 && video.srcObject === (window as unknown as {visionOriginalStreams:unknown[]}).visionOriginalStreams[index]))).toBe(true);
  await wall('Ring');
  await page.clock.fastForward(20100);
  await expect.poll(()=>stops.length).toBe(5);
  expect(await peerState()).toEqual({total:5,open:0});
  await wall('All Cameras');
  await expect(swann.getByRole('button',{name:'Play Back Garden',exact:true})).toBeVisible();
  expect(configs).toHaveLength(5);
  await page.getByRole('button',{name:'Open menu'}).click();
  await page.getByRole('dialog',{name:'Vision menu'}).getByRole('button',{name:'Start wall',exact:true}).click();
  await expect.poll(()=>configs.length).toBe(10);
  await expect.poll(peerState).toEqual({total:10,open:5});
  await wall('Ring');
  await page.getByRole('button',{name:'Open Front fullscreen',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Front ring camera fullscreen'})).toBeVisible();
  await expect.poll(()=>stops.length).toBe(10);
  expect(await peerState()).toEqual({total:10,open:0});
  expect(configs.every(config=>!config.camera.startsWith('ring-'))).toBe(true);
});
