import { test, expect, type Page } from '@playwright/test';
import { frameHands } from '../fixtures/hands';

async function canvasCamera(page: Page, mockLandmarks: boolean) {
  await page.evaluate(({ hands, mockLandmarks }) => {
    // WebKit automation has no physical camera. Exercise its native MediaStream,
    // video texture, worker, canvas capture, and MP4 encoder with a canvas source.
    navigator.mediaDevices.getUserMedia = async constraints => {
      if (constraints?.audio) throw new DOMException('Fixture microphone denial', 'NotAllowedError');
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
      const context = canvas.getContext('2d')!;
      const draw = () => {
        const gradient = context.createLinearGradient(0, 0, 640, 360);
        gradient.addColorStop(0, '#d26726'); gradient.addColorStop(1, '#6784d9');
        context.fillStyle = gradient; context.fillRect(0, 0, 640, 360);
        context.fillStyle = '#8ab88a'; context.fillRect((performance.now() / 50) % 640, 200, 35, 45);
      };
      draw(); const timer = setInterval(draw, 33);
      const stream = canvas.captureStream(30);
      stream.getVideoTracks()[0].addEventListener('ended', () => clearInterval(timer));
      return stream;
    };
    if (mockLandmarks) {
      window.Worker = class extends EventTarget {
        onmessage: ((event: MessageEvent) => void) | null = null;
        closed = false;
        postMessage(message: { type: string; image?: ImageBitmap; id?: number; timestamp?: number }) {
          message.image?.close();
          const result = message.type === 'INIT' ? { type: 'READY', delegate: 'CPU' } : { type: 'RESULT', id: message.id, timestamp: message.timestamp, landmarks: hands, inferenceMs: 2 };
          setTimeout(() => { if (!this.closed) this.onmessage?.(new MessageEvent('message', { data: result })); }, 2);
        }
        terminate() { this.closed = true; }
      } as unknown as typeof Worker;
    }
  }, { hands: frameHands(), mockLandmarks });
}

test('WebKit renders the window, exports a photo, and records a playable MP4', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/'); await canvasCamera(page, true);
  await page.getByRole('button', { name: 'Open your camera', exact: true }).click();
  await expect(page.getByText('Window active', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Select Mono effect' }).click();
  await page.waitForTimeout(300);
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Take photo' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.png$/);
  await page.getByRole('button', { name: 'Record video' }).click();
  await expect(page.getByRole('button', { name: 'Stop recording' })).toContainText('Stop');
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: 'Stop recording' }).click();
  const preview = page.getByLabel('Recorded video preview');
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate(video => (video as HTMLVideoElement).videoWidth)).toBeGreaterThan(0);
  await expect(page.getByText(/MP4 ·/)).toBeVisible();
  await page.getByRole('button', { name: 'Keep creating' }).click();
  await page.getByRole('button', { name: 'Close camera', exact: true }).click();
  expect(errors).toEqual([]);
});

test('WebKit loads the real MediaPipe module worker and model', async ({ page }) => {
  await page.goto('/'); await canvasCamera(page, false);
  await page.getByRole('button', { name: 'Open your camera', exact: true }).click();
  await expect(page.getByText('Make two L-shaped hands', { exact: true })).toBeVisible({ timeout: 40_000 });
  await expect(page.getByTestId('camera-canvas')).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(page.getByText('Make two L-shaped hands', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close camera', exact: true }).click();
});
