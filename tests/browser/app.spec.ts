import { test, expect, type Page } from '@playwright/test';
import { readFile,writeFile } from 'node:fs/promises';
import { frameHands } from '../fixtures/hands';
import catalog from '../../src/media/filter-catalog.json' with {type:'json'};

async function fixtureTracking(page: Page, microphoneDenied = false) {
  await page.addInitScript(({ hands, microphoneDenied }) => {
    const nativeWorker = window.Worker;
    const nativeMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    const trackStore: MediaStreamTrack[] = [];
    const unhandled: string[] = [];
    window.addEventListener('unhandledrejection', event => unhandled.push(String(event.reason)));
    Object.assign(window, { fixtureTracks: trackStore, fixtureHands: hands, fixturePoseVisible: true, fixtureFrameCount: 0, fixtureWorkerFailures: false, fixtureUnhandled: unhandled });
    navigator.mediaDevices.getUserMedia = async constraints => {
      if (microphoneDenied && constraints?.audio) throw new DOMException('Fixture denial', 'NotAllowedError');
      const stream = await nativeMedia(constraints);
      trackStore.push(...stream.getTracks()); return stream;
    };
    class FixtureWorker extends EventTarget {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror = null;
      closed = false;
      postMessage(message: { type: string; image?: ImageBitmap; id?: number; timestamp?: number }) {
        if (message.type === 'CLOSE') { this.closed = true; return; }
        if (message.type === 'FRAME') { message.image?.close(); (window as unknown as { fixtureFrameCount: number }).fixtureFrameCount++; }
        const result = message.type === 'INIT' ? ((window as unknown as { fixtureWorkerFailures: boolean }).fixtureWorkerFailures ? { type: 'ERROR', message: 'Hand tracking could not load. Check your connection and try again.' } : { type: 'READY', delegate: 'CPU' }) : {
          type: 'RESULT', id: message.id, timestamp: message.timestamp,
          landmarks: (window as unknown as { fixturePoseVisible: boolean }).fixturePoseVisible ? (window as unknown as { fixtureHands: typeof hands }).fixtureHands : [], inferenceMs: 2,
        };
        setTimeout(() => { if (!this.closed) this.onmessage?.(new MessageEvent('message', { data: result })); }, 2);
      }
      terminate() { this.closed = true; }
    }
    window.Worker = class extends FixtureWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super();
        if (!String(url).includes('hand.worker')) return new nativeWorker(url, options) as unknown as FixtureWorker;
      }
    } as unknown as typeof Worker;
  }, { hands: frameHands(), microphoneDenied });
}

async function openCamera(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open your camera', exact: true }).click();
  try { await expect(page.getByText('Window active', { exact: true })).toBeVisible(); }
  catch (error) {
    const info = await page.evaluate(() => {
      const video = document.querySelector<HTMLVideoElement>('.camera-source');
      return { width: video?.videoWidth, height: video?.videoHeight, currentTime: video?.currentTime, paused: video?.paused, frames: (window as unknown as { fixtureFrameCount: number }).fixtureFrameCount };
    });
    throw new Error(`${String(error)}; camera diagnostics: ${JSON.stringify(info)}`);
  }
}

