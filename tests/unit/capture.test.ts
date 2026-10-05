import { afterEach, describe, expect, it, vi } from 'vitest';
import { CaptureManager, recordingFormat } from '../../src/media/capture';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('recording formats', () => {
  it('prefers MP4, falls back to WebM, and lets the browser choose if no candidate matches', () => {
    expect(recordingFormat(type => type.startsWith('video/mp4'))).toContain('video/mp4');
    expect(recordingFormat(type => type === 'video/webm')).toBe('video/webm');
    expect(recordingFormat(() => false)).toBeUndefined();
  });
});

describe('capture resource lifecycle', () => {
  it('stops a microphone granted after a cancelled recording request', async () => {
    let grant!: (stream: MediaStream) => void;
    const microphoneStop = vi.fn();
    vi.stubGlobal('MediaRecorder', { isTypeSupported: () => true });
    vi.stubGlobal('HTMLCanvasElement', { prototype: { captureStream: vi.fn() } });
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => new Promise<MediaStream>(resolve => { grant = resolve; }) } });
    const states = vi.fn();
    const manager = new CaptureManager(states, vi.fn(), vi.fn(), vi.fn());
    const start = manager.start({} as HTMLCanvasElement, true);
    await manager.stop();
    grant({ getTracks: () => [{ stop: microphoneStop }] } as unknown as MediaStream);
    await start;
    expect(microphoneStop).toHaveBeenCalledOnce();
    expect(states.mock.lastCall?.[0].phase).toBe('idle');
  });
  it('cancels the countdown without creating a recorder', async () => {
    vi.useFakeTimers();
    const captureStream = vi.fn();
    vi.stubGlobal('MediaRecorder', { isTypeSupported: () => true });
    vi.stubGlobal('HTMLCanvasElement', { prototype: { captureStream } });
    const states = vi.fn(); const manager = new CaptureManager(states, vi.fn(), vi.fn(), vi.fn());
    await manager.start({ captureStream } as unknown as HTMLCanvasElement, false);
    expect(states.mock.lastCall?.[0].countdown).toBe(3);
    await manager.stop(); vi.advanceTimersByTime(5000);
    expect(captureStream).not.toHaveBeenCalled();
    expect(states.mock.lastCall?.[0].phase).toBe('idle');
  });
});
