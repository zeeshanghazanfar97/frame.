import type { Corners, Landmark, Point } from './types';

export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

export function polygonArea(points: Corners): number {
  return Math.abs(points.reduce((sum, p, i) => {
    const q = points[(i + 1) % 4];
    return sum + p.x * q.y - q.x * p.y;
  }, 0)) / 2;
}

export function validWindow(points: Corners): boolean {
  // A degenerate polygon is still tracked; its interior simply contains no pixels.
  return points.length === 4 && points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y));
}

export function hasFingertips(hand: Landmark[]): boolean {
  return [hand[4], hand[8]].every(p => !!p && Number.isFinite(p.x) && Number.isFinite(p.y));
}

/** Raw slots retain finger identity so smoothing happens before perimeter sorting. */
export function fingertipPoints(first: Landmark[], second: Landmark[]): Corners {
  return [first[8], first[4], second[8], second[4]].map(p => ({ x: p.x, y: p.y })) as Corners;
}

/** Angular ordering keeps all four tips on a simple perimeter, including concave shapes. */
export function orderCorners(points: Corners): Corners {
  const center = points.reduce((sum, p) => ({ x: sum.x + p.x / 4, y: sum.y + p.y / 4 }), { x: 0, y: 0 });
  return [...points].sort((a, b) => {
    const angle = Math.atan2(a.y - center.y, a.x - center.x) - Math.atan2(b.y - center.y, b.x - center.x);
    return angle || distance(a, center) - distance(b, center) || a.x - b.x || a.y - b.y;
  }) as Corners;
}

export function orderWindow(first: Landmark[], second: Landmark[]): Corners {
  return orderCorners(fingertipPoints(first, second));
}

/** Apply mirroring once to both imagery and polygon in the compositor. */
export const mirrorPoint = (p: Point): Point => ({ x: 1 - p.x, y: p.y });

export function fitSize(width: number, height: number, longEdge: number): { width: number; height: number } {
  const ratio = Math.min(1, longEdge / Math.max(width, height));
  return { width: Math.max(2, Math.round(width * ratio / 2) * 2), height: Math.max(2, Math.round(height * ratio / 2) * 2) };
}
