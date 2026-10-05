import { mkdir, readdir, copyFile, stat, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const destination = resolve('public/models');
await mkdir(`${destination}/wasm`, { recursive: true });
const source = resolve('node_modules/@mediapipe/tasks-vision/wasm');
for (const file of await readdir(source)) {
  if (/\.(wasm|js)$/.test(file)) await copyFile(`${source}/${file}`, `${destination}/wasm/${file}`);
}
const model = `${destination}/hand_landmarker.task`;
const exists = await stat(model).then(s => s.size > 1_000_000).catch(() => false);
if (!exists) {
  const url = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Model download failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1_000_000) throw new Error('Model download was incomplete.');
  await writeFile(`${model}.tmp`, bytes);
  await rename(`${model}.tmp`, model);
}
console.log('MediaPipe model and WASM assets are available from the app origin.');
await mkdir('public/models/style-wasm',{recursive:true});
for(const file of await readdir('node_modules/@tensorflow/tfjs-backend-wasm/dist')){
  if(file.endsWith('.wasm'))await copyFile(`node_modules/@tensorflow/tfjs-backend-wasm/dist/${file}`,`public/models/style-wasm/${file}`);
}
