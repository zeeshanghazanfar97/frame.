# Third-party components

This project uses the following open-source components. Preserve their upstream license and copyright notices when distributing bundled code.

| Component | License | Source |
| --- | --- | --- |
| React / ReactDOM | MIT | https://github.com/facebook/react |
| PixiJS | MIT | https://github.com/pixijs/pixijs |
| PixiJS Filters | MIT | https://github.com/pixijs/filters |
| MediaPipe Tasks Vision and bundled WASM | Apache-2.0 | https://github.com/google-ai-edge/mediapipe |
| Lucide icons | ISC | https://github.com/lucide-icons/lucide |

The bundled hand-landmark model is the MediaPipe HandLandmarker float16 model, revision 1, licensed under Apache-2.0 according to Google's linked model card, and downloaded from:

https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task

Model documentation and model card:

https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker

https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Hand%20Tracking%20%28Lite_Full%29%20with%20Fairness%20Oct%202021.pdf

MediaPipe WASM loader files include Google's Apache-2.0 license header. Full license texts for the redistributed packages are included under `public/licenses/` and in the static deployment.