test('library, guidance, categories, and mobile layout', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /^Select .* effect$/ })).toHaveCount(catalog.length);
  await expect(page.getByRole('button', { name: 'Select Pixel effect' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Texture', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Select .* effect$/ })).toHaveCount(catalog.filter(effect=>effect.category==='Texture').length);
  await page.getByRole('button', { name: 'How it works' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'All', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.sites-runtime/mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.screenshot({ path: '.sites-runtime/desktop.png', fullPage: true });
});

test('camera denial has a recovery action', async ({ page }) => {
  await page.addInitScript(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Fixture denial', 'NotAllowedError'); }; });
  await page.goto('/'); await page.getByRole('button', { name: 'Open your camera', exact: true }).click();
  await expect(page.getByText(/Camera access was blocked/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Take photo' })).toBeDisabled();
});

test('GPU masking, photo export, all presets, tracking loss, and cleanup', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await fixtureTracking(page); await openCamera(page);
  await expect(page.getByText(/GPU accelerated/)).toBeVisible();
  await page.getByRole('button', { name: 'Select Mono effect' }).click();
  await page.waitForTimeout(500);
  await expect(page.getByText('Window active', { exact: true })).toBeVisible();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Take photo' }).click();
  const download = await downloadEvent;
  await download.saveAs('.sites-runtime/captured.png');
  const photo = (await readFile((await download.path())!)).toString('base64');
  const samples = await page.evaluate(async encoded => {
    const photo = await createImageBitmap(await (await fetch(`data:image/png;base64,${encoded}`)).blob());
    const actual = document.createElement('canvas'); actual.width = photo.width; actual.height = photo.height;
    const actualContext = actual.getContext('2d')!; actualContext.drawImage(photo, 0, 0);
    const raw = document.createElement('canvas'); raw.width = photo.width; raw.height = photo.height;
    const rawContext = raw.getContext('2d')!; rawContext.translate(raw.width, 0); rawContext.scale(-1, 1);
    rawContext.drawImage(document.querySelector<HTMLVideoElement>('.camera-source')!, 0, 0, raw.width, raw.height);
    const sample = (context: CanvasRenderingContext2D, x: number, y: number) => [...context.getImageData(Math.floor(x * raw.width), Math.floor(y * raw.height), 1, 1).data];
    const result = { inside: sample(actualContext, .5, .4), outside: sample(actualContext, .05, .05), rawInside: sample(rawContext, .5, .4), rawOutside: sample(rawContext, .05, .05), width: photo.width, height: photo.height };
    photo.close(); return result;
  }, photo);
  expect(samples.width / samples.height).toBeCloseTo(16 / 9, 1);
  expect(Math.max(...samples.inside.slice(0, 3)) - Math.min(...samples.inside.slice(0, 3)), JSON.stringify(samples)).toBeLessThan(5);
  expect(Math.max(...samples.rawInside.slice(0, 3)) - Math.min(...samples.rawInside.slice(0, 3))).toBeGreaterThan(20);
  for (let i = 0; i < 3; i++) expect(Math.abs(samples.outside[i] - samples.rawOutside[i]), JSON.stringify(samples)).toBeLessThan(5);
  for (const label of ['Sepia', 'Negative', 'Golden', 'Ice', 'Pixel', 'ASCII', 'Sketch', 'Old film', 'Retro TV', 'Prism', 'Bloom']) {
    await page.getByRole('button', { name: `Select ${label} effect` }).click();
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    await page.waitForTimeout(350);
    await expect(page.getByText('Window active', { exact: true })).toBeVisible();
  }
  await page.screenshot({ path: '.sites-runtime/active-camera.png', fullPage: true });
  await page.evaluate(() => { (window as unknown as { fixturePoseVisible: boolean }).fixturePoseVisible = false; });
  await expect(page.getByText('Show both hands', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close camera', exact: true }).click();
  await expect(page.getByTestId('camera-canvas')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { fixtureTracks: MediaStreamTrack[] }).fixtureTracks.every(track => track.readyState === 'ended'))).toBe(true);
  expect(errors).toEqual([]);
});

test('records a playable clip while switching effects and releases optional audio', async ({ page }) => {
  await fixtureTracking(page); await openCamera(page);
  await page.getByRole('button', { name: 'Enable microphone' }).click();
  await page.getByRole('button', { name: 'Record video' }).click();
  await expect(page.getByRole('button', { name: 'Stop recording' })).toContainText('Stop', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Select Sepia effect' }).click();
  await expect(page.getByText('Sepia', { exact: true }).first()).toBeVisible();
  await page.waitForTimeout(1100);
  await page.getByRole('button', { name: 'Stop recording' }).click();
  await expect(page.getByRole('dialog', { name: 'A little moment, captured.' })).toBeVisible();
  const preview = page.getByLabel('Recorded video preview');
  await expect.poll(async () => preview.evaluate(video => (video as HTMLVideoElement).videoWidth)).toBeGreaterThan(0);
  const tracks = await page.evaluate(() => (window as unknown as { fixtureTracks: MediaStreamTrack[] }).fixtureTracks.filter(track => track.kind === 'audio').map(track => track.readyState));
  expect(tracks.length).toBeGreaterThan(0); expect(tracks.every(state => state === 'ended')).toBe(true);
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download video' }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/\.(mp4|webm)$/);
  expect((await readFile((await download.path())!)).length).toBeGreaterThan(1000);
  await page.getByRole('button', { name: 'Keep creating' }).click();
  await page.getByRole('button', { name: 'Close camera', exact: true }).click();
});

test('microphone denial continues with a silent clip; countdown can be cancelled', async ({ page }) => {
  await fixtureTracking(page, true); await openCamera(page);
  await page.getByRole('button', { name: 'Enable microphone' }).click();
  await page.getByRole('button', { name: 'Record video' }).click();
  await expect(page.getByText('Microphone unavailable. Your clip will be recorded without sound.')).toBeVisible();
  await page.getByRole('button', { name: 'Stop recording' }).click();
  await expect(page.getByRole('button', { name: 'Record video' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Record video' }).click();
  await expect(page.getByRole('button', { name: 'Stop recording' })).toContainText('Stop');
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Stop recording' }).click();
  await expect(page.getByLabel('Recorded video preview')).toBeVisible();
});

test('auto-cycle pauses on pose loss and resumes after reacquisition', async ({ page }) => {
  await fixtureTracking(page); await openCamera(page);
  await page.getByRole('button', { name: /Explore hands-free/ }).click();
  await expect(page.getByRole('button', { name: 'Select ASCII effect' })).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });
  await page.evaluate(() => { (window as unknown as { fixturePoseVisible: boolean }).fixturePoseVisible = false; });
  await expect(page.getByText('Show both hands', { exact: true })).toBeVisible();
  await page.waitForTimeout(5100);
  await expect(page.getByRole('button', { name: 'Select ASCII effect' })).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => { (window as unknown as { fixturePoseVisible: boolean }).fixturePoseVisible = true; });
  await expect(page.getByRole('button', { name: 'Select Sketch effect' })).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });
});

test('real MediaPipe worker loads same-origin assets and handles camera frames', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const assets: string[] = []; page.on('request', request => { if (request.url().includes('/models/')) assets.push(request.url()); });
  await page.goto('/'); await page.getByRole('button', { name: 'Open your camera', exact: true }).click();
  await expect(page.getByText('Show both hands', { exact: true })).toBeVisible({ timeout: 40_000 });
  await expect(page.getByTestId('camera-canvas')).toBeVisible();
  await page.waitForTimeout(1200);
  expect(assets.some(url => url.endsWith('hand_landmarker.task'))).toBe(true);
  expect(assets.some(url => url.endsWith('.wasm'))).toBe(true);
  expect(assets.every(url => url.startsWith(`${new URL(page.url()).origin}/`))).toBe(true);
  expect(errors).toEqual([]);
  await page.getByRole('button', { name: 'Close camera', exact: true }).click();
});

test('camera switching finalizes the clip before replacing the stream', async ({ page }) => {
  await fixtureTracking(page); await openCamera(page);
  await page.getByRole('button', { name: 'Record video' }).click();
  await expect(page.getByRole('button', { name: 'Stop recording' })).toContainText('Stop');
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Flip camera', exact: true }).click();
  await expect(page.getByLabel('Recorded video preview')).toBeVisible();
  await page.getByRole('button', { name: 'Keep creating' }).click();
  await expect(page.getByText('Window active', { exact: true })).toBeVisible();
  const trackStates = await page.evaluate(() => (window as unknown as { fixtureTracks: MediaStreamTrack[] }).fixtureTracks.map(track => track.readyState));
  expect(trackStates[0]).toBe('ended'); expect(trackStates.at(-1)).toBe('live');
  await page.getByRole('button', { name: 'Close camera', exact: true }).click();
});

test('background suspension saves the recording and pauses the camera', async ({ page }) => {
  await fixtureTracking(page); await openCamera(page);
  await page.getByRole('button', { name: 'Record video' }).click();
  await expect(page.getByRole('button', { name: 'Stop recording' })).toContainText('Stop');
  await page.waitForTimeout(600);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(page.getByLabel('Recorded video preview')).toBeVisible();
  await page.getByRole('button', { name: 'Keep creating' }).click();
  await expect(page.getByRole('button', { name: 'Resume camera', exact: true })).toBeVisible();
  await expect(page.getByTestId('camera-canvas')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { fixtureTracks: MediaStreamTrack[] }).fixtureTracks.every(track => track.readyState === 'ended'))).toBe(true);
});

test('tracking initialization failure releases the camera and offers retry', async ({ page }) => {
  await fixtureTracking(page);
  await page.goto('/');
  await page.evaluate(() => { (window as unknown as { fixtureWorkerFailures: boolean }).fixtureWorkerFailures = true; });
  await page.getByRole('button', { name: 'Open your camera', exact: true }).click();
  await expect(page.getByText('Hand tracking could not load. Check your connection and try again.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window as unknown as { fixtureTracks: MediaStreamTrack[] }).fixtureTracks.every(track => track.readyState === 'ended'))).toBe(true);
  await page.evaluate(() => { (window as unknown as { fixtureWorkerFailures: boolean }).fixtureWorkerFailures = false; });
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByText('Window active', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { fixtureUnhandled: string[] }).fixtureUnhandled)).toEqual([]);
});

test('full-video mode skips tracking and switches to a hand window without restarting the camera',async({page})=>{
  await fixtureTracking(page);await page.goto('/');
  await page.getByRole('button',{name:'Full video',exact:true}).click();
  await page.getByRole('button',{name:'Open your camera',exact:true}).click();
  await expect(page.getByText('Full video',{exact:true}).last()).toBeVisible();
  await expect(page.getByText(/GPU accelerated/)).toBeVisible();
  await page.getByRole('button',{name:'Select Mono effect'}).click();
  await page.waitForTimeout(300);
  expect(await page.evaluate(()=>(window as unknown as {fixtureFrameCount:number}).fixtureFrameCount)).toBe(0);
  const event=page.waitForEvent('download');await page.getByRole('button',{name:'Take photo'}).click();
  const image=(await readFile((await(await event).path())!)).toString('base64');
  const corners=await page.evaluate(async image=>{
    const bitmap=await createImageBitmap(await(await fetch(`data:image/png;base64,${image}`)).blob());
    const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const context=canvas.getContext('2d')!;context.drawImage(bitmap,0,0);
    const samples=[[.05,.05],[.5,.4],[.95,.95]].map(([x,y])=>[...context.getImageData(Math.floor(x*canvas.width),Math.floor(y*canvas.height),1,1).data]);bitmap.close();return samples;
  },image);
  for(const rgba of corners){expect(rgba[3]).toBe(255);expect(Math.max(...rgba.slice(0,3))-Math.min(...rgba.slice(0,3))).toBeLessThan(5);}
  await page.getByRole('button',{name:'Hand window',exact:true}).click();await expect(page.getByText('Window active',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>(window as unknown as {fixtureTracks:MediaStreamTrack[]}).fixtureTracks.filter(track=>track.kind==='video').length)).toBe(1);
  await page.getByRole('button',{name:'Full video',exact:true}).click();
  const before=await page.evaluate(()=>(window as unknown as {fixtureFrameCount:number}).fixtureFrameCount);await page.waitForTimeout(400);
  expect(await page.evaluate(()=>(window as unknown as {fixtureFrameCount:number}).fixtureFrameCount)).toBe(before);
});

test('Canvas fallback works without WebGL or hand-tracking APIs and exports the whole frame',async({playwright})=>{
  const args=(test.info().project.use.launchOptions?.args??[]).filter(arg=>!arg.includes('swiftshader'));
  const browser=await playwright.chromium.launch({args:[...args,'--disable-webgl','--disable-webgl2']});
  const page=await browser.newPage({permissions:['camera','microphone']});
  await fixtureTracking(page);
  await page.goto('/');
  await page.evaluate(()=>{
    const original=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(this:HTMLCanvasElement,type:string,...args:unknown[]){if(type==='webgl'||type==='webgl2'||type==='experimental-webgl')return null;return Reflect.apply(original,this,[type,...args]);} as typeof original;
    Object.defineProperty(window,'Worker',{value:undefined,configurable:true});
  });
  await page.getByRole('button',{name:'Full video',exact:true}).click();
  await page.getByRole('button',{name:'Open your camera',exact:true}).click();
  await expect(page.getByText(/Compatibility mode/)).toBeVisible();
  await expect(page.getByRole('button',{name:'Select ASCII effect'})).toBeDisabled();
  await page.getByRole('button',{name:'Select Cartoon effect'}).click();
  await expect(page.getByTestId('camera-canvas')).toBeVisible();
  const event=page.waitForEvent('download');await page.getByRole('button',{name:'Take photo'}).click();
  expect((await readFile((await(await event).path())!)).length).toBeGreaterThan(1000);
  await page.getByRole('button',{name:'Close camera',exact:true}).click();
  await browser.close();
});

test('all expanded library filters render and can be recorded in full-video mode',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await fixtureTracking(page);await page.goto('/');await page.getByRole('button',{name:'Full video',exact:true}).click();
  await page.getByRole('button',{name:'Open your camera',exact:true}).click();await expect(page.getByTestId('camera-canvas')).toBeVisible();
  for(const effect of catalog){await page.getByRole('button',{name:`Select ${effect.label} effect`}).click();await page.waitForTimeout(150);}
  await page.getByRole('button',{name:'Select Cartoon effect'}).click();
  await page.getByRole('button',{name:'Record video'}).click();await expect(page.getByRole('button',{name:'Stop recording'})).toContainText('Stop');await page.waitForTimeout(700);await page.getByRole('button',{name:'Stop recording'}).click();
  await expect(page.getByLabel('Recorded video preview')).toBeVisible();expect(errors).toEqual([]);
});

