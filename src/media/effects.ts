import { ColorMatrixFilter, type Filter } from 'pixi.js';
import { AdvancedBloomFilter } from 'pixi-filters/advanced-bloom';
import { AsciiFilter } from 'pixi-filters/ascii';
import { CrossHatchFilter } from 'pixi-filters/cross-hatch';
import { CRTFilter } from 'pixi-filters/crt';
import { OldFilmFilter } from 'pixi-filters/old-film';
import { PixelateFilter } from 'pixi-filters/pixelate';
import { RGBSplitFilter } from 'pixi-filters/rgb-split';

export type EffectCategory = 'Color' | 'Texture' | 'Play';
export interface EffectInstance {
  filters: Filter[];
  update(seconds: number): void;
  destroy(): void;
}
export interface EffectDefinition {
  id: string;
  label: string;
  category: EffectCategory;
  description: string;
  thumbnail: string;
  create(): EffectInstance;
}

function instance(filter: Filter, animate?: (seconds: number) => void): EffectInstance {
  return { filters: [filter], update: animate ?? (() => {}), destroy: () => filter.destroy() };
}
function color(apply: (filter: ColorMatrixFilter) => void) {
  return () => { const filter = new ColorMatrixFilter(); apply(filter); return instance(filter); };
}

export const effects: EffectDefinition[] = [
  { id: 'grayscale', label: 'Mono', category: 'Color', description: 'Clean black and white', thumbnail: 'grayscale', create: color(f => f.desaturate()) },
  { id: 'sepia', label: 'Sepia', category: 'Color', description: 'Warm, sun-aged tones', thumbnail: 'sepia', create: color(f => f.sepia(false)) },
  { id: 'negative', label: 'Negative', category: 'Color', description: 'Turn every color inside out', thumbnail: 'negative', create: color(f => f.negative(false)) },
  { id: 'warm', label: 'Golden', category: 'Color', description: 'A touch of golden hour', thumbnail: 'warm', create: color(f => { f.matrix = [1.12, 0, 0, 0, 0.035, 0, 1.02, 0, 0, 0.012, 0, 0, 0.85, 0, 0, 0, 0, 0, 1, 0]; }) },
  { id: 'cool', label: 'Ice', category: 'Color', description: 'Cool blues and soft shadows', thumbnail: 'cool', create: color(f => { f.matrix = [0.85, 0, 0, 0, 0, 0, 1.03, 0, 0, 0.01, 0, 0, 1.16, 0, 0.025, 0, 0, 0, 1, 0]; }) },
  { id: 'pixelate', label: 'Pixel', category: 'Texture', description: 'Little pixels. Big personality.', thumbnail: 'pixelate', create: () => instance(new PixelateFilter(12)) },
  { id: 'ascii', label: 'ASCII', category: 'Texture', description: 'Your world, written in characters', thumbnail: 'ascii', create: () => instance(new AsciiFilter({ size: 8 })) },
  { id: 'crosshatch', label: 'Sketch', category: 'Texture', description: 'A pen-and-ink crosshatch', thumbnail: 'crosshatch', create: () => instance(new CrossHatchFilter()) },
  { id: 'oldfilm', label: 'Old film', category: 'Texture', description: 'Grain, scratches, and nostalgia', thumbnail: 'oldfilm', create: () => {
    const filter = new OldFilmFilter({ sepia: 0.35, noise: 0.18, scratch: 0.4, vignetting: 0.2 });
    return instance(filter, time => { filter.seed = (Math.floor(time * 12) % 100) / 100; });
  } },
  { id: 'crt', label: 'Retro TV', category: 'Play', description: 'Straight out of an old television', thumbnail: 'crt', create: () => {
    const filter = new CRTFilter({ curvature: 0, lineWidth: 2, lineContrast: 0.2, noise: 0.08, vignetting: 0.15 });
    return instance(filter, time => { filter.time = time; filter.seed = (Math.floor(time * 15) % 100) / 100; });
  } },
  { id: 'rgbsplit', label: 'Prism', category: 'Play', description: 'Split the spectrum', thumbnail: 'rgbsplit', create: () => instance(new RGBSplitFilter({ red: { x: -5, y: 0 }, green: { x: 0, y: 0 }, blue: { x: 5, y: 0 } })) },
  { id: 'bloom', label: 'Bloom', category: 'Play', description: 'Let the bright parts glow', thumbnail: 'bloom', create: () => instance(new AdvancedBloomFilter({ threshold: 0.45, bloomScale: 0.8, brightness: 1.05, blur: 4, quality: 3 })) },
];

export function getEffect(id: string): EffectDefinition {
  return effects.find(effect => effect.id === id) ?? effects[5];
}
