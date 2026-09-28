import { describe, expect, it } from 'vitest';
import { featureStats, computeStats } from '../../src/signature/stats';
import { normalizeWindow, smoothOverTime } from '../../src/signature/temporalSmoothing';
import { FEATURE_NAMES, type SignatureFeatures } from '../../src/signature/types';

describe('extraction smoothing window', () => {
  it('allows 1, 3, 5, 7, 9 and rounds anything else to the nearest', () => {
    expect([1, 3, 5, 7, 9].map(normalizeWindow)).toEqual([1, 3, 5, 7, 9]);
    expect(normalizeWindow(0)).toBe(1);
    expect(normalizeWindow(2)).toBe(3);
    expect(normalizeWindow(4)).toBe(5);
    expect(normalizeWindow(11)).toBe(9);
    expect(normalizeWindow(NaN)).toBe(3);
  });
});

describe('centered moving average over time', () => {
  const series = (values: number[]) => Float32Array.from(values);

  it('window 1 leaves the data unchanged', () => {
    const data = series([1, 5, 2, 8]);
    expect(Array.from(smoothOverTime(data, 4, 1, 1))).toEqual([1, 5, 2, 8]);
  });

  it('window 3 spreads an impulse to its neighbours', () => {
    const out = smoothOverTime(series([0, 0, 3, 0, 0]), 5, 1, 3);
    expect(Array.from(out)).toEqual([0, 1, 1, 1, 0]);
  });

  it('shrinks to the frames that exist at the edges (end frames are smoothed too)', () => {
    const data = series([9, 0, 0, 0, 0, 0, 6]);
    const out = smoothOverTime(data, 7, 1, 5);
    expect(out[0]).toBeCloseTo(3, 6); // frames 0..2
    expect(out[1]).toBeCloseTo(9 / 4, 6); // frames 0..3
    expect(out[2]).toBeCloseTo(9 / 5, 6); // frames 0..4
    expect(out[5]).toBeCloseTo(6 / 4, 6); // frames 3..6
    expect(out[6]).toBeCloseTo(2, 6); // frames 4..6
  });

  it('is centered away from the edges: a linear ramp comes back unchanged there', () => {
    const ramp = series([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    for (const window of [3, 5, 7, 9]) {
      const half = (window - 1) / 2;
      const out = smoothOverTime(ramp, 12, 1, window);
      for (let i = half; i < 12 - half; i++) expect(out[i]).toBeCloseTo(i, 5);
    }
  });

  it('smooths every value of a frame independently (stride) and leaves the input alone', () => {
    // Three frames of 2 values: [a0 b0] [a1 b1] [a2 b2]
    const data = series([0, 10, 3, 10, 0, 40]);
    const out = smoothOverTime(data, 3, 2, 3);
    expect(Array.from(out)).toEqual([1.5, 10, 1, 20, 1.5, 25]);
    expect(Array.from(data)).toEqual([0, 10, 3, 10, 0, 40]);
  });
});

describe('feature stats', () => {
  it('min, max, mean, p05, p95 with linear interpolation', () => {
    const values = Array.from({ length: 101 }, (_, i) => i); // 0..100
    expect(featureStats(values)).toEqual({ min: 0, max: 100, mean: 50, p05: 5, p95: 95 });
    const s = featureStats([4, 1, 3, 2]);
    expect(s.min).toBe(1);
    expect(s.max).toBe(4);
    expect(s.mean).toBe(2.5);
    expect(s.p05).toBeCloseTo(1.15, 10);
    expect(s.p95).toBeCloseTo(3.85, 10);
  });

  it('is all zeros for an empty series and finite with bad input', () => {
    expect(featureStats([])).toEqual({ min: 0, max: 0, mean: 0, p05: 0, p95: 0 });
    const s = featureStats([1, NaN, 2]);
    for (const v of Object.values(s)) expect(Number.isFinite(v)).toBe(true);
  });

  it('covers every feature name', () => {
    const features = { onsets: [2] } as SignatureFeatures;
    for (const name of FEATURE_NAMES) features[name] = [0, 1, 2];
    const stats = computeStats(features);
    expect(Object.keys(stats).sort()).toEqual([...FEATURE_NAMES].sort());
    expect(stats.energy).toEqual({ min: 0, max: 2, mean: 1, p05: 0.1, p95: 1.9 });
  });
});
