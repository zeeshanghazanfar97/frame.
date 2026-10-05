import type { Corners, Landmark, Point } from './types';

export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const cross = (a: Point, b: Point, c: Point) =>
  (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);

export function polygonArea(points: Corners): number {
  return Math.abs(points.reduce((sum, p, i) => {
    const q = points[(i + 1) % 4];
    return sum + p.x * q.y - q.x * p.y;
  }, 0)) / 2;
}

export function validWindow(points: Corners): boolean {
  if (points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) return false;
  const turns = points.map((p, i) => cross(p, points[(i + 1) % 4], points[(i + 2) % 4]));
  if (!turns.every(t => t > 0.0001) && !turns.every(t => t < -0.0001)) return false;
  return polygonArea(points) > 0.015 && points.every((p, i) => distance(p, points[(i + 1) % 4]) > 0.06);
}

function jointAngle(a: Point, b: Point, c: Point): number {
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };
  const denominator = Math.hypot(ab.x, ab.y) * Math.hypot(cb.x, cb.y);
  if (denominator < 1e-8) return 0;
  return Math.acos(Math.max(-1, Math.min(1, (ab.x * cb.x + ab.y * cb.y) / denominator))) * 180 / Math.PI;
}

/** All pose distances use aspect-corrected coordinates, never mirrored screen handedness. */
export function isFrameHand(raw: Landmark[], aspect = 1): boolean {
  if (raw.length !== 21 || raw.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return false;
  const h = raw.map(p => ({ x: p.x * aspect, y: p.y }));
  const scale = distance(h[0], h[9]);
  if (scale < 0.025) return false;
  const indexExtended = jointAngle(h[5], h[6], h[8]) > 145 && distance(h[8], h[0]) > distance(h[6], h[0]) * 1.1;
  const thumbExtended = jointAngle(h[2], h[3], h[4]) > 135 && distance(h[4], h[5]) > scale * 0.6;
  const spread = jointAngle(h[4], h[5], h[8]);
  const curledCount = [9, 13, 17].filter(base =>
    jointAngle(h[base], h[base + 1], h[base + 3]) < 145 ||
    distance(h[base + 3], h[0]) < distance(h[base + 1], h[0]) * 1.05,
  ).length;
  return indexExtended && thumbExtended && spread > 35 && spread < 145 && curledCount >= 2;
}

export function orderWindow(left: Landmark[], right: Landmark[]): Corners {
  return [left[8], right[8], right[4], left[4]].map(p => ({ x: p.x, y: p.y })) as Corners;
}

/** Apply mirroring once to both imagery and polygon in the compositor. */
export const mirrorPoint = (p: Point): Point => ({ x: 1 - p.x, y: p.y });

export function fitSize(width: number, height: number, longEdge: number): { width: number; height: number } {
  const ratio = Math.min(1, longEdge / Math.max(width, height));
  return { width: Math.max(2, Math.round(width * ratio / 2) * 2), height: Math.max(2, Math.round(height * ratio / 2) * 2) };
}
