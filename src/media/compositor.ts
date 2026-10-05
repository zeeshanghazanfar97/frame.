import { Application, Container, Filter, GlProgram, Rectangle, RenderTexture, Sprite, Texture, VideoSource } from 'pixi.js';
import { getEffect, type EffectInstance } from './effects';
import { fitSize } from './geometry';
import type { PortalState } from './types';

const vertex = `
precision highp float;
in vec2 aPosition;
out vec2 vTextureCoord;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
void main() {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  gl_Position = vec4(position, 0.0, 1.0);
  vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
}`;
const fragment = `
precision highp float;
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform sampler2D uRawTexture;
uniform vec4 uInputSize;
uniform vec4 uTop;
uniform vec4 uBottom;
uniform vec2 uSize;
uniform float uVisibility;
uniform float uStrength;
float edge(vec2 a, vec2 b, vec2 p) {
  vec2 direction = (b - a) * uSize;
  vec2 offset = (p - a) * uSize;
  return (direction.x * offset.y - direction.y * offset.x) / max(length(direction), 0.001);
}
void main() {
  // Filter buffers can be rounded up; raw and filtered images use the same UV scale.
  vec2 uv = vTextureCoord * uInputSize.xy / uSize;
  vec2 a = uTop.xy; vec2 b = uTop.zw; vec2 c = uBottom.xy; vec2 d = uBottom.zw;
  float direction = sign((b.x-a.x)*(c.y-b.y) - (b.y-a.y)*(c.x-b.x));
  float nearEdge = min(min(direction*edge(a,b,uv), direction*edge(b,c,uv)),
                       min(direction*edge(c,d,uv), direction*edge(d,a,uv)));
  float mask = smoothstep(-0.75, 0.75, nearEdge) * uVisibility * uStrength;
  vec4 raw = texture(uRawTexture, uv);
  vec4 filtered = texture(uTexture, vTextureCoord);
  finalColor = mix(raw, filtered, mask);
}`;

export class Compositor {
  readonly app = new Application();
  private raw!: RenderTexture;
  private filtered!: RenderTexture;
  private combined!: RenderTexture;
  private source!: VideoSource;
  private videoTexture!: Texture;
  private sourceSprite!: Sprite;
  private mixSprite!: Sprite;
  private display!: Sprite;
  private sourceStage = new Container();
  private mixStage = new Container();
  private mixFilter!: Filter;
  private effect: EffectInstance | null = null;
  private effectId = 'pixelate';
  private mirror = true;
  private width = 0;
  private height = 0;
  private destroyed = false;

