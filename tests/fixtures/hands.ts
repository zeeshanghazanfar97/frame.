import type { Landmark } from '../../src/media/types';

/** Synthetic L poses for deterministic geometry tests, not a replacement for device validation. */
export function frameHand(side: 'left' | 'right', offsetY = 0): Landmark[] {
  const x = side === 'left' ? 0.18 : 0.82;
  const direction = side === 'left' ? 1 : -1;
  const point = (dx: number, y: number): Landmark => ({ x: x + direction * dx, y: y + offsetY, z: 0 });
  return [
    point(0, .82),
    point(.02, .71), point(.04, .65), point(.08, .61), point(.14, .55),
    point(0, .58), point(0, .46), point(0, .32), point(0, .2),
    point(-.025, .61), point(-.035, .52), point(-.04, .63), point(-.035, .69),
    point(-.055, .64), point(-.065, .55), point(-.07, .66), point(-.065, .72),
    point(-.085, .67), point(-.095, .59), point(-.10, .69), point(-.09, .75),
  ];
}
export const frameHands = () => [frameHand('left'), frameHand('right', .035)];
