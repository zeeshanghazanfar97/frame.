import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  cacheDir: process.env.FRAME_PREVIEW_CACHE ?? 'node_modules/.vite',
  optimizeDeps:{include:['pixi.js','pixi-filters','@mediapipe/tasks-vision','@tensorflow/tfjs','@tensorflow/tfjs-backend-wasm']},
  plugins: [react()],
  worker: { format: 'es' },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
});
