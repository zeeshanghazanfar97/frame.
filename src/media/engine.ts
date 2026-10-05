import { Compositor } from './compositor';
import { CanvasRenderer } from './canvas-renderer';
import type { VideoRenderer } from './rendering';
import { getEffect } from './effects';
import { NeuralProcessor } from './neural';
import { GestureTracker } from './gesture';
import { fitSize } from './geometry';
import type { ApplyMode, EngineStatus, WorkerRequest, WorkerResponse } from './types';

export interface CameraChoice { facingMode?: 'user' | 'environment'; deviceId?: string }
export const initialStatus: EngineStatus = { state: 'idle', message: 'Your camera is off', phase: 'searching', fps: 0, inferenceMs: 0, delegate: null, quality: 1280, mode:'window', renderer:null, renderMs:0,effectFps:0 };

function cameraError(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera access was blocked. Allow camera access in your browser settings, then try again.';
  if (name === 'NotFoundError') return 'No camera found. Connect a camera and try again.';
  if (name === 'NotReadableError') return 'Your camera is busy. Close other apps using it, then try again.';
  if (name === 'OverconstrainedError') return 'This camera is unavailable. Choose another camera and try again.';
  return error instanceof Error ? error.message : 'The camera could not start. Please try again.';
}

export class CameraEngine {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private compositor: VideoRenderer | null = null;
  private worker: Worker | null = null;
  private tracker = new GestureTracker();
  private session = 0;
  private frameId = 0;
  private inFlight: { id: number; timestamp: number } | null = null;
  private animation = 0;
  private videoCallback = 0;
  private lastInference = -Infinity;
  private lastRender = -Infinity;
  private lastVideoTime = -1;
  private lastDecodedFrameAt = 0;
  private dirty = true;
  private frames = 0;
  private sampleAt = 0;
  private trackingHz = 20;
  private qualityIndex = 0;
  private readyReject: ((error: Error) => void) | null = null;
  private readyTimeout: ReturnType<typeof setTimeout> | null = null;
  private status: EngineStatus = { ...initialStatus };
  private frozen = false;
  private effectId = 'pixelate';
  private strength = 1;
  private mode: ApplyMode = 'window';
  private modeEpoch = 0;
  private renderTime = 0;
  private neural:NeuralProcessor|null=null;
  private neuralLast=0;
  private onContextLost = (event: Event) => {
    event.preventDefault();
    this.onInterrupt?.();
    this.fail('The camera view was interrupted. Restart your camera to continue.');
  };
  onInterrupt: (() => void) | null = null;
  onEffectFallback:((id:string,message:string)=>void)|null=null;

  constructor(private host: HTMLElement, private onStatus: (status: EngineStatus) => void) {}
  private publish(update: Partial<EngineStatus>): void {
    this.status = { ...this.status, ...update }; this.onStatus(this.status);
  }
  private fail(message: string): void { this.stop(); this.publish({ state: 'error', message }); }

