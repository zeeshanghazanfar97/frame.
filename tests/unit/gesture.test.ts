import { describe, expect, it } from 'vitest';
import { frameHand, frameHands } from '../fixtures/hands';
import { fitSize, hasFingertips, mirrorPoint, orderCorners, orderWindow, polygonArea, validWindow } from '../../src/media/geometry';
import { GestureTracker, OneEuroFilter } from '../../src/media/gesture';

describe('frame geometry', () => {
  it('accepts fingertips without classifying the pose or other fingers', () => {
    const hand = frameHand('left');
    expect(hasFingertips(hand)).toBe(true);
    const portrait = frameHand('right').map(p => ({ ...p, x: .82 + (p.x - .82) / (9 / 16) }));
    expect(hasFingertips(portrait)).toBe(true);
    const curledIndex = structuredClone(hand); curledIndex[8] = { ...curledIndex[0] };
    expect(hasFingertips(curledIndex)).toBe(true);
    const open = structuredClone(hand);
    for (const base of [9, 13, 17]) {
      open[base + 1] = { x: open[base].x, y: .45, z: 0 };
      open[base + 3] = { x: open[base].x, y: .2, z: 0 };
    }
    expect(hasFingertips(open)).toBe(true);
    const missing = structuredClone(hand); missing[4].x = NaN;
    expect(hasFingertips(missing)).toBe(false);
    expect(hasFingertips([])).toBe(false);
  });
  it('accepts tiny, concave, offscreen, and degenerate polygons without distance thresholds', () => {
    const [left, right] = frameHands();
    const corners = orderWindow(left, right);
    expect(validWindow(corners)).toBe(true);
    expect(validWindow([{ x: .1, y: .1 }, { x: .100000001, y: .1 }, { x: .100000001, y: .100000001 }, { x: .1, y: .100000001 }])).toBe(true);
    expect(validWindow([corners[0], corners[1], { x: .5, y: .21 }, corners[3]])).toBe(true);
    expect(validWindow([{x:-.1,y:.1},{x:.8,y:.1},{x:1.1,y:.8},{x:.1,y:.8}])).toBe(true);
    expect(validWindow([{x:.5,y:.5},{x:.5,y:.5},{x:.5,y:.5},{x:.5,y:.5}])).toBe(true);
    expect(validWindow([{ x: NaN, y: .1 }, ...corners.slice(1)] as typeof corners)).toBe(false);
  });
  it('orders reversed thumb/index positions around the perimeter instead of drawing a bow tie',()=>{
    const left=frameHand('left'),right=frameHand('right');
    left[4]={x:.15,y:.2,z:0};left[8]={x:.2,y:.75,z:0};
    right[4]={x:.8,y:.75,z:0};right[8]={x:.85,y:.2,z:0};
    const ordered=orderWindow(left,right);
    expect(polygonArea(ordered)).toBeCloseTo(.3575);
    expect(ordered).toEqual(orderWindow(right,left));
    expect(ordered).toEqual([{x:.15,y:.2},{x:.85,y:.2},{x:.8,y:.75},{x:.2,y:.75}]);
  });
  it('keeps the inward fourth fingertip as a concave corner',()=>{
    const ordered=orderCorners([{x:.15,y:.15},{x:.85,y:.85},{x:.85,y:.15},{x:.5,y:.4}]);
    expect(ordered).toEqual([{x:.15,y:.15},{x:.85,y:.15},{x:.85,y:.85},{x:.5,y:.4}]);
    expect(polygonArea(ordered)).toBeCloseTo(.21);
  });
  it('mirrors coordinates once and fits landscape/portrait without stretching', () => {
    expect(mirrorPoint({ x: .2, y: .6 })).toEqual({ x: .8, y: .6 });
    expect(mirrorPoint(mirrorPoint({ x: .2, y: .6 })).x).toBeCloseTo(.2);
    expect(fitSize(1920, 1080, 1280)).toEqual({ width: 1280, height: 720 });
    expect(fitSize(1080, 1920, 1280)).toEqual({ width: 720, height: 1280 });
  });
});

describe('gesture lifecycle', () => {
  it('preserves fingertip smoothing identities when wrists overlap and detection order reverses',()=>{
    const hands=frameHands();hands[0][0]={x:.5,y:.5,z:0};hands[1][0]={x:.5,y:.5,z:0};
    const tracker=new GestureTracker();tracker.update(hands,0);tracker.update(hands,150);
    const before=tracker.state(150).corners;tracker.update([...hands].reverse(),200);
    expect(tracker.state(200).corners).toEqual(before);
  });
  it('accepts independently rotated hands at every right angle, including opposite orientations',()=>{
    const rotate=(hand:ReturnType<typeof frameHand>,degrees:number)=>{
      const origin=hand[0],angle=degrees*Math.PI/180;
      return hand.map(p=>({...p,x:origin.x+(p.x-origin.x)*Math.cos(angle)-(p.y-origin.y)*Math.sin(angle),y:origin.y+(p.x-origin.x)*Math.sin(angle)+(p.y-origin.y)*Math.cos(angle)}));
    };
    for(const left of [0,90,180,270])for(const right of [0,90,180,270]){
      const tracker=new GestureTracker(),hands=[rotate(frameHand('left'),left),rotate(frameHand('right'),right)];
      tracker.update(hands,0);tracker.update(hands,150);
      expect(tracker.state(150).phase,`${left}/${right}`).toBe('active');
      expect(tracker.state(150).corners).toHaveLength(4);
    }
  });
  it('tracks arbitrarily close fingertips and overlapping hand positions',()=>{
    for(const spacing of [0,1e-9,.001,.01,.1,.8]){
      const hands=frameHands();
      hands[0][0]={x:.5,y:.5,z:0};hands[1][0]={x:.5+spacing,y:.5,z:0};
      hands[0][4]={x:.5,y:.5,z:0};hands[0][8]={x:.5,y:.5+spacing,z:0};
      hands[1][4]={x:.5+spacing,y:.5,z:0};hands[1][8]={x:.5+spacing,y:.5+spacing,z:0};
      const tracker=new GestureTracker();tracker.update(hands,0);tracker.update(hands,150);
      expect(tracker.state(150).visibility).toBe(1);
    }
  });
  it('remains active when hands cross and corners change their perimeter order',()=>{
    const tracker=new GestureTracker();tracker.update(frameHands(),0);tracker.update(frameHands(),150);
    const crossing=frameHands();
    crossing[0][0].x=.9;crossing[1][0].x=.1;
    crossing[0][4]={x:.82,y:.2,z:0};crossing[0][8]={x:.7,y:.6,z:0};
    crossing[1][4]={x:.18,y:.2,z:0};crossing[1][8]={x:.3,y:.6,z:0};
    tracker.update(crossing,200);
    expect(tracker.state(200).phase).toBe('active');
    expect(validWindow(tracker.state(200).corners!)).toBe(true);
  });
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
