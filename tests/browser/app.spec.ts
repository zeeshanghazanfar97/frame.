import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { frameHands } from '../fixtures/hands';

async function fixtureTracking(page: Page, microphoneDenied = false) {
  await page.addInitScript(({ hands, microphoneDenied }) => {
    const nativeWorker = window.Worker;
    const nativeMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    const trackStore: MediaStreamTrack[] = [];
    const unhandled: string[] = [];
    window.addEventListener('unhandledrejection', event => unhandled.push(String(event.reason)));
    Object.assign(window, { fixtureTracks: trackStore, fixturePoseVisible: true, fixtureFrameCount: 0, fixtureWorkerFailures: false, fixtureUnhandled: unhandled });
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
          landmarks: (window as unknown as { fixturePoseVisible: boolean }).fixturePoseVisible ? hands : [], inferenceMs: 2,
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
  await expect(page.getByRole('button', { name: /^Select .* effect$/ })).toHaveCount(12);
  await expect(page.getByRole('button', { name: 'Select Pixel effect' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Texture', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Select .* effect$/ })).toHaveCount(4);
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
  await expect(page.getByText('Make two L-shaped hands', { exact: true })).toBeVisible();
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
  await expect(page.getByText('Make two L-shaped hands', { exact: true })).toBeVisible();
  await page.waitForTimeout(5100);
  await expect(page.getByRole('button', { name: 'Select ASCII effect' })).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => { (window as unknown as { fixturePoseVisible: boolean }).fixturePoseVisible = true; });
  await expect(page.getByRole('button', { name: 'Select Sketch effect' })).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });
});

test('real MediaPipe worker loads same-origin assets and handles camera frames', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const assets: string[] = []; page.on('request', request => { if (request.url().includes('/models/')) assets.push(request.url()); });
  await page.goto('/'); await page.getByRole('button', { name: 'Open your camera', exact: true }).click();
  await expect(page.getByText('Make two L-shaped hands', { exact: true })).toBeVisible({ timeout: 40_000 });
  await expect(page.getByTestId('camera-canvas')).toBeVisible();
  await page.waitForTimeout(1200);
  expect(assets.some(url => url.endsWith('hand_landmarker.task'))).toBe(true);
  expect(assets.some(url => url.endsWith('.wasm'))).toBe(true);
  expect(assets.every(url => url.startsWith('http://127.0.0.1:5173/'))).toBe(true);
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
