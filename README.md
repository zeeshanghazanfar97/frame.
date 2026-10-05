# Frame

A browser camera playground: make two L-shaped hands to reveal an effect inside a fingertip-controlled quadrilateral. Includes 12 presets, a strength slider, manual selection, hands-free auto-cycle, PNG photos, and clips up to 30 seconds with optional microphone audio.

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
2. Point each index finger up and each thumb toward the other hand. Fold the other fingers. Keep both hands in good light and fully in view.
3. Hold the pose briefly, then move the fingertips to tilt and reshape the window.
4. Save a photo or start a video. Recording has a three-second countdown and stops automatically at 30 seconds. Enable the microphone before recording if wanted; permission denial falls back to silent recording.

Auto-cycle advances through all 12 effects every five seconds of an active pose. Manual selection resets the cycle timer. Focus the camera view and use left/right arrow keys to switch effects or space to take a photo. Camera switching finishes any current clip first. Backgrounding the page saves a recording and pauses the camera; resume explicitly when returning.

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
- Tracking uses thumb tips (4) and index tips (8), aspect-corrected geometric L-pose recognition, temporal wrist matching, convexity checks, and One Euro smoothing. Activation takes 150 ms; dropout holds for 120 ms and fades over 100 ms.
- Pixi renders the raw and selected filtered views from the same source frame, then composites a 1.5-pixel softened polygon edge. Filtering happens before masking. Front-camera mirroring is applied once to the final image, including exports.
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

Unit tests cover pose classification, invalid polygons, orientation, smoothing, activation/loss timing, and capture cancellation. Chromium browser tests use a generated Y4M camera feed and deterministic landmark responses to exercise the real GPU compositor, exports, microphone behavior, auto-cycle, camera changes, and cleanup. WebKit checks use a canvas-generated MediaStream to verify rendering, PNG export, and playable MP4 recording. Both engines also load the real MediaPipe model/WASM worker with synthetic feeds. No test-only hooks are shipped in the application.

Browser automation uses software graphics and simulated inputs. It **does not establish physical camera accuracy or phone performance**. Before treating mobile support as fully validated, run on an iPhone 13 or newer using Safari, a Pixel 6 or equivalent using Chrome, and desktop Chrome/Edge/Safari. Check every preset in portrait and landscape, camera switching, saved image alignment, audio/video playback, screen locking, and thermal behavior during repeated clips. Performance goals are at least 24 FPS and less than 150 ms of steady-state fingertip-to-window delay; initial pose activation intentionally has its own 150 ms debounce.

## Build and host

`npm run build` creates a static `dist` directory. Host the whole directory over HTTPS, including `models/`, and serve `.wasm` as `application/wasm`, module loader files as JavaScript, and the `.task` model as binary data. Vite's `base` must match the deployment path if using a subdirectory. `.openai/hosting.json` configures the Sites static deployment. No runtime secrets, database, or video server are needed.

## Open-source components

React, PixiJS, and pixi-filters use MIT licenses; MediaPipe uses Apache-2.0; Lucide icons use ISC. The model is Google's MediaPipe HandLandmarker float16 revision 1. See `THIRD_PARTY_NOTICES.md` and the upstream model card for component and model notices.

This first release uses live cameras and local downloads. Accounts, cloud storage, uploaded-video editing, and learned anime transformations are outside this version.
