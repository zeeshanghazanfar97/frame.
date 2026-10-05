import type { ApplyMode, PortalState, RenderBackend } from './types';
export interface VideoRenderer {
  readonly backend: RenderBackend;
  readonly canvas: HTMLCanvasElement | null;
  init(video: HTMLVideoElement, host: HTMLElement, longEdge: number, mirror: boolean): Promise<void>;
  setEffect(id: string): void;
  setNeuralFrame(original: ImageBitmap, styled: ImageBitmap): void;
  clearNeuralFrame(): void;
  resize(longEdge: number, sourceWidth: number, sourceHeight: number): void;
  render(portal: PortalState, strength: number, seconds: number, newFrame: boolean, mode?: ApplyMode): void;
  photo(): Promise<Blob>;
  destroy(): void;
}