  async init(video: HTMLVideoElement, host: HTMLElement, longEdge: number, mirror: boolean): Promise<void> {
    const size = fitSize(video.videoWidth, video.videoHeight, longEdge);
    await this.app.init({ preference: 'webgl', width: size.width, height: size.height, resolution: 1, antialias: false, backgroundAlpha: 1, autoStart: false, powerPreference: 'high-performance' });
    if (this.destroyed) { this.app.destroy(true); throw new Error('Camera startup was cancelled.'); }
    this.app.stop();
    this.source = new VideoSource({ resource: video, autoPlay: false, autoLoad: false });
    this.source.autoUpdate = false;
    // Await loading so cancellation cannot leave an unobserved preload promise.
    await this.source.load();
    if (this.destroyed) throw new Error('Camera startup was cancelled.');
    this.videoTexture = new Texture({ source: this.source });
    this.sourceSprite = new Sprite(this.videoTexture);
    this.sourceStage.addChild(this.sourceSprite);
    this.raw = RenderTexture.create({ ...size, resolution: 1 });
    this.filtered = RenderTexture.create({ ...size, resolution: 1 });
    this.combined = RenderTexture.create({ ...size, resolution: 1 });
    this.mixFilter = new Filter({ glProgram: GlProgram.from({ vertex, fragment }), resources: {
      uRawTexture: this.raw.source,
      portalUniforms: {
        uTop: { value: new Float32Array(4), type: 'vec4<f32>' },
        uBottom: { value: new Float32Array(4), type: 'vec4<f32>' },
        uSize: { value: new Float32Array([size.width, size.height]), type: 'vec2<f32>' },
        uVisibility: { value: 0, type: 'f32' },
        uStrength: { value: 1, type: 'f32' },
      },
    } });
    this.mixSprite = new Sprite(this.filtered);
    this.mixStage.addChild(this.mixSprite);
    this.mixSprite.filters = [this.mixFilter];
    this.display = new Sprite(this.combined);
    this.app.stage.addChild(this.display);
    this.mirror = mirror;
    this.resize(longEdge, video.videoWidth, video.videoHeight);
    this.setEffect(this.effectId);
    this.app.canvas.setAttribute('aria-label', 'Live camera with fingertip-controlled effect');
    this.app.canvas.setAttribute('data-testid', 'camera-canvas');
    host.replaceChildren(this.app.canvas);
    // Compile the selected effect and compositor before the first gesture arrives.
    this.render({ corners: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], visibility: 1, phase: 'candidate' }, 0, 0, true);
  }

  setEffect(id: string): void {
    this.effectId = id;
    if (!this.sourceSprite) return;
    this.sourceSprite.filters = [];
    this.effect?.destroy();
    this.effect = getEffect(id).create();
  }

  resize(longEdge: number, sourceWidth: number, sourceHeight: number): void {
    const size = fitSize(sourceWidth, sourceHeight, longEdge);
    if (this.width === size.width && this.height === size.height) return;
    this.width = size.width; this.height = size.height;
    this.app.renderer.resize(size.width, size.height);
    for (const texture of [this.raw, this.filtered, this.combined]) texture.resize(size.width, size.height);
    this.sourceSprite.width = size.width; this.sourceSprite.height = size.height;
    this.sourceSprite.filterArea = new Rectangle(0, 0, size.width, size.height);
    this.mixSprite.width = size.width; this.mixSprite.height = size.height;
    this.mixSprite.filterArea = new Rectangle(0, 0, size.width, size.height);
    this.display.width = size.width; this.display.height = size.height;
    this.display.scale.x = Math.abs(this.display.scale.x) * (this.mirror ? -1 : 1);
    this.display.x = this.mirror ? size.width : 0;
    this.mixFilter.resources.portalUniforms.uniforms.uSize = new Float32Array([size.width, size.height]);
  }

  render(portal: PortalState, strength: number, seconds: number, newFrame: boolean): void {
    if (this.destroyed) return;
    if (newFrame) this.source.update();
    const uniforms = this.mixFilter.resources.portalUniforms.uniforms;
    const corners = portal.corners;
    uniforms.uVisibility = corners ? portal.visibility : 0;
    uniforms.uStrength = strength;
    if (corners) {
      uniforms.uTop = new Float32Array([corners[0].x, corners[0].y, corners[1].x, corners[1].y]);
      uniforms.uBottom = new Float32Array([corners[2].x, corners[2].y, corners[3].x, corners[3].y]);
    }
    this.sourceSprite.filters = [];
    this.app.renderer.render({ container: this.sourceStage, target: this.raw, clear: true });
    if (portal.visibility > 0 && this.effect) {
      this.effect.update(seconds);
      this.sourceSprite.filters = this.effect.filters;
      this.app.renderer.render({ container: this.sourceStage, target: this.filtered, clear: true });
      this.app.renderer.render({ container: this.mixStage, target: this.combined, clear: true });
      this.display.texture = this.combined;
    } else this.display.texture = this.raw;
    this.app.renderer.render({ container: this.app.stage, clear: true });
  }

  async photo(): Promise<Blob> {
    const canvas = this.app.renderer.extract.canvas({ target: this.app.stage }) as HTMLCanvasElement;
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not save this photo.')), 'image/png'));
  }
  get canvas(): HTMLCanvasElement | null { return this.app.renderer ? this.app.canvas : null; }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.sourceSprite) this.sourceSprite.filters = [];
    if (this.mixSprite) this.mixSprite.filters = [];
    this.effect?.destroy(); this.mixFilter?.destroy();
    this.sourceSprite?.destroy(); this.mixSprite?.destroy(); this.display?.destroy();
    this.sourceStage.destroy(); this.mixStage.destroy();
    this.raw?.destroy(true); this.filtered?.destroy(true); this.combined?.destroy(true);
    if (this.videoTexture) this.videoTexture.destroy(true);
    else this.source?.destroy();
    if (this.app.renderer) this.app.destroy(true);
  }
}
