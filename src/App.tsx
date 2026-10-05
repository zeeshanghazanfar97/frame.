import { useCallback, useEffect, useRef, useState } from 'react';
import { Aperture, Camera, Check, ChevronLeft, ChevronRight, CircleHelp, Download, FlipHorizontal2, Maximize2, Mic, MicOff, ScanLine, Shuffle, Sparkles, Square, Video, X } from 'lucide-react';
import { CameraEngine, initialStatus, type CameraChoice } from './media/engine';
import { CaptureManager, downloadBlob, idleCapture, type SavedClip } from './media/capture';
import { availableEffects, effects, getEffect, type EffectCategory } from './media/effects';

function PoseDiagram() {
  // One inverted hand illustrates that finger roles do not fix corner orientation.
  return <svg className="pose-diagram" viewBox="0 0 320 150" role="img" aria-label="Thumb and index fingertips define a window, with one hand upside down">
    <path className="pose-window" d="M103 54 245 31 217 103 75 126Z" />
    <g transform="translate(0 150) scale(1 -1)"><path className="pose-fingers" d="M50 130 61 103 66 79 68 28Q68 18 75 19Q82 20 81 30L79 80 100 88Q110 91 106 98Q104 104 94 102L73 96" /></g>
    <path className="pose-fingers" d="M270 130 259 107 254 86 252 35Q252 25 245 26Q238 27 239 37L241 87 220 95Q210 98 214 105Q216 111 226 109L247 103" />
    <g className="pose-joints"><circle cx="75" cy="126" r="4"/><circle cx="245" cy="31" r="4"/><circle cx="103" cy="54" r="4"/><circle cx="217" cy="103" r="4"/></g>
  </svg>;
}

