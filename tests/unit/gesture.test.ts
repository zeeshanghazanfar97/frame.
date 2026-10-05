import { describe, expect, it } from 'vitest';
import { frameHand, frameHands } from '../fixtures/hands';
import { fitSize, isFrameHand, mirrorPoint, orderWindow, validWindow } from '../../src/media/geometry';
import { GestureTracker, OneEuroFilter } from '../../src/media/gesture';

describe('frame geometry', () => {
  it('accepts tilted L poses and rejects a folded index and open other fingers', () => {
    const hand = frameHand('left');
    expect(isFrameHand(hand, 16 / 9)).toBe(true);
    const portrait = frameHand('right').map(p => ({ ...p, x: .82 + (p.x - .82) / (9 / 16) }));
    expect(isFrameHand(portrait, 9 / 16)).toBe(true);
    const curledIndex = structuredClone(hand); curledIndex[8] = { ...curledIndex[0] };
    expect(isFrameHand(curledIndex)).toBe(false);
    const open = structuredClone(hand);
    for (const base of [9, 13, 17]) {
      open[base + 1] = { x: open[base].x, y: .45, z: 0 };
      open[base + 3] = { x: open[base].x, y: .2, z: 0 };
    }
    expect(isFrameHand(open)).toBe(false);
  });
  it('accepts a convex quadrilateral and rejects crossing, tiny, concave, and nonfinite points', () => {
    const [left, right] = frameHands();
    const corners = orderWindow(left, right);
    expect(validWindow(corners)).toBe(true);
    expect(validWindow([corners[0], corners[2], corners[1], corners[3]])).toBe(false);
    expect(validWindow([{ x: .1, y: .1 }, { x: .11, y: .1 }, { x: .11, y: .11 }, { x: .1, y: .11 }])).toBe(false);
    expect(validWindow([corners[0], corners[1], { x: .5, y: .21 }, corners[3]])).toBe(false);
    expect(validWindow([{ x: NaN, y: .1 }, ...corners.slice(1)] as typeof corners)).toBe(false);
  });
  it('mirrors coordinates once and fits landscape/portrait without stretching', () => {
    expect(mirrorPoint({ x: .2, y: .6 })).toEqual({ x: .8, y: .6 });
    expect(mirrorPoint(mirrorPoint({ x: .2, y: .6 })).x).toBeCloseTo(.2);
    expect(fitSize(1920, 1080, 1280)).toEqual({ width: 1280, height: 720 });
    expect(fitSize(1080, 1920, 1280)).toEqual({ width: 720, height: 1280 });
  });
});

describe('gesture lifecycle', () => {
  it('activates after 150ms and survives detection array reordering', () => {
    const tracker = new GestureTracker();
    tracker.update(frameHands(), 0); expect(tracker.state(0).phase).toBe('candidate');
    tracker.update(frameHands().reverse(), 149); expect(tracker.state(149).visibility).toBe(0);
    tracker.update(frameHands(), 150); expect(tracker.state(150).phase).toBe('active');
    tracker.update(frameHands().reverse(), 170);
    expect(tracker.state(170).corners![0].x).toBeCloseTo(.18);
  });
  it('holds for 120ms, fades for 100ms, and requires reacquisition after loss', () => {
    const tracker = new GestureTracker(); tracker.update(frameHands(), 0); tracker.update(frameHands(), 150);
    tracker.update([], 200);
    expect(tracker.state(270).visibility).toBe(1);
    expect(tracker.state(320).visibility).toBeCloseTo(.5);
    expect(tracker.state(370).phase).toBe('searching');
    tracker.update(frameHands(), 400); expect(tracker.state(400).phase).toBe('candidate');
  });
  it('does not accumulate short, interrupted candidate poses', () => {
    const tracker = new GestureTracker(); tracker.update(frameHands(), 0); tracker.update([], 100);
    tracker.update(frameHands(), 140); tracker.update(frameHands(), 240);
    expect(tracker.state(240).visibility).toBe(0);
  });
  it('never opens for one hand and clears after reset', () => {
    const tracker = new GestureTracker(); tracker.update([frameHand('left')], 0);
    expect(tracker.state(0).corners).toBeNull();
    tracker.update(frameHands(), 100); tracker.update(frameHands(), 250); tracker.reset();
    expect(tracker.state(300)).toEqual({ corners: null, visibility: 0, phase: 'searching' });
  });
});

describe('smoothing', () => {
  it('attenuates jitter without getting stuck and handles duplicate timestamps', () => {
    const filter = new OneEuroFilter(); expect(filter.filter(.5, 0)).toBe(.5);
    expect(filter.filter(.55, 50)).toBeGreaterThan(.5);
    expect(filter.filter(.55, 50)).toBeLessThan(.55);
    let result = .5; for (let i = 1; i <= 30; i++) result = filter.filter(.8, i * 50);
    expect(result).toBeCloseTo(.8, 2);
  });
});
