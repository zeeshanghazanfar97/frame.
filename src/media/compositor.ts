import { Application, Container, GlProgram, Mesh, MeshGeometry, Rectangle, RendererType, RenderTexture, Shader, Sprite, Texture, VideoSource } from 'pixi.js';
import { getEffect, type EffectInstance } from './effects';
import { fitSize } from './geometry';
import type { ApplyMode, PortalState } from './types';
import type { VideoRenderer } from './rendering';

const vertex = `
precision highp float;
in vec2 aPosition;
in vec2 aUV;
out vec2 vUV;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
void main() {
  vec3 position = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix * vec3(aPosition, 1.0);
  gl_Position = vec4(position.xy, 0.0, 1.0);
  vUV = aUV;
}`;
const fragment = `
precision highp float;
in vec2 vUV;
out vec4 finalColor;
uniform sampler2D uRawTexture;
uniform sampler2D uFilteredTexture;
uniform vec4 uTop;
uniform vec4 uBottom;
uniform vec2 uSize;
uniform float uVisibility;
uniform float uStrength;
uniform float uMirror;
uniform float uFull;
float segmentDistance(vec2 a, vec2 b, vec2 p) {
  vec2 direction=(b-a)*uSize, offset=(p-a)*uSize;
  float lengthSquared=dot(direction,direction);
  float projection=lengthSquared>0.0 ? clamp(dot(offset,direction)/lengthSquared,0.0,1.0) : 0.0;
  return length(offset-projection*direction);
}
bool rayCrosses(vec2 a, vec2 b, vec2 p) {
  if((a.y>p.y)!=(b.y>p.y)) {
    return p.x < a.x+(p.y-a.y)*(b.x-a.x)/(b.y-a.y);
  }
  return false;
}
void main() {
  vec2 uv = vec2(mix(vUV.x, 1.0-vUV.x, uMirror), vUV.y);
  vec4 raw = texture(uRawTexture, uv);
  float mask = uFull;
  if(uFull < 0.5 && uVisibility > 0.0) {
    vec2 a=uTop.xy,b=uTop.zw,c=uBottom.xy,d=uBottom.zw;
    bool inside=rayCrosses(a,b,uv)!=rayCrosses(b,c,uv);
    inside=inside!=rayCrosses(c,d,uv);
    inside=inside!=rayCrosses(d,a,uv);
    float nearest=min(min(segmentDistance(a,b,uv),segmentDistance(b,c,uv)),min(segmentDistance(c,d,uv),segmentDistance(d,a,uv)));
    float shortest=min(min(length((b-a)*uSize),length((c-b)*uSize)),min(length((d-c)*uSize),length((a-d)*uSize)));
    float feather=min(0.75,shortest*0.2);
    mask=inside ? (feather>0.0 ? smoothstep(0.0,feather,nearest) : 1.0)*uVisibility : 0.0;
  }
  float amount=mask*uStrength;
  finalColor=amount>0.0 ? mix(raw,texture(uFilteredTexture,uv),amount) : raw;
}`;

/** One selected-effect target plus a direct mesh blend. No raw or combined copies. */
export class Compositor implements VideoRenderer {
  readonly backend = 'webgl' as const;
  readonly app = new Application();
  private filtered!: RenderTexture;
  private source!: VideoSource;
  private videoTexture!: Texture;
  private sourceSprite!: Sprite;
  private sourceStage = new Container();
  private mesh!: Mesh<MeshGeometry, Shader>;
  private shader!: Shader;
  private geometry!: MeshGeometry;
  private effect: EffectInstance | null = null;
  private effectId = 'pixelate';
  private width = 0;
  private height = 0;
  private destroyed = false;
  private filterDirty = true;
  private top = new Float32Array(4);
  private bottom = new Float32Array(4);
  private neuralRaw=document.createElement('canvas');
  private neuralStyled=document.createElement('canvas');
  private neuralRawTexture:Texture|null=null;
  private neuralStyledTexture:Texture|null=null;
  private neuralReady=false;

  async init(video: HTMLVideoElement, host: HTMLElement, longEdge: number, mirror: boolean): Promise<void> {
    const size = fitSize(video.videoWidth, video.videoHeight, longEdge);
    await this.app.init({ preference: 'webgl', width: size.width, height: size.height, resolution: 1, antialias: false, backgroundAlpha: 1, autoStart: false, powerPreference: 'high-performance' });
    if(this.app.renderer.type!==RendererType.WEBGL){this.destroy();throw new Error('WebGL is unavailable.');}
    if (this.destroyed) { this.app.destroy(true); throw new Error('Camera startup was cancelled.'); }
    this.app.stop();
    this.source = new VideoSource({ resource: video, autoPlay: false, autoLoad: false });
    this.source.autoUpdate = false;
    await this.source.load();
    if (this.destroyed) throw new Error('Camera startup was cancelled.');
    this.videoTexture = new Texture({ source: this.source });
    this.sourceSprite = new Sprite(this.videoTexture);
    this.sourceStage.addChild(this.sourceSprite);
    this.filtered = RenderTexture.create({ ...size, resolution: 1 });
    this.shader = new Shader({ glProgram: GlProgram.from({ vertex, fragment }), resources: {
      uRawTexture: this.source,
      uFilteredTexture: this.filtered.source,
      portalUniforms: {
        uTop: { value: this.top, type: 'vec4<f32>' }, uBottom: { value: this.bottom, type: 'vec4<f32>' },
        uSize: { value: new Float32Array([size.width,size.height]), type: 'vec2<f32>' },
        uVisibility: { value: 0, type: 'f32' }, uStrength: { value: 1, type: 'f32' },
        uMirror: { value: mirror ? 1 : 0, type: 'f32' }, uFull: { value: 0, type: 'f32' },
      },
    } });
    this.geometry = new MeshGeometry({});
    this.mesh = new Mesh({ geometry: this.geometry, shader: this.shader });
    this.app.stage.addChild(this.mesh);
    this.resize(longEdge, video.videoWidth, video.videoHeight);
    this.setEffect(this.effectId);
    this.app.canvas.setAttribute('aria-label','Live camera with selected effect');
    this.app.canvas.setAttribute('data-testid','camera-canvas');
    host.replaceChildren(this.app.canvas);
    this.render({ corners: null, visibility: 0, phase: 'searching' }, 0, 0, true);
  }