test('GPU pass benchmark uses fewer draw calls than the previous compositor',async({page})=>{
  await fixtureTracking(page);await page.goto('/');await page.getByRole('button',{name:'Full video',exact:true}).click();await page.getByRole('button',{name:'Open your camera',exact:true}).click();await expect(page.getByTestId('camera-canvas')).toBeVisible();
  const metrics=await page.evaluate(async()=>{
    const oldUrl='/tests/fixtures/legacy-compositor.ts',newUrl='/src/media/compositor.ts';
    const Legacy=(await import(/* @vite-ignore */oldUrl)).Compositor,Current=(await import(/* @vite-ignore */newUrl)).Compositor;
    const video=document.querySelector<HTMLVideoElement>('.camera-source')!;
    const left=document.createElement('div'),right=document.createElement('div');
    const previous=new Legacy(),current=new Current();await previous.init(video,left,1280,true);await current.init(video,right,1280,true);
    const portal={corners:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],visibility:1,phase:'active'};
    let calls=0;const restores:(()=>void)[]=[];
    for(const key of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced']){
      const prototype=WebGL2RenderingContext.prototype as unknown as Record<string,(...args:unknown[])=>unknown>;
      const original=prototype[key];if(!original)continue;
      prototype[key]=function(...args:unknown[]){calls++;return Reflect.apply(original,this,args);};restores.push(()=>{prototype[key]=original;});
    }
    const measure=(renderer:typeof previous)=>{
      for(let i=0;i<4;i++)renderer.render(portal,1,i/30,true,'full');
      calls=0;const start=performance.now();for(let i=0;i<40;i++)renderer.render(portal,1,i/30,true,'full');
      return {drawsPerFrame:calls/40,submissionMs:(performance.now()-start)/40};
    };
    const baseline=measure(previous),optimized=measure(current);
    restores.forEach(restore=>restore());current.destroy();previous.destroy();return {baseline,optimized};
  });
  await writeFile('.sites-runtime/render-benchmark.json',JSON.stringify(metrics,null,2));
  expect(metrics.optimized.drawsPerFrame).toBeLessThanOrEqual(metrics.baseline.drawsPerFrame/2);
});

