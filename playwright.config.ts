import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';
const previewUrl=process.env.FRAME_PREVIEW_URL??'http://127.0.0.1:5173';

export default defineConfig({
  testDir: './tests/browser',
  timeout: 45_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: previewUrl,
    permissions: ['camera', 'microphone'],
    trace: 'retain-on-failure',
    launchOptions: { args: [
      '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
      `--use-file-for-fake-video-capture=${resolve('.sites-runtime/camera.y4m')}`,
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    ] },
  },
  projects: [
    { name: 'chromium', testIgnore: '**/webkit.spec.ts', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1050 } } },
    { name: 'webkit', testMatch: '**/webkit.spec.ts', use: { ...devices['Desktop Safari'], permissions: [], launchOptions: { args: [] }, viewport: { width: 1200, height: 900 } } },
  ],
  webServer: { command: `npm run dev -- --port ${new URL(previewUrl).port}`, url:previewUrl, reuseExistingServer: !process.env.CI },
});