  setEffect(id: string): void {
    this.clearNeuralFrame();
    this.effectId = id;
    if (!this.sourceSprite) return;
    this.sourceSprite.filters = [];
    this.effect?.destroy(); this.effect = getEffect(id).create(); this.filterDirty = true;
  }
  setNeuralFrame(original:ImageBitmap,styled:ImageBitmap):void{
    for(const [canvas,image] of [[this.neuralRaw,original],[this.neuralStyled,styled]] as const){canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d')!.drawImage(image,0,0);}
    this.neuralRawTexture??=Texture.from(this.neuralRaw);this.neuralStyledTexture??=Texture.from(this.neuralStyled);
    this.neuralRawTexture.source.resize(original.width,original.height);this.neuralStyledTexture.source.resize(styled.width,styled.height);
    this.neuralRawTexture.source.update();this.neuralStyledTexture.source.update();this.neuralReady=true;
  }
  clearNeuralFrame():void{this.neuralReady=false;}

  resize(longEdge: number, sourceWidth: number, sourceHeight: number): void {
    const size = fitSize(sourceWidth,sourceHeight,longEdge);
    if (this.width===size.width && this.height===size.height) return;
    this.width=size.width; this.height=size.height;
    this.app.renderer.resize(size.width,size.height); this.filtered.resize(size.width,size.height);
    this.sourceSprite.width=size.width; this.sourceSprite.height=size.height;
    this.sourceSprite.filterArea=new Rectangle(0,0,size.width,size.height);
    this.geometry.positions=new Float32Array([0,0,size.width,0,size.width,size.height,0,size.height]);
    this.geometry.uvs=new Float32Array([0,0,1,0,1,1,0,1]);
    this.shader.resources.portalUniforms.uniforms.uSize=new Float32Array([size.width,size.height]);
    this.filterDirty=true;
  }

  render(portal: PortalState, strength: number, seconds: number, newFrame: boolean, mode: ApplyMode='window'): void {
    if (this.destroyed) return;
    if (newFrame) this.source.update();
    const uniforms=this.shader.resources.portalUniforms.uniforms;
    uniforms.uVisibility=portal.corners ? portal.visibility : 0;
    uniforms.uStrength=strength; uniforms.uFull=mode==='full' ? 1 : 0;
    if (portal.corners) {
      const c=portal.corners; this.top.set([c[0].x,c[0].y,c[1].x,c[1].y]); this.bottom.set([c[2].x,c[2].y,c[3].x,c[3].y]);
    }
    const visible=strength>0 && (mode==='full' || portal.visibility>0);
    const neural=!!getEffect(this.effectId).model;
    if(neural&&!visible)this.neuralReady=false;
    this.shader.resources.uRawTexture=neural&&visible&&this.neuralReady?this.neuralRawTexture!.source:this.source;
    this.shader.resources.uFilteredTexture=neural&&this.neuralReady?this.neuralStyledTexture!.source:this.filtered.source;
    if(neural&&!this.neuralReady)uniforms.uStrength=0;
    if (visible && !neural && this.effect && (newFrame || this.filterDirty || getEffect(this.effectId).animated)) {
      this.effect.update(seconds); this.sourceSprite.filters=this.effect.filters;
      this.app.renderer.render({ container:this.sourceStage,target:this.filtered,clear:true });
      this.filterDirty=false;
    }
    this.app.renderer.render({ container:this.app.stage,clear:true });
  }

  async photo(): Promise<Blob> {
    const canvas=this.app.renderer.extract.canvas({ target:this.app.stage }) as HTMLCanvasElement;
    return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob ? resolve(blob) : reject(new Error('Could not save this photo.')),'image/png'));
  }
  get canvas(): HTMLCanvasElement | null { return this.app.renderer ? this.app.canvas : null; }
  destroy(): void {
    if (this.destroyed) return; this.destroyed=true;
    if(this.sourceSprite) this.sourceSprite.filters=[];
    this.effect?.destroy(); this.shader?.destroy(); this.mesh?.destroy(); this.geometry?.destroy();
    this.sourceSprite?.destroy(); this.sourceStage.destroy();
    if(this.app.renderer) this.app.destroy(true);
    this.filtered?.destroy(true);
    this.neuralRawTexture?.destroy(true);this.neuralStyledTexture?.destroy(true);
    if(this.videoTexture) this.videoTexture.destroy(true); else this.source?.destroy();
  }
}
