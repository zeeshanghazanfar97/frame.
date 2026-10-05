export type CapturePhase = 'idle' | 'permission' | 'countdown' | 'recording' | 'finalizing';
export interface CaptureState { phase: CapturePhase; countdown: number; elapsed: number }
export const idleCapture: CaptureState = { phase: 'idle', countdown: 0, elapsed: 0 };
export interface SavedClip { blob: Blob; url: string; extension: 'mp4' | 'webm'; duration: number }

export function recordingFormat(isSupported: (type: string) => boolean, withAudio = false): string | undefined {
  return [withAudio ? 'video/mp4;codecs=avc1.42E01E,mp4a.40.2' : 'video/mp4;codecs=avc1.42E01E', 'video/mp4', withAudio ? 'video/webm;codecs=vp8,opus' : 'video/webm;codecs=vp8', 'video/webm'].find(isSupported);
}
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export class CaptureManager {
  private recorder: MediaRecorder | null = null;
  private microphone: MediaStream | null = null;
  private canvasStream: MediaStream | null = null;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private progressTimer: ReturnType<typeof setInterval> | null = null;
  private maxTimer: ReturnType<typeof setTimeout> | null = null;
  private token = 0;
  private startedAt = 0;
  private finish: Promise<void> | null = null;
  private finishResolve: (() => void) | null = null;
  private state: CaptureState = { ...idleCapture };
  private destroyed = false;

  constructor(
    private onState: (state: CaptureState) => void,
    private onClip: (clip: SavedClip) => void,
    private onNotice: (message: string) => void,
    private freeze: (value: boolean) => void,
  ) {}
  private publish(update: Partial<CaptureState>): void { this.state = { ...this.state, ...update }; if (!this.destroyed) this.onState(this.state); }
  static supported(): boolean { return typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function'; }

  async start(canvas: HTMLCanvasElement, withAudio: boolean): Promise<void> {
    if (this.state.phase !== 'idle' || this.destroyed) return;
    if (!CaptureManager.supported()) { this.onNotice('Video recording is unavailable in this browser. You can still save photos.'); return; }
    const token = ++this.token;
    if (withAudio) {
      this.publish({ phase: 'permission' });
      try {
        const microphone = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        if (token !== this.token || this.destroyed) { microphone.getTracks().forEach(t => t.stop()); return; }
        this.microphone = microphone;
      } catch {
        if (token !== this.token || this.destroyed) return;
        this.onNotice('Microphone unavailable. Your clip will be recorded without sound.');
      }
    }
    if (token !== this.token || this.destroyed) return;
    this.publish({ phase: 'countdown', countdown: 3, elapsed: 0 });
    this.countdownTimer = setInterval(() => {
      const countdown = this.state.countdown - 1;
      if (countdown <= 0) {
        this.clearCountdown();
        this.beginRecording(canvas);
      } else this.publish({ countdown });
    }, 1000);
  }

  private beginRecording(canvas: HTMLCanvasElement): void {
    const chunks: Blob[] = [];
    try {
      this.canvasStream = canvas.captureStream(30);
      const stream = new MediaStream([...this.canvasStream.getVideoTracks(), ...(this.microphone?.getAudioTracks() ?? [])]);
      const mimeType = recordingFormat(type => MediaRecorder.isTypeSupported(type), !!this.microphone);
      const recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 5_000_000 });
      this.recorder = recorder;
      this.finish = new Promise(resolve => { this.finishResolve = resolve; });
      let failed = false;
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => { failed = true; if (!this.destroyed) this.onNotice('Recording could not finish. Try a shorter clip or another browser.'); void this.stop(); };
      recorder.onstop = () => {
        const duration = Math.min(30, (performance.now() - this.startedAt) / 1000);
        const type = recorder.mimeType || mimeType || chunks[0]?.type || 'video/webm';
        const blob = new Blob(chunks, { type });
        this.cleanup(); this.publish({ ...idleCapture });
        if (!this.destroyed && !failed && blob.size) this.onClip({ blob, url: URL.createObjectURL(blob), extension: type.includes('mp4') ? 'mp4' : 'webm', duration });
        this.finishResolve?.(); this.finishResolve = null; this.finish = null;
      };
      this.freeze(true); this.startedAt = performance.now();
      recorder.start(250);
      this.publish({ phase: 'recording', countdown: 0, elapsed: 0 });
      this.progressTimer = setInterval(() => this.publish({ elapsed: Math.min(30, Math.floor((performance.now() - this.startedAt) / 1000)) }), 250);
      this.maxTimer = setTimeout(() => { void this.stop(); }, 30_000);
    } catch {
      this.cleanup(); this.publish({ ...idleCapture });
      this.finishResolve?.(); this.finishResolve = null; this.finish = null;
      this.onNotice('Video recording could not start. You can still save a photo.');
    }
  }

  async stop(): Promise<void> {
    this.token++; this.clearCountdown();
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.publish({ phase: 'finalizing' });
      const finish = this.finish;
      this.recorder.stop();
      await finish;
    } else if (this.state.phase === 'finalizing' && this.finish) await this.finish;
    else { this.cleanup(); this.publish({ ...idleCapture }); }
  }
  private clearCountdown(): void { if (this.countdownTimer) clearInterval(this.countdownTimer); this.countdownTimer = null; }
  private cleanup(): void {
    this.clearCountdown();
    if (this.progressTimer) clearInterval(this.progressTimer); this.progressTimer = null;
    if (this.maxTimer) clearTimeout(this.maxTimer); this.maxTimer = null;
    this.microphone?.getTracks().forEach(t => t.stop()); this.microphone = null;
    this.canvasStream?.getTracks().forEach(t => t.stop()); this.canvasStream = null;
    this.recorder = null; this.freeze(false);
  }
  destroy(): void { this.destroyed = true; void this.stop(); }
}
