import { distance, fingertipPoints, hasFingertips, orderCorners, validWindow } from './geometry';
import type { Corners, Landmark, PortalState } from './types';

export class OneEuroFilter {
  private value: number | null = null;
  private derivative = 0;
  private rawValue = 0;
  private timestamp: number | null = null;
  constructor(private minCutoff = 1.7, private beta = 0.08, private derivativeCutoff = 1) {}
  filter(value: number, timestamp: number): number {
    if (this.timestamp === null || this.value === null) {
      this.timestamp = timestamp; this.value = value; this.rawValue = value; return value;
    }
    const dt = Math.max(0.001, (timestamp - this.timestamp) / 1000);
    const alpha = (cutoff: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
    const d = (value - this.rawValue) / dt;
    this.rawValue = value;
    this.derivative += alpha(this.derivativeCutoff) * (d - this.derivative);
    this.value += alpha(this.minCutoff + this.beta * Math.abs(this.derivative)) * (value - this.value);
    this.timestamp = timestamp;
    return this.value;
  }
}

export class GestureTracker {
  private previous: [Landmark[], Landmark[]] | null = null;
  private filters = this.newFilters();
  private corners: Corners | null = null;
  private candidateSince: number | null = null;
  private lastValid: number | null = null;
  private activated = false;
  private newFilters() { return Array.from({ length: 8 }, () => new OneEuroFilter()); }

  update(hands: Landmark[][], timestamp: number, aspect = 1): void {
    if (this.lastValid !== null && timestamp - this.lastValid > 220) this.reset();
    let pair: [Landmark[], Landmark[]] | null = null;
    const anchor = (hand: Landmark[]) => {
      const wrist = hand[0];
      const point = wrist && Number.isFinite(wrist.x) && Number.isFinite(wrist.y) ? wrist : { x: (hand[4].x + hand[8].x) / 2, y: (hand[4].y + hand[8].y) / 2 };
      return { x: point.x * aspect, y: point.y };
    };
    const matchCost = (a: Landmark[], b: Landmark[]) => distance(anchor(a), anchor(b)) +
      [4, 8].reduce((sum, index) => sum + distance({x:a[index].x*aspect,y:a[index].y},{x:b[index].x*aspect,y:b[index].y}),0);
    if (hands.length === 2 && hands.every(hasFingertips)) {
      if (this.previous) {
        const direct = matchCost(hands[0],this.previous[0]) + matchCost(hands[1],this.previous[1]);
        const reverse = matchCost(hands[1],this.previous[0]) + matchCost(hands[0],this.previous[1]);
        pair = reverse < direct ? [hands[1], hands[0]] : [hands[0], hands[1]];
      } else {
        pair = [hands[0], hands[1]];
      }
    }
    const candidate = pair ? fingertipPoints(pair[0], pair[1]) : null;
    if (candidate && pair && validWindow(candidate)) {
      this.previous = pair;
      this.candidateSince ??= timestamp;
      this.lastValid = timestamp;
      this.activated ||= timestamp - this.candidateSince >= 150;
      const smoothed = candidate.map((p, i) => ({
        x: this.filters[i * 2].filter(p.x, timestamp),
        y: this.filters[i * 2 + 1].filter(p.y, timestamp),
      })) as Corners;
      // Sorting smoothed tips avoids blending an index tip into a different finger
      // when hands rotate, cross, or exchange their order in the detector result.
      this.corners = orderCorners(smoothed);
    } else if (!this.activated) {
      this.candidateSince = null;
      this.previous = null;
      this.filters = this.newFilters();
    }
  }

  state(timestamp: number): PortalState {
    if (this.lastValid === null || this.corners === null) return { corners: null, visibility: 0, phase: 'searching' };
    const lostFor = timestamp - this.lastValid;
    if (lostFor >= 220) { this.reset(); return { corners: null, visibility: 0, phase: 'searching' }; }
    if (!this.activated) return { corners: this.corners, visibility: 0, phase: 'candidate' };
    if (lostFor <= 120) return { corners: this.corners, visibility: 1, phase: 'active' };
    return { corners: this.corners, visibility: 1 - (lostFor - 120) / 100, phase: 'lost' };
  }

  reset(): void {
    this.previous = null; this.corners = null; this.candidateSince = null;
    this.lastValid = null; this.activated = false; this.filters = this.newFilters();
  }
}
