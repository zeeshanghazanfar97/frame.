# Frame

A browser camera playground with **25 effects**. Show both hands to reveal an effect inside a fingertip-controlled polygon, or choose **Full video** to apply it everywhere without gestures. Includes Cartoon, a fast Anime palette, learned Anime AI, a strength slider, manual selection, hands-free auto-cycle, PNG photos, and clips up to 30 seconds with optional microphone audio.

## Run locally

Requires Node.js 24+ and npm.

```sh
npm ci
npm run assets
npm run dev
```

Open the URL printed by Vite. Camera access works on localhost; other hosts must use HTTPS. The checked-in model and WASM files make the deployed app independent of external model CDNs. `npm run assets` copies WASM from the pinned package and downloads model revision 1 if missing. Commit regenerated assets when changing the MediaPipe dependency.

## Use

1. Open your camera and choose an effect. Front-facing views are mirrored; rear-camera views are not.
2. Choose **Hand window** or **Full video**. In Hand window mode, keep both hands and their thumb/index fingertips visible. Either hand can be rotated or inverted; no L pose, curled fingers, minimum hand separation, or minimum fingertip spread is required.
3. Keep both hands tracked briefly, then move any fingertip to reshape the window.
4. Save a photo or start a video. Recording has a three-second countdown and stops automatically at 30 seconds. Enable the microphone before recording if wanted; permission denial falls back to silent recording.

Auto-cycle advances through fast effects every five seconds of an active pose, or continuously in Full video mode. Selecting Anime AI pauses cycling so its model can finish loading and processing. Manual selection resets the cycle timer. Focus the camera view and use left/right arrow keys to switch effects or space to take a photo. Switching between Full video and Hand window keeps the camera and recording running. Camera switching finishes any current clip first. Backgrounding the page saves a recording and pauses the camera; resume explicitly when returning.

## Architecture

```text
getUserMedia → HTMLVideoElement → one GPU video texture
                         ├─ reduced ImageBitmap → MediaPipe worker → landmarks
                         │                          → gesture + smoothing → polygon
                         └─ raw / selected effect render targets → polygon blend
                                                           → mirrored output canvas
                                                           → PNG / MediaRecorder
```

- React owns controls and lightweight status updates. `src/media` owns the independent camera, gesture, rendering, worker, and recording lifecycles.
- MediaPipe runs in a module worker with GPU initialization and CPU fallback. Initialization uses the module WASM loader. A single frame may be in flight; excess frames are skipped and images are closed after inference.
- Tracking uses thumb tips (4) and index tips (8), temporal hand matching, and One Euro smoothing on each identified fingertip before geometric perimeter ordering. No pose, angle, palm-size, convexity, or distance gates are applied. Angular sorting connects all four tips without crossed edges, including concave shapes. Activation takes 150 ms; dropout holds for 120 ms and fades over 100 ms.
- Pixi samples the original video texture directly and renders only the selected effect into one target. A custom mesh blends the two images directly onto the output canvas, with inward edge softening that adapts to small polygons. Filtering happens before masking. Mirroring is applied once in the final shader, including exports. A controlled comparison against the original renderer measured **3 draw calls instead of 6** per filtered frame; submission timing is a browser benchmark, not a hardware FPS guarantee.
- Full video mode does not initialize MediaPipe or request hand inference frames. Switching back initializes tracking lazily. Unsupported GPU initialization uses a real Canvas 2D renderer at a maximum 640-pixel long edge. Unsupported effects are visibly disabled instead of silently replaced; colors, pixelation, cartoon styling, and learned-model frames have fallback paths.
- `src/media/filter-catalog.json` defines effect labels, categories, upstream library classes, options, and model URLs. Add a compatible Pixi filter by adding a JSON entry with its exported class name and options. The shared adapter creates and disposes it. Color matrices and the cel-shading family have shared providers. No remote JavaScript is executed.
- Anime AI uses Alibaba's Apache-2.0 DCT-Net anime head generator, converted without changing numerical weights. A separate worker prefers TensorFlow.js WebGL and falls back to single-threaded WASM. It processes one frame at a time and reduces resolution under load. Its output and original snapshot stay paired so the window does not mix different moments. The head generator is applied across the image; the original compound model's face alignment/background blending is not included.
- Learned conversion has a lower adaptive processing cadence than graphic effects. The UI reports processed frames per second separately from canvas FPS. Its model/runtime load only on selection. The fast Cartoon and Anime palette effects remain available without a model download.
- Rendering targets 30 FPS with a 1280-pixel maximum long edge, tracking at up to 20 Hz with 640-pixel snapshots. Low throughput reduces output to 960 then 640 pixels and tracking to 15 then 10 Hz. Output dimensions are fixed during recording. A polling fallback handles suspended decoded-frame callbacks.
- Recording uses the supported MP4/H.264 format where available, then WebM/VP8. No transcoding or backend processing is performed. Files are held in memory until downloaded or dismissed, and object URLs are revoked afterward.
- Camera and microphone frames, landmarks, photos, and recordings are not uploaded. The app makes same-origin asset requests only and includes no analytics.

