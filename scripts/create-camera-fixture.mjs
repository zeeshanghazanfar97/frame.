import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const width = 320, height = 180;
const luma = Buffer.alloc(width * height), u = Buffer.alloc(width * height / 4), v = Buffer.alloc(width * height / 4);
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  luma[y * width + x] = 75 + Math.floor(x / width * 90) + (Math.floor(x / 10) % 2) * 20;
}
for (let y = 0; y < height / 2; y++) for (let x = 0; x < width / 2; x++) {
  u[y * width / 2 + x] = 95 + Math.floor(y / height * 100);
  v[y * width / 2 + x] = 180 - Math.floor(x / width * 50);
}
await mkdir('.sites-runtime', { recursive: true });
const frames = Array.from({ length: 60 }, (_, i) => Buffer.concat([Buffer.from('FRAME\n'), Buffer.from(luma.map(value => value + i % 3)), u, v]));
await writeFile('.sites-runtime/camera.y4m', Buffer.concat([Buffer.from(`YUV4MPEG2 W${width} H${height} F30:1 Ip A1:1 C420jpeg\n`), ...frames]));
console.log(resolve('.sites-runtime/camera.y4m'));