function EffectThumb({ name }: { name: string }) {
  return <div className={`effect-thumb thumb-${name}`} aria-hidden="true">
    <div className="thumb-sample"><span/><span/><span/><span/></div>
    {name === 'ascii' && <span className="ascii-sample">+ / # *<br/>% & @ +<br/>* / + #</span>}
    {name === 'crosshatch' && <span className="hatch-sample"/>}
  </div>;
}

const timeLabel = (seconds: number) => `0:${String(seconds).padStart(2, '0')}`;

export default function App() {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const engine = useRef<CameraEngine | null>(null);
  const capture = useRef<CaptureManager | null>(null);
  const [status, setStatus] = useState({ ...initialStatus });
  const [captureState, setCaptureState] = useState({ ...idleCapture });
  const [selected, setSelected] = useState('pixelate');
  const [strength, setStrength] = useState(100);
  const [category, setCategory] = useState<EffectCategory | 'All'>('All');
  const [cycling, setCycling] = useState(false);
  const [audio, setAudio] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [device, setDevice] = useState('');
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [notice, setNotice] = useState('');
  const [help, setHelp] = useState(false);
  const [clip, setClip] = useState<SavedClip | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const cycleElapsed = useRef(0);
  const clipRef = useRef<SavedClip | null>(null);
  const running = status.state === 'running';
  const loading = status.state === 'loading';
  const recordingBusy = captureState.phase !== 'idle';
  const current = getEffect(selected);
  const usableEffects=availableEffects(status.renderer);
  const setEffect = useCallback((id: string) => {if(getEffect(id).model)setCycling(false);setSelected(id); engine.current?.setEffect(id); cycleElapsed.current = 0; }, []);

  useEffect(() => {
    const runtime = new CameraEngine(host.current!, setStatus);
    const recorder = new CaptureManager(setCaptureState, saved => {
      if (clipRef.current) URL.revokeObjectURL(clipRef.current.url);
      clipRef.current = saved; setClip(saved);
    }, setNotice, frozen => runtime.freezeDimensions(frozen));
    runtime.onInterrupt = () => { void recorder.stop(); };
    runtime.onEffectFallback=(id,message)=>{setSelected(id);setNotice(message);};
    engine.current = runtime; capture.current = recorder;
    const visibility = async () => {
      if (document.hidden) { await recorder.stop(); runtime.stop(true); }
    };
    const pageHide = () => { void recorder.stop(); runtime.stop(true); };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', pageHide);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', pageHide);
      recorder.destroy(); runtime.stop();
      if (clipRef.current) URL.revokeObjectURL(clipRef.current.url);
    };
  }, []);

  useEffect(() => { engine.current?.setStrength(strength / 100); }, [strength]);
  useEffect(()=>{if(status.renderer==='canvas'&&!getEffect(selected).canvas)setEffect('pixelate');},[status.renderer,selected,setEffect]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 7000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!help && !clip) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const surfaces = [...document.querySelectorAll<HTMLElement>('.app-header, .workspace, .app-footer')];
    surfaces.forEach(element => { element.inert = true; });
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.querySelector<HTMLElement>('button')?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setHelp(false);
        if (clipRef.current) URL.revokeObjectURL(clipRef.current.url);
        clipRef.current = null; setClip(null);
      }
      if (event.key === 'Tab') {
        const controls = [...dialog.querySelectorAll<HTMLElement>('button, video[controls], a[href], input, select')].filter(element => !element.hasAttribute('disabled'));
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', keydown);
    return () => { surfaces.forEach(element => { element.inert = false; }); document.body.style.overflow = overflow; document.removeEventListener('keydown', keydown); previous?.focus(); };
  }, [help, clip]);
  useEffect(() => {
    if (!cycling || !running || (status.mode!=='full'&&status.phase!=='active')) return;
    const timer = setInterval(() => {
      cycleElapsed.current += 250;
      if (cycleElapsed.current >= 5000) {
        const library=availableEffects(status.renderer).filter(effect=>!effect.model);
        const next=(library.findIndex(effect=>effect.id===selected)+1)%library.length;
        setEffect(library[next].id);
      }
    }, 250);
    return () => clearInterval(timer);
  }, [cycling,running,status.phase,status.mode,status.renderer,selected,setEffect]);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const cameras = (await navigator.mediaDevices.enumerateDevices()).filter(item => item.kind === 'videoinput');
      setDevices(cameras); setDevice(engine.current?.activeDeviceId ?? '');
    } catch { /* Camera access still works if enumeration is unavailable. */ }
  }, []);
  useEffect(() => {
    navigator.mediaDevices?.addEventListener('devicechange', refreshDevices);
    return () => navigator.mediaDevices?.removeEventListener('devicechange', refreshDevices);
  }, [refreshDevices]);

  const openCamera = async (choice: CameraChoice = { facingMode: facing }) => {
    setNotice('');
    await capture.current?.stop();
    await engine.current?.start(choice);
    await refreshDevices();
  };
  const changeCamera = async (choice: CameraChoice) => {
    if (loading || transitioning) return;
    setTransitioning(true);
    try { await openCamera(choice); } finally { setTransitioning(false); }
  };
  const stopCamera = async () => {
    setTransitioning(true);
    try { await capture.current?.stop(); engine.current?.stop(); } finally { setTransitioning(false); }
  };
  const takePhoto = async () => {
    if (!running || photoBusy) return;
    setPhotoBusy(true);
    try {
      const blob = await engine.current!.photo();
      downloadBlob(blob, `frame-${selected}-${Date.now()}.png`); setNotice('Photo saved.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Your photo could not be saved.'); }
    finally { setPhotoBusy(false); }
  };
  const toggleRecording = () => {
    if (recordingBusy) { void capture.current?.stop(); return; }
    const canvas = engine.current?.canvas;
    if (canvas) { if (!CaptureManager.supported()) setNotice('This browser supports photos, but not video recording.'); else void capture.current?.start(canvas, audio); }
  };
  const adjacentEffect = (direction: number) => {
    const index=usableEffects.findIndex(effect=>effect.id===selected);
    setEffect(usableEffects[(index+direction+usableEffects.length)%usableEffects.length].id);
  };
  const keyHandler = (event: React.KeyboardEvent) => {
    if (event.target !== event.currentTarget || !running) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); adjacentEffect(-1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); adjacentEffect(1); }
    if (event.key === ' ') { event.preventDefault(); void takePhoto(); }
  };
  const fullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (stage.current?.requestFullscreen) await stage.current.requestFullscreen();
      else setNotice('Turn your phone sideways for a larger camera view.');
    } catch { setNotice('Fullscreen is unavailable. Turn your device sideways for a larger view.'); }
  };
  const dismissClip = () => { if (clipRef.current) URL.revokeObjectURL(clipRef.current.url); clipRef.current = null; setClip(null); };

  return <div className="app-shell">
    <header className="app-header">
      <a className="brand" href="/" aria-label="Frame home"><ScanLine size={29} strokeWidth={1.8}/><span>frame<span className="brand-period">.</span></span></a>
      <div className="header-center">LIVE CAMERA PLAYGROUND</div>
      <button className="help-button" onClick={() => setHelp(true)}><CircleHelp size={17}/> How it works</button>
    </header>

    <main className="workspace">
      <section className="camera-section" aria-label="Camera playground">
        <div className="section-top"><div className="eyebrow"><span className="tiny-square"/> THE VIEWFINDER</div><span className="local-label">Made on your device <Aperture size={15}/></span></div>
        <div className="apply-controls"><div className="mode-toggle" role="group" aria-label="Apply filter"><button aria-pressed={status.mode==='window'} disabled={loading} onClick={()=>void engine.current?.setMode('window')}>Hand window</button><button aria-pressed={status.mode==='full'} disabled={loading} onClick={()=>void engine.current?.setMode('full')}>Full video</button></div>{running&&<span className="render-info" title={`Frame command submission: ${status.renderMs} ms`}>{status.renderer==='webgl'?'GPU accelerated':'Compatibility mode'} · {status.fps||'—'} fps</span>}</div>
        <div className={`camera-stage ${running ? 'is-running' : ''}`} ref={stage} tabIndex={0} onKeyDown={keyHandler} aria-label="Camera view. When active, use arrow keys to switch effects or space to take a photo.">
          <div className="camera-host" ref={host}/>
          {!running && <div className="camera-empty">
            <div className="empty-frame"><span/><span/><span/><span/><ScanLine size={48} strokeWidth={1}/></div>
            <h1>{loading ? 'Getting things ready' : status.state === 'error' ? 'Let’s try that again' : status.state === 'paused' ? 'Welcome back' : 'A window to something new.'}</h1>
            <p>{loading ? (status.mode==='full'?'Your camera will be ready in a moment.':'Your camera and hand tracking will be ready in a moment.') : status.state === 'error' ? status.message : status.state === 'paused' ? 'Your camera paused while you were away. Open it to keep creating.' : status.mode==='full'?'Choose an effect and apply it to the whole video. No hand pose needed.':'Make a frame with your fingers. See the world a little differently.'}</p>
            <button className="primary-button" onClick={() => void openCamera()} disabled={loading || transitioning}>
              {loading ? <span className="spinner"/> : <Camera size={19}/>} {loading ? 'Opening camera…' : status.state === 'error' ? 'Try again' : status.state === 'paused' ? 'Resume camera' : 'Open your camera'}
            </button>
            {!loading && status.state !== 'error' && <span className="empty-note">Your video stays with you. Always.</span>}
            {loading && <button className="cancel-link" onClick={() => engine.current?.stop()}>Cancel</button>}
          </div>}
          {running && <>
            <div className="stage-top"><div className={`tracking-pill ${status.phase === 'active'||status.mode==='full' ? 'tracking-active' : ''}`} role="status"><span/>{status.message}</div><button className="stage-icon" aria-label="Fullscreen camera" onClick={() => void fullscreen()}><Maximize2 size={18}/></button></div>
            <div className="stage-bottom"><span className="effect-tag"><Sparkles size={15}/>{current.label}</span><span className="camera-live">LIVE</span></div>
          </>}
          {captureState.phase === 'countdown' && <div className="countdown-overlay" role="status"><span key={captureState.countdown}>{captureState.countdown}</span><p>Hold your frame</p></div>}
          {captureState.phase === 'recording' && <div className="recording-indicator" role="status"><span/>{timeLabel(captureState.elapsed)} / 0:30</div>}
          {!running && <div className="stage-corner-label">01 / FIND YOUR FRAME</div>}
        </div>

        <div className="capture-bar">
          <div className="capture-modes"><button className="icon-button" onClick={() => { const next = facing === 'user' ? 'environment' : 'user'; setFacing(next); if (running) void changeCamera({ facingMode: next }); }} disabled={!running || transitioning} aria-label="Flip camera" title="Flip camera"><FlipHorizontal2 size={20}/></button>
            <button className={`icon-button ${audio ? 'is-enabled' : ''}`} onClick={() => setAudio(value => !value)} disabled={recordingBusy} aria-label={audio ? 'Disable microphone' : 'Enable microphone'} aria-pressed={audio} title={audio ? 'Microphone enabled' : 'Record without sound'}>{audio ? <Mic size={20}/> : <MicOff size={20}/>}</button>
          </div>
          <div className="capture-actions"><button className="photo-button" onClick={() => void takePhoto()} disabled={!running || photoBusy || transitioning} aria-label="Take photo"><Camera size={22}/><span>Photo</span></button><button className={`record-button ${recordingBusy ? 'is-recording' : ''}`} onClick={toggleRecording} disabled={(!running && !recordingBusy) || captureState.phase === 'finalizing' || transitioning} aria-label={recordingBusy ? 'Stop recording' : 'Record video'}>{recordingBusy ? <Square size={16} fill="currentColor"/> : <Video size={21}/>}<span>{captureState.phase === 'finalizing' ? 'Saving…' : captureState.phase === 'countdown' || captureState.phase === 'permission' ? 'Cancel' : captureState.phase === 'recording' ? 'Stop' : 'Video'}</span></button></div>
          <div className="capture-end">{running ? <button className="text-button" onClick={() => void stopCamera()} disabled={transitioning}>Close camera</button> : <span>UP TO 30 SECONDS</span>}</div>
        </div>

        {running && devices.length > 1 && <div className="device-row"><label htmlFor="camera-device">Camera</label><select id="camera-device" value={device} disabled={loading || transitioning} onChange={event => void changeCamera({ deviceId: event.target.value, facingMode: facing })}>{devices.map((camera, index) => <option key={camera.deviceId} value={camera.deviceId}>{camera.label || `Camera ${index + 1}`}</option>)}</select></div>}
        <div className="pose-guide"><div className="guide-number">01</div><div><h2>{status.mode==='full'?'The whole view, transformed.':'Two hands. One little window.'}</h2><p>{status.mode==='full'?'Filters cover the entire video. Switch effects any time, or explore hands-free with auto-cycle.':'Keep both thumbs and index fingertips in view. Turn your hands any way you like, and bring them closer or farther apart.'}</p></div>{status.mode==='window'&&<div className="inline-pose"><PoseDiagram/></div>}</div>
      </section>

      <aside className="library" aria-label="Effect library">
        <div className="library-heading"><div><div className="eyebrow">THE EFFECT LIBRARY</div><h2>Pick your perspective<span>.</span></h2></div><span className="effect-count">{effects.length}</span></div>
        <div className="category-tabs" role="group" aria-label="Filter effects by category">{(['All','Color','Texture','Play','Style'] as const).map(item => <button key={item} className={category === item ? 'selected' : ''} aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}</div>
        <div className="effect-grid">{effects.filter(effect => category === 'All' || effect.category === category).map(effect => <button key={effect.id} disabled={status.renderer==='canvas'&&!effect.canvas} className={`effect-card ${selected === effect.id ? 'selected' : ''}`} onClick={() => setEffect(effect.id)} aria-pressed={selected === effect.id} aria-label={`Select ${effect.label} effect`} title={status.renderer==='canvas'&&!effect.canvas?'This effect requires GPU acceleration.':effect.description}>
          <EffectThumb name={effect.thumbnail}/><span className="effect-name">{effect.label}{selected === effect.id && <span className="selected-check"><Check size={12} strokeWidth={3}/></span>}</span>
        </button>)}</div>
        <div className="strength-control"><div><label htmlFor="strength">Effect strength</label><output htmlFor="strength">{strength}%</output></div><input id="strength" type="range" min="0" max="100" value={strength} onChange={event => setStrength(Number(event.target.value))}/></div>
        {current.model&&<p className="compatibility-note" role="status">{status.effectFps?`AI anime · ${status.effectFps} processed frames/sec`:'AI anime loads on first use.'} Image quality and frame rate adapt to your device.</p>}
        <button className={`auto-cycle ${cycling ? 'enabled' : ''}`} onClick={() => { setCycling(value => !value); cycleElapsed.current = 0; }} aria-pressed={cycling}><div className="cycle-icon"><Shuffle size={19}/></div><div><strong>Explore hands-free</strong><span>{cycling ? 'A fast effect every 5 seconds' : 'Auto-cycle through fast effects'}</span></div><span className="switch"><span/></span></button>
        {status.renderer==='canvas'&&<p className="compatibility-note">{usableEffects.length} effects available in compatibility mode. Other effects need GPU acceleration.</p>}
        <div className="library-bottom"><span>{String(effects.findIndex(effect => effect.id === selected) + 1).padStart(2, '0')} / {effects.length}</span><div><button className="small-icon" onClick={() => adjacentEffect(-1)} aria-label="Previous effect"><ChevronLeft size={18}/></button><button className="small-icon" onClick={() => adjacentEffect(1)} aria-label="Next effect"><ChevronRight size={18}/></button></div></div>
      </aside>
    </main>

    <footer className="app-footer"><span>Nothing uploaded. Just you, your camera, and a little imagination.</span><span>FRAME / CAMERA EFFECTS</span></footer>
    {notice && <div className="toast" role="status"><Check size={17}/><span>{notice}</span><button aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={16}/></button></div>}
    {help && <div className="modal-backdrop" onClick={() => setHelp(false)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={event => event.stopPropagation()}><button className="modal-close" aria-label="Close instructions" autoFocus onClick={() => setHelp(false)}><X size={20}/></button><div className="eyebrow">FIND YOUR FRAME</div><h2 id="help-title">Your fingers make the window.</h2><PoseDiagram/><ol><li>Open your camera and choose an effect.</li><li>Show both hands with your thumb and index fingertips visible. No particular pose is required.</li><li>Rotate either hand freely and move the fingertips to reshape your window.</li><li>Save a photo, or record a clip with a three-second countdown.</li></ol><p className="help-note">Good lighting and visible fingertips help tracking. Turn on auto-cycle to explore without lowering your hands.</p><button className="primary-button" onClick={() => setHelp(false)}>Got it</button></section></div>}
    {clip && <div className="modal-backdrop" onClick={dismissClip}><section className="modal clip-modal" role="dialog" aria-modal="true" aria-labelledby="clip-title" onClick={event => event.stopPropagation()}><button className="modal-close" autoFocus aria-label="Close video preview" onClick={dismissClip}><X size={20}/></button><div className="eyebrow">YOURS TO KEEP</div><h2 id="clip-title">A little moment, captured.</h2><video controls playsInline src={clip.url} aria-label="Recorded video preview"/><div className="clip-details"><span>{Math.round(clip.duration)} seconds</span><span>{clip.extension.toUpperCase()} · {(clip.blob.size / 1_000_000).toFixed(1)} MB</span></div><button className="primary-button" onClick={() => downloadBlob(clip.blob, `frame-${Date.now()}.${clip.extension}`)}><Download size={18}/>Download video</button><button className="text-button" onClick={dismissClip}>Keep creating</button></section></div>}
  </div>;
}