## Validation

```sh
npm test
npx playwright install chromium webkit
npm run test:e2e
npm run build
```

Unit tests cover unrestricted fingertip tracking, inverted/right-angle hands, tiny and degenerate polygons, corner ordering, smoothing, activation/loss timing, capture cancellation, and catalog extensibility. Chromium browser tests use a generated Y4M camera feed and deterministic landmark responses to exercise the real GPU compositor, exports, microphone behavior, auto-cycle, camera changes, cleanup, full-video mode, and disabled-WebGL fallback. A frozen original renderer is used only in the draw-call benchmark. WebKit checks use a canvas-generated MediaStream to verify rendering, PNG export, and playable MP4 recording. Both engines also load real hand and anime models with synthetic feeds. No test-only hooks are shipped in the application.

Browser automation uses software graphics and simulated inputs. It **does not establish physical camera accuracy or phone performance**. Before treating mobile support as fully validated, run on an iPhone 13 or newer using Safari, a Pixel 6 or equivalent using Chrome, and desktop Chrome/Edge/Safari. Check every preset in portrait and landscape, camera switching, saved image alignment, audio/video playback, screen locking, and thermal behavior during repeated clips. Performance goals are at least 24 FPS and less than 150 ms of steady-state fingertip-to-window delay; initial pose activation intentionally has its own 150 ms debounce.

## Build and host

`npm run build` creates a static `dist` directory. Host the whole directory over HTTPS, including `models/`, and serve `.wasm` as `application/wasm`, module loader files as JavaScript, and the `.task` model as binary data. Vite's `base` must match the deployment path if using a subdirectory. `.openai/hosting.json` configures the Sites static deployment. No runtime secrets, database, or video server are needed.

## Open-source components

React, PixiJS, and pixi-filters use MIT licenses; MediaPipe uses Apache-2.0; Lucide icons use ISC. The model is Google's MediaPipe HandLandmarker float16 revision 1. See `THIRD_PARTY_NOTICES.md` and the upstream model card for component and model notices.

This release uses live cameras and local downloads. Accounts, cloud storage, and uploaded-video editing are outside this version. TensorFlow.js and DCT-Net use Apache-2.0; model provenance and source checksum are included with the assets. To reproduce conversion, download the official `cartoon_h.pb` revision recorded in `public/models/dct-anime/provenance.json` and run `node scripts/convert-dct-model.mjs /path/to/cartoon_h.pb`; the exporter checks the source checksum before writing any model files.

Fingertip coordinates still depend on the camera and MediaPipe detecting both hands. Occlusion, blur, and out-of-view hands can interrupt tracking. Coincident or collinear tips remain tracked but have zero area, so there is no visible filtered interior; very small polygons are limited by output pixel resolution. The GPU mask uses an even-odd point-in-polygon test, and Canvas uses a path clip, so inward/concave corners work in both renderers.
