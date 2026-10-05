import { ColorMatrixFilter, Filter, GlProgram } from 'pixi.js';
import * as collection from 'pixi-filters';
import catalog from './filter-catalog.json';
export type EffectCategory = 'Color' | 'Texture' | 'Play' | 'Style';
export interface EffectInstance { filters: Filter[]; update(seconds: number): void; destroy(): void }
export interface EffectDefinition {
  id: string; label: string; category: EffectCategory; description: string; thumbnail: string;
  animated: boolean; canvas: string | null; source: string; create(): EffectInstance;
  model?: {url:string;input:string;output:string;size:number;colorOrder:'rgb'|'bgr'};
}
export interface EffectSpec {
  id: string; label: string; category: string; description: string; thumbnail: string;
  provider: string; method?: string; matrix?: number[]; filter?: string;
  options?: Record<string, unknown>; animated?: boolean; canvas?: string;
  model?: {url:string;input:string;output:string;size:number;colorOrder:'rgb'|'bgr'};
}

const filterVertex=`precision highp float;
in vec2 aPosition; out vec2 vTextureCoord;
uniform vec4 uInputSize; uniform vec4 uOutputFrame; uniform vec4 uOutputTexture;
void main(){vec2 p=aPosition*uOutputFrame.zw+uOutputFrame.xy;
p.x=p.x*(2.0/uOutputTexture.x)-1.0; p.y=p.y*(2.0*uOutputTexture.z/uOutputTexture.y)-uOutputTexture.z;
gl_Position=vec4(p,0.,1.);vTextureCoord=aPosition*(uOutputFrame.zw*uInputSize.zw);}`;
const toonFragment=`precision highp float;
in vec2 vTextureCoord;out vec4 finalColor;uniform sampler2D uTexture;
uniform vec4 uInputSize;uniform float uAnime;
float luma(vec3 c){return dot(c,vec3(.299,.587,.114));}
void main(){vec2 d=uInputSize.zw;vec2 uv=vTextureCoord;
vec3 c=texture(uTexture,uv).rgb;
vec3 left=texture(uTexture,uv-vec2(d.x,0.)).rgb,right=texture(uTexture,uv+vec2(d.x,0.)).rgb;
vec3 up=texture(uTexture,uv-vec2(0.,d.y)).rgb,down=texture(uTexture,uv+vec2(0.,d.y)).rgb;
vec3 smoothColor=(c*4.+left+right+up+down)/8.;
float gradient=length(vec2(luma(right)-luma(left),luma(down)-luma(up)));
float levels=mix(6.,9.,uAnime);vec3 quantized=floor(smoothColor*levels+.5)/levels;
float gray=luma(quantized);quantized=mix(vec3(gray),quantized,mix(1.08,1.25,uAnime));
quantized+=uAnime*vec3(.02,.01,.035);
float ink=smoothstep(.055,.18,gradient);finalColor=vec4(mix(quantized,vec3(.035,.04,.065),ink*.85),1.);}`;

function create(spec: EffectSpec): EffectInstance {
  if(spec.provider==='model')return {filters:[],update:()=>{},destroy:()=>{}};
  let filter: Filter;
  if(spec.provider==='matrix') {
    const matrix=new ColorMatrixFilter();
    if(spec.matrix){if(spec.matrix.length!==20)throw new Error('Color matrices need 20 entries.');matrix.matrix=spec.matrix as typeof matrix.matrix;}
    else {
      const methods: Record<string,()=>void>={desaturate:()=>matrix.desaturate(),sepia:()=>matrix.sepia(false),negative:()=>matrix.negative(false),vintage:()=>matrix.vintage(false),polaroid:()=>matrix.polaroid(false),technicolor:()=>matrix.technicolor(false)};
      if(!methods[spec.method!]) throw new Error(`Unknown color preset: ${spec.method}`);
      methods[spec.method!]();
    }
    filter=matrix;
  } else if(spec.provider==='toon') {
    filter=new Filter({glProgram:GlProgram.from({vertex:filterVertex,fragment:toonFragment}),resources:{styleUniforms:{uAnime:{value:spec.id==='anime-palette'?1:0,type:'f32'}}}});
  } else {
    const Constructor=(collection as unknown as Record<string,new(options?: unknown)=>Filter>)[spec.filter!];
    if(!Constructor) throw new Error(`Unknown library filter: ${spec.filter}`);
    filter=new Constructor(spec.filter==='PixelateFilter' ? spec.options?.size ?? 12 : spec.options ?? {});
  }
  return {filters:[filter],update:time=>{
    const animated=filter as Filter & {time?:number;seed?:number};
    if('time' in animated) animated.time=time;
    if('seed' in animated) animated.seed=(Math.floor(time*12)%100)/100;
  },destroy:()=>filter.destroy()};
}

export function buildEffects(specs: EffectSpec[]): EffectDefinition[] {
  const ids=new Set<string>();
  return specs.map(spec=>{
    if(ids.has(spec.id)) throw new Error(`Duplicate filter ID: ${spec.id}`); ids.add(spec.id);
    return {...spec,category:spec.category as EffectCategory,animated:!!spec.animated,canvas:spec.canvas??null,
      source:spec.provider==='model'?'https://modelscope.cn/models/damo/cv_unet_person-image-cartoon_compound-models/summary':spec.provider==='pixi'?'https://github.com/pixijs/filters':spec.provider==='matrix'?'https://pixijs.com/8.x/guides/components/filters':'local:cel-shading',create:()=>create(spec)};
  });
}
export const effects=buildEffects(catalog as EffectSpec[]);
export function getEffect(id:string):EffectDefinition{return effects.find(effect=>effect.id===id)??effects.find(effect=>effect.id==='pixelate')!;}
export const availableEffects=(backend: 'webgl'|'canvas'|null)=>backend==='canvas'?effects.filter(effect=>effect.canvas):effects;
