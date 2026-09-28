import { describe, expect, it } from 'vitest';
import {
  areaPath,
  directionBuckets,
  linePath,
  seriesPoints,
  signedRange,
  unsignedRange,
  yFor,
} from '../../src/ui/sparklineMath';

describe('sparkline maths', () => {
  it('scales unsigned series from 0 and signed series around 0', () => {
    expect(unsignedRange([0.1, 0.4, NaN, 0.2])).toEqual({ min: 0, max: 0.4 });
    expect(unsignedRange([0, 0]).max).toBeGreaterThan(0);
    expect(signedRange([-0.3, 0.1, 0.2])).toEqual({ min: -0.3, max: 0.3 });
    expect(yFor(0, { min: -1, max: 1 }, 100)).toBe(50);
    expect(yFor(1, { min: 0, max: 1 }, 100)).toBe(0);
    expect(yFor(5, { min: 0, max: 1 }, 100)).toBe(0);
    expect(yFor(-5, { min: 0, max: 1 }, 100)).toBe(100);
  });

  it('lays frame i at i / n of the width and holds the last frame to the edge', () => {
    const points = seriesPoints([0, 1, 0.5, 1], 400, 100, { min: 0, max: 1 });
    expect(points).toEqual([
      [0, 100],
      [100, 0],
      [200, 50],
      [300, 0],
      [400, 0],
    ]);
    expect(seriesPoints([], 400, 100, { min: 0, max: 1 })).toEqual([]);
  });

  it('builds line and area paths', () => {
    const points: Array<[number, number]> = [
      [0, 10],
      [50.123, 20],
      [100, 30],
    ];
    expect(linePath(points)).toBe('M0 10 L50.12 20 L100 30');
    expect(areaPath(points, 100)).toBe('M0 10 L50.12 20 L100 30 L100 100 L0 100 Z');
    expect(areaPath([], 100)).toBe('');
  });

  it('averages flow vectors into direction buckets', () => {
    // Down for 4 frames, then up for 4 frames (a wink: close, then open).
    const flowX = [0, 0, 0, 0, 0, 0, 0, 0];
    const flowY = [1, 1, 1, 1, -2, -2, -2, -2];
    const buckets = directionBuckets(flowX, flowY, 2);
    expect(buckets).toHaveLength(2);
    expect(buckets[0].angle).toBeCloseTo(Math.PI / 2, 12); // down on screen
    expect(buckets[1].angle).toBeCloseTo(-Math.PI / 2, 12); // up
    expect(buckets[0].strength).toBeCloseTo(0.5, 12);
    expect(buckets[1].strength).toBe(1);
  });

  it('treats back-and-forth or still stretches as weak, and never makes more buckets than frames', () => {
    const buckets = directionBuckets([1, -1, 0, 0, 3, 3], [0, 0, 0, 0, 0, 0], 3);
    expect(buckets.map((b) => b.strength)).toEqual([0, 0, 1]);
    expect(directionBuckets([1, 2], [0, 0], 10)).toHaveLength(2);
    expect(directionBuckets([], [], 10)).toEqual([]);
    expect(directionBuckets([0, 0], [0, 0], 2).every((b) => b.strength === 0)).toBe(true);
  });
});
