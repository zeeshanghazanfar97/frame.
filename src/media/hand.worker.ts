/// <reference lib="webworker" />
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import type { WorkerRequest, WorkerResponse } from './types';

let task: HandLandmarker | null = null;
let closing = false;
const send = (message: WorkerResponse) => self.postMessage(message);

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (message.type === 'CLOSE') { closing = true; task?.close(); task = null; self.close(); return; }
  if (message.type === 'INIT') {
    try {
      const files = await FilesetResolver.forVisionTasks(`${message.assetRoot}wasm`, true);
      for (const delegate of ['GPU', 'CPU'] as const) {
        try {
          const created = await HandLandmarker.createFromOptions(files, {
            baseOptions: { modelAssetPath: `${message.assetRoot}hand_landmarker.task`, delegate },
            runningMode: 'VIDEO', numHands: 2,
            minHandDetectionConfidence: 0.55, minHandPresenceConfidence: 0.55, minTrackingConfidence: 0.55,
          });
          if (closing) { created.close(); return; }
          task = created; send({ type: 'READY', delegate }); return;
        } catch (error) { if (delegate === 'CPU') throw error; }
      }
    } catch (error) { console.error('Hand tracking initialization failed:', error); send({ type: 'ERROR', message: 'Hand tracking could not load. Check your connection and try again.' }); }
  }
  if (message.type === 'FRAME') {
    try {
      if (!task) throw new Error('Tracking is not ready.');
      const start = performance.now();
      const result = task.detectForVideo(message.image, message.timestamp);
      send({ type: 'RESULT', id: message.id, timestamp: message.timestamp, landmarks: result.landmarks, inferenceMs: performance.now() - start });
    } catch { send({ type: 'ERROR', id: message.id, message: 'Hand tracking stopped. Restart your camera to try again.' }); }
    finally { message.image.close(); }
  }
};
