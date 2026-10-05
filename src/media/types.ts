export interface Point { x: number; y: number }
export interface Landmark extends Point { z: number }
export type Corners = [Point, Point, Point, Point];
export type GesturePhase = 'searching' | 'candidate' | 'active' | 'lost';
export interface PortalState { corners: Corners | null; visibility: number; phase: GesturePhase }
export interface EngineStatus {
  state: 'idle' | 'loading' | 'running' | 'paused' | 'error';
  message: string;
  phase: GesturePhase;
  fps: number;
  inferenceMs: number;
  delegate: 'GPU' | 'CPU' | null;
  quality: number;
}
export type WorkerRequest =
  | { type: 'INIT'; assetRoot: string }
  | { type: 'FRAME'; id: number; timestamp: number; image: ImageBitmap }
  | { type: 'CLOSE' };
export type WorkerResponse =
  | { type: 'READY'; delegate: 'GPU' | 'CPU' }
  | { type: 'RESULT'; id: number; timestamp: number; landmarks: Landmark[][]; inferenceMs: number }
  | { type: 'ERROR'; message: string; id?: number };
