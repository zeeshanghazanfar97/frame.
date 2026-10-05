import { distance, isFrameHand, orderWindow, validWindow } from './geometry';
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
    let pair: [Landmark[], Landmark[]] | null = null;
    if (hands.length === 2 && hands.every(h => isFrameHand(h, aspect))) {
      if (this.previous) {
        const direct = distance(hands[0][0], this.previous[0][0]) + distance(hands[1][0], this.previous[1][0]);
        const reverse = distance(hands[1][0], this.previous[0][0]) + distance(hands[0][0], this.previous[1][0]);
        pair = reverse < direct ? [hands[1], hands[0]] : [hands[0], hands[1]];
      } else {
        pair = hands[0][0].x < hands[1][0].x ? [hands[0], hands[1]] : [hands[1], hands[0]];
      }
    }
    const candidate = pair ? orderWindow(pair[0], pair[1]) : null;
    // Crossing hands must not silently reorder a portal that was already acquired.
    if (candidate && pair && pair[0][0].x < pair[1][0].x && validWindow(candidate)) {
      if (this.lastValid !== null && timestamp - this.lastValid > 220) this.reset();
      this.previous = pair;
      this.candidateSince ??= timestamp;
      this.lastValid = timestamp;
      this.activated ||= timestamp - this.candidateSince >= 150;
      const smoothed = candidate.map((p, i) => ({
        x: this.filters[i * 2].filter(p.x, timestamp),
        y: this.filters[i * 2 + 1].filter(p.y, timestamp),
      })) as Corners;
      this.corners = validWindow(smoothed) ? smoothed : candidate;
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