  async start(choice: CameraChoice = { facingMode: 'user' }): Promise<void> {
    this.stop();
    const session = this.session;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      this.publish({ state: 'error', message: 'Camera access needs a secure browser connection. Open this app over HTTPS or localhost.' }); return;
    }
    if (this.mode==='window' && (!window.Worker || !window.createImageBitmap || !window.WebAssembly)) {
      this.publish({ state: 'error', message: 'This browser cannot run hand tracking. Try a recent version of Safari, Chrome, or Edge.' }); return;
    }
    this.publish({ state: 'loading', mode:this.mode, message:this.mode==='full'?'Opening camera…':'Opening camera and loading hand tracking…' });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: {
        width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 },
        ...(choice.deviceId ? { deviceId: { exact: choice.deviceId } } : { facingMode: { ideal: choice.facingMode ?? 'user' } }),
      } });
      if (session !== this.session) { stream.getTracks().forEach(t => t.stop()); return; }
      this.stream = stream;
      const video = document.createElement('video');
      video.muted = true; video.playsInline = true; video.autoplay = true;
      video.className = 'camera-source'; this.host.before(video);
      video.srcObject = stream; this.video = video;
      await video.play();
      if (session !== this.session) return;
      if (!video.videoWidth || !video.videoHeight) throw new Error('Your camera is not sending video. Restart it to try again.');
      const settings = stream.getVideoTracks()[0].getSettings();
      const mirror = settings.facingMode ? settings.facingMode !== 'environment' : choice.facingMode !== 'environment';
      const gpu=new Compositor();
      this.compositor=gpu;
      try { await gpu.init(video,this.host,1280,mirror); }
      catch (error) {
        gpu.destroy();
        if(session!==this.session) return;
        // Reopen playback if a partial GPU startup stopped the source video.
        video.srcObject=stream;await video.play();
        const fallback=new CanvasRenderer();this.compositor=fallback;
        await fallback.init(video,this.host,640,mirror);
        if(!getEffect(this.effectId).canvas)this.effectId='pixelate';
        console.info('Using Canvas 2D rendering fallback.',error);
      }
      if (session !== this.session) return;
      this.compositor.setEffect(this.effectId);
      this.compositor.canvas?.addEventListener('webglcontextlost', this.onContextLost);
      if(this.mode==='window')await this.initWorker(session);
      if (session !== this.session) return;
      this.tracker.reset(); this.sampleAt = performance.now(); this.frames = 0;
      this.qualityIndex = 0; this.trackingHz = 20; this.lastInference = -Infinity; this.lastRender = -Infinity;
      this.lastVideoTime = -1; this.lastDecodedFrameAt = performance.now(); this.dirty = true;
      this.publish({ state:'running',message:this.mode==='full'?'Full video':'Make two L-shaped hands',phase:'searching',quality:this.compositor.backend==='canvas'?640:1280,mode:this.mode,renderer:this.compositor.backend });
      this.startNeural();
      this.watchVideo(session);
      this.animation = requestAnimationFrame(now => this.render(now, session));
    } catch (error) { console.error('Camera initialization failed:', error); if (session === this.session) this.fail(cameraError(error)); }
  }

  private initWorker(session: number): Promise<void> {
    const modeEpoch=this.modeEpoch;
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./hand.worker.ts', import.meta.url), { type: 'module' });
      this.worker = worker; this.readyReject = reject;
      this.readyTimeout = setTimeout(() => reject(new Error('Hand tracking took too long to load. Check your connection and try again.')), 45_000);
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        if (session !== this.session || modeEpoch!==this.modeEpoch) return;
        const message = event.data;
        if (message.type === 'READY') {
          if (this.readyTimeout) clearTimeout(this.readyTimeout);
          this.readyTimeout = null; this.readyReject = null;
          this.publish({ delegate: message.delegate }); resolve();
        } else if (message.type === 'RESULT' && message.id === this.inFlight?.id) {
          this.inFlight = null;
          this.tracker.update(message.landmarks, message.timestamp, this.video!.videoWidth / this.video!.videoHeight);
          this.status.inferenceMs = message.inferenceMs;
        } else if (message.type === 'ERROR') {
          if (this.readyReject) reject(new Error(message.message));
          else { this.onInterrupt?.(); this.fail(message.message); }
        }
      };
      worker.onerror = () => {
        if (session !== this.session) return;
        if (this.readyReject) reject(new Error('Hand tracking could not start. Try a recent browser or restart your camera.'));
        else { this.onInterrupt?.(); this.fail('Hand tracking stopped. Restart your camera to continue.'); }
      };
      const assetRoot = new URL(`${import.meta.env.BASE_URL}models/`, location.origin).href;
      worker.postMessage({ type: 'INIT', assetRoot } satisfies WorkerRequest);
    });
  }

  private watchVideo(session: number): void {
    const video = this.video;
    if (!video || typeof video.requestVideoFrameCallback !== 'function') return;
    this.videoCallback = video.requestVideoFrameCallback(() => {
      if (session !== this.session) return;
      this.dirty = true;
      this.lastDecodedFrameAt = performance.now();
      this.detect(performance.now(), session);
      this.watchVideo(session);
    });
  }

  private async detect(timestamp: number, session: number): Promise<void> {
    const video = this.video, worker = this.worker;
    if (this.mode!=='window' || !video || !worker || this.inFlight || timestamp - this.lastInference < 1000 / this.trackingHz || video.readyState < 2) return;
    const id = ++this.frameId;
    this.inFlight = { id, timestamp }; this.lastInference = timestamp;
    let bitmap: ImageBitmap | null = null;
    try {
      const size = fitSize(video.videoWidth, video.videoHeight, 640);
      try { bitmap = await createImageBitmap(video, { resizeWidth: size.width, resizeHeight: size.height }); }
      catch { bitmap = await createImageBitmap(video); }
      if (session !== this.session || worker !== this.worker) { bitmap.close(); return; }
      worker.postMessage({ type: 'FRAME', id, timestamp, image: bitmap } satisfies WorkerRequest, [bitmap]);
    } catch {
      (bitmap as ImageBitmap | null)?.close();
      if (session === this.session) { this.inFlight = null; this.onInterrupt?.(); this.fail('Your browser could not process camera frames. Restart your camera or try another browser.'); }
    }
  }

  private render(now: number, session: number): void {
    if (session !== this.session || !this.video || !this.compositor) return;
    if (this.inFlight && now - this.inFlight.timestamp > 5000) { this.onInterrupt?.(); this.fail('Hand tracking stopped responding. Restart your camera to continue.'); return; }
    // Some browsers suspend decoded-frame callbacks for a video covered by a canvas.
    // Poll snapshots if callbacks stall, retaining one inference in flight.
    if ((typeof this.video.requestVideoFrameCallback !== 'function' && this.video.currentTime !== this.lastVideoTime) || now - this.lastDecodedFrameAt > 150) {
      this.lastVideoTime = this.video.currentTime; this.dirty = true; void this.detect(now, session);
    }
    if (now - this.lastRender >= 31) {
      const portal = this.tracker.state(now);
      if(this.neural && this.strength>0 && (this.mode==='full'||portal.visibility>0))void this.neural.request(this.video,now);
      const started=performance.now();
      try { this.compositor.render(portal, this.strength, now / 1000, this.dirty,this.mode); }
      catch { this.onInterrupt?.(); this.fail('The camera effect could not render. Restart your camera to try again.'); return; }
      this.renderTime+=performance.now()-started;
      this.dirty = false; this.lastRender = now; this.frames++;
      const message = this.mode==='full'?'Full video':portal.phase === 'active' ? 'Window active' : portal.phase === 'candidate' ? 'Hold that pose…' : portal.phase === 'lost' ? 'Finding your fingertips…' : 'Make two L-shaped hands';
      if (portal.phase !== this.status.phase) this.publish({ phase: portal.phase, message });
      if (now - this.sampleAt >= 2000) {
        const fps = this.frames / ((now - this.sampleAt) / 1000);
        if (!this.frozen && (fps < 24 || this.status.inferenceMs > 70) && this.qualityIndex < 2) {
          this.qualityIndex++;
          this.trackingHz = [20, 15, 10][this.qualityIndex];
          this.compositor.resize([1280, 960, 640][this.qualityIndex], this.video.videoWidth, this.video.videoHeight);
        }
        this.publish({ fps:Math.round(fps),quality:this.compositor.backend==='canvas'?640:[1280,960,640][this.qualityIndex],renderMs:Math.round(this.renderTime/Math.max(1,this.frames)*10)/10 });
        this.frames = 0;this.renderTime=0; this.sampleAt = now;
      }
    }
    this.animation = requestAnimationFrame(next => this.render(next, session));
  }

  setEffect(id: string): void { if(this.compositor?.backend==='canvas'&&!getEffect(id).canvas)return;this.neural?.stop();this.neural=null;this.effectId = id; this.compositor?.setEffect(id);this.publish({effectFps:0});if(this.status.state==='running')this.startNeural(); }
  private startNeural():void{
    const spec=getEffect(this.effectId).model;if(!spec)return;
    if(!window.Worker||!window.OffscreenCanvas||!window.createImageBitmap){this.setEffect('cartoon');this.onEffectFallback?.('cartoon','AI anime requires a recent browser. Cartoon is available.');return;}
    this.neuralLast=0;
    this.neural=new NeuralProcessor((original,styled)=>{
      this.compositor?.setNeuralFrame(original,styled);original.close();styled.close();
      const now=performance.now();this.publish({effectFps:this.neuralLast?Math.max(.1,Math.round(10000/(now-this.neuralLast))/10):0});this.neuralLast=now;
    },message=>{this.setEffect('cartoon');this.onEffectFallback?.('cartoon',message);});
    this.neural.start(spec);
  }
  async setMode(mode: ApplyMode):Promise<void>{
    if(this.mode===mode)return;
    this.mode=mode;this.modeEpoch++;this.tracker.reset();
    if(mode==='full'){
      this.readyReject?.(new Error('Tracking cancelled.'));this.readyReject=null;
      if(this.readyTimeout)clearTimeout(this.readyTimeout);this.readyTimeout=null;
      this.worker?.terminate();this.worker=null;this.inFlight=null;
      this.publish({mode,delegate:null,inferenceMs:0,phase:'searching',message:'Full video'});
    }else{
      this.publish({mode,phase:'searching',message:'Loading hand tracking…'});
      if(this.status.state==='running'){
        try{await this.initWorker(this.session);this.publish({message:'Make two L-shaped hands'});}
        catch(error){if(this.mode==='window'){await this.setMode('full');this.publish({message:error instanceof Error?error.message:'Hand tracking unavailable. Full video is available.'});}}
      }
    }
  }
  setStrength(value: number): void { this.strength = Math.max(0, Math.min(1, value)); }
  freezeDimensions(value: boolean): void { this.frozen = value; }
  get canvas(): HTMLCanvasElement | null { return this.compositor?.canvas ?? null; }
  photo(): Promise<Blob> { return this.compositor ? this.compositor.photo() : Promise.reject(new Error('Open your camera before taking a photo.')); }
  get activeDeviceId(): string | undefined { return this.stream?.getVideoTracks()[0].getSettings().deviceId; }

  stop(paused = false): void {
    this.session++;this.modeEpoch++;
    this.neural?.stop();this.neural=null;
    this.readyReject?.(new Error('Camera startup was cancelled.')); this.readyReject = null;
    if (this.readyTimeout) clearTimeout(this.readyTimeout); this.readyTimeout = null;
    cancelAnimationFrame(this.animation);
    if (this.videoCallback && this.video && 'cancelVideoFrameCallback' in this.video) this.video.cancelVideoFrameCallback(this.videoCallback);
    this.videoCallback = 0;
    this.worker?.terminate(); this.worker = null; this.inFlight = null;
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = null;
    if (this.video) { this.video.pause(); this.video.srcObject = null; this.video.remove(); this.video = null; }
    if (this.compositor) {
      this.compositor.canvas?.removeEventListener('webglcontextlost', this.onContextLost);
      this.compositor.destroy(); this.compositor = null;
    }
    this.host.replaceChildren(); this.tracker.reset(); this.frozen = false;
    this.publish({ ...initialStatus,mode:this.mode, state: paused ? 'paused' : 'idle', message: paused ? 'Camera paused while you were away' : initialStatus.message });
  }
}
