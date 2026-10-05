# Third-party components

This project uses the following open-source components. Preserve their upstream license and copyright notices when distributing bundled code.

| Component | License | Source |
| --- | --- | --- |
| React / ReactDOM | MIT | https://github.com/facebook/react |
| PixiJS | MIT | https://github.com/pixijs/pixijs |
| PixiJS Filters | MIT | https://github.com/pixijs/filters |
| MediaPipe Tasks Vision and bundled WASM | Apache-2.0 | https://github.com/google-ai-edge/mediapipe |
| Lucide icons | ISC | https://github.com/lucide-icons/lucide |
| TensorFlow.js and WASM backend | Apache-2.0 | https://github.com/tensorflow/tfjs |
| DCT-Net anime head model | Apache-2.0 | https://modelscope.cn/models/damo/cv_unet_person-image-cartoon_compound-models/summary |

The DCT-Net model is Alibaba's officially published `cartoon_h.pb`, SHA-256 `338e7bf7ab4014ba9da864c2dda104f26d8af6c7f468038782d92ccc8e2dedda`. Its official ModelScope metadata identifies the model license as Apache License 2.0. Frame extracts the frozen graph constants into TensorFlow.js weight files, preserving network operators and weights. This is the anime head generator alone; the original compound pipeline's face detection, alignment, and background blending are not included. See `public/models/dct-anime/provenance.json` and the included `public/licenses/dct-net.txt`.

The bundled hand-landmark model is the MediaPipe HandLandmarker float16 model, revision 1, licensed under Apache-2.0 according to Google's linked model card, and downloaded from:

https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task

Model documentation and model card:

https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker

https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Hand%20Tracking%20%28Lite_Full%29%20with%20Fairness%20Oct%202021.pdf

MediaPipe WASM loader files include Google's Apache-2.0 license header. Full license texts for the redistributed packages are included under `public/licenses/` and in the static deployment.
