import {describe,expect,it} from 'vitest';
import {availableEffects,buildEffects,effects,getEffect} from '../../src/media/effects';
describe('extensible effect catalog',()=>{
  it('contains unique presets and keeps the original default',()=>{expect(effects.length).toBeGreaterThanOrEqual(24);expect(new Set(effects.map(effect=>effect.id)).size).toBe(effects.length);expect(getEffect('missing').id).toBe('pixelate');});
  it('can add a library effect through data without a custom implementation',()=>{
    const [effect]=buildEffects([{id:'test-dot',label:'Dots',category:'Texture',description:'Dot print',thumbnail:'crosshatch',provider:'pixi',filter:'DotFilter',options:{scale:2}}]);
    expect(effect.source).toContain('pixijs/filters');expect(typeof effect.create).toBe('function');expect(effect.id).toBe('test-dot');
  });
  it('rejects duplicate ids and reports Canvas capabilities explicitly',()=>{const base={id:'duplicate',label:'Test',category:'Color',description:'Test',thumbnail:'warm',provider:'matrix',method:'sepia'};expect(()=>buildEffects([base,base])).toThrow('Duplicate');expect(availableEffects('canvas').every(effect=>effect.canvas)).toBe(true);expect(getEffect('ascii').canvas).toBeNull();});
});