test('learned anime model loads locally, processes frames, and exports an image',async({page})=>{
  test.setTimeout(90_000);
  const failures:string[]=[];page.on('console',message=>{if(message.type()==='error')failures.push(message.text());});
  await fixtureTracking(page);await page.goto('/');await page.getByRole('button',{name:'Full video',exact:true}).click();
  await page.getByRole('button',{name:'Open your camera',exact:true}).click();await expect(page.getByTestId('camera-canvas')).toBeVisible();
  await page.getByRole('button',{name:'Select Anime AI effect'}).click();
  await expect(page.getByText(/AI anime · \d+(?:\.\d+)? processed frames\/sec/)).toBeVisible({timeout:60_000});
  await page.screenshot({path:'.sites-runtime/anime-ai.png',fullPage:true});
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Take photo'}).click();
  expect((await readFile((await(await download).path())!)).length).toBeGreaterThan(1000);
  await page.getByRole('button',{name:'Select Pixel effect'}).click();await expect(page.getByText(/processed frames\/sec/)).toHaveCount(0);
  expect(failures).toEqual([]);
});

test('rotated, inverted, close, and concave fingertip windows stay active and render correctly',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await fixtureTracking(page);await openCamera(page);await page.getByRole('button',{name:'Select Mono effect'}).click();
  const setTips=async(tips:{x:number;y:number}[])=>{
    const hands=frameHands();[hands[0][8],hands[0][4],hands[1][8],hands[1][4]]=tips.map(p=>({...p,z:0}));
    await page.evaluate(hands=>{(window as unknown as {fixtureHands:typeof hands}).fixtureHands=hands;},hands);
    await page.waitForTimeout(750);await expect(page.getByText('Window active',{exact:true})).toBeVisible();
  };
  const samplePhoto=async(points:{x:number;y:number}[])=>{
    const event=page.waitForEvent('download');await page.getByRole('button',{name:'Take photo'}).click();
    const encoded=(await readFile((await(await event).path())!)).toString('base64');
    return page.evaluate(async({encoded,points})=>{
      const bitmap=await createImageBitmap(await(await fetch(`data:image/png;base64,${encoded}`)).blob());
      const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
      const context=canvas.getContext('2d')!;context.drawImage(bitmap,0,0);
      const values=points.map(p=>[...context.getImageData(Math.floor((1-p.x)*canvas.width),Math.floor(p.y*canvas.height),1,1).data]);bitmap.close();return values;
    },{encoded,points});
  };
  const colored=(pixel:number[])=>Math.max(...pixel.slice(0,3))-Math.min(...pixel.slice(0,3));
  // Left index is below its thumb; right hand has the opposite orientation.
  await setTips([{x:.2,y:.75},{x:.15,y:.2},{x:.85,y:.2},{x:.8,y:.75}]);
  let pixels=await samplePhoto([{x:.5,y:.4},{x:.05,y:.05}]);
  expect(colored(pixels[0])).toBeLessThan(5);expect(colored(pixels[1])).toBeGreaterThan(20);
  // One vertical hand and one horizontal hand, with a concave corner.
  await setTips([{x:.2,y:.7},{x:.2,y:.2},{x:.9,y:.45},{x:.55,y:.45}]);
  pixels=await samplePhoto([{x:.4,y:.45}]);expect(colored(pixels[0])).toBeLessThan(5);
  // A fourth tip lies inside the triangle formed by the other tips.
  await setTips([{x:.15,y:.15},{x:.5,y:.4},{x:.85,y:.15},{x:.85,y:.85}]);
  pixels=await samplePhoto([{x:.35,y:.25},{x:.7,y:.35},{x:.35,y:.55}]);
  expect(colored(pixels[0])).toBeLessThan(5);expect(colored(pixels[1])).toBeLessThan(5);expect(colored(pixels[2])).toBeGreaterThan(20);
  // The compatibility renderer must clip the same concave shape.
  const canvasPixels=await page.evaluate(async()=>{
    const url='/src/media/canvas-renderer.ts';const {CanvasRenderer}=await import(/* @vite-ignore */url);
    const renderer=new CanvasRenderer();const host=document.createElement('div');
    await renderer.init(document.querySelector<HTMLVideoElement>('.camera-source')!,host,640,true);renderer.setEffect('grayscale');
    renderer.render({corners:[{x:.15,y:.15},{x:.85,y:.15},{x:.85,y:.85},{x:.5,y:.4}],visibility:1,phase:'active'},1,0,true,'window');
    const canvas=renderer.canvas as HTMLCanvasElement,context=canvas.getContext('2d')!;
    const samples=[{x:.35,y:.25},{x:.7,y:.35},{x:.35,y:.55}].map(p=>[...context.getImageData(Math.floor((1-p.x)*canvas.width),Math.floor(p.y*canvas.height),1,1).data]);
    renderer.destroy();return samples;
  });
  expect(colored(canvasPixels[0])).toBeLessThan(5);expect(colored(canvasPixels[1])).toBeLessThan(5);expect(colored(canvasPixels[2])).toBeGreaterThan(20);
  // Subpixel spacing and coincident tips must not turn tracking off.
  await setTips([{x:.5,y:.5},{x:.5,y:.50001},{x:.50001,y:.5},{x:.50001,y:.50001}]);
  await setTips([{x:.5,y:.5},{x:.5,y:.5},{x:.5,y:.5},{x:.5,y:.5}]);
  expect(errors).toEqual([]);
});
