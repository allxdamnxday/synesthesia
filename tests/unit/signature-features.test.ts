import { describe, expect, it } from 'vitest';
import {
  computeFeatures,
  continuityFromJerk,
  detectOnsets,
  spatialFeatures,
} from '../../src/signature/features';
import { FEATURE_NAMES } from '../../src/signature/types';
import { fieldOf, frameOf, radial, rightward, still, swirl, upward } from './signatureFields';

const COLS = 32;
const ROWS = 18;
const FLOOR = 0.01;

function frame(fn: Parameters<typeof frameOf>[2]) {
  return spatialFeatures(frameOf(COLS, ROWS, fn), 0, COLS, ROWS, FLOOR);
}

describe('spatial features on synthetic fields', () => {
  it('uniform translation right: direction 0, coherence 1, no divergence or curl', () => {
    const f = frame(rightward);
    expect(f.direction).toBeCloseTo(0, 10);
    expect(f.coherence).toBeCloseTo(1, 5);
    expect(f.divergence).toBeCloseTo(0, 10);
    expect(f.curl).toBeCloseTo(0, 10);
    expect(f.energy).toBeCloseTo(1, 6);
    expect(f.peak).toBeCloseTo(1, 6);
    expect(f.flowX).toBeCloseTo(1, 6);
    expect(f.flowY).toBeCloseTo(0, 10);
    expect(f.density).toBe(1);
    expect(f.centroidX).toBeCloseTo(0.5, 10);
    expect(f.centroidY).toBeCloseTo(0.5, 10);
  });

  it('uniform translation up (negative y): direction π/2, coherence 1', () => {
    const f = frame(upward);
    expect(f.direction).toBeCloseTo(Math.PI / 2, 10);
    expect(f.coherence).toBeCloseTo(1, 5);
    expect(f.divergence).toBeCloseTo(0, 10);
    expect(f.flowY).toBeCloseTo(-1, 6);
  });

  it('left and down map to ±π and −π/2', () => {
    expect(Math.abs(frame(() => [-1, 0]).direction)).toBeCloseTo(Math.PI, 10);
    expect(frame(() => [0, 1]).direction).toBeCloseTo(-Math.PI / 2, 10);
  });

  it('radial expansion has positive divergence (2k for a linear field) and no curl', () => {
    const f = frame(radial(0.8));
    expect(f.divergence).toBeCloseTo(1.6, 4);
    expect(f.curl).toBeCloseTo(0, 6);
    expect(f.coherence).toBeLessThan(0.05);
  });

  it('radial contraction has negative divergence', () => {
    const f = frame(radial(-0.8));
    expect(f.divergence).toBeCloseTo(-1.6, 4);
  });

  it('clockwise rotation on screen has positive curl (y down convention)', () => {
    const cw = swirl(1.5);
    // Sanity: above the center the field moves right, right of the center it moves down.
    expect(cw(0.5, 0.2)[0]).toBeGreaterThan(0);
    expect(cw(0.8, 0.5)[1]).toBeGreaterThan(0);
    const f = frame(cw);
    expect(f.curl).toBeCloseTo(3, 4);
    expect(f.divergence).toBeCloseTo(0, 6);
    expect(frame(swirl(-1.5)).curl).toBeCloseTo(-3, 4);
  });

  it('zero field: energy 0, density 0, finite everything, no −0', () => {
    const f = frame(still);
    expect(f.energy).toBe(0);
    expect(f.density).toBe(0);
    expect(f.coherence).toBe(0);
    expect(f.spread).toBe(0);
    expect(f.centroidX).toBe(0.5);
    expect(f.centroidY).toBe(0.5);
    for (const value of Object.values(f)) expect(Number.isFinite(value)).toBe(true);
  });

  it('density counts cells above the floor; centroid follows the moving cells', () => {
    // Only the right half moves.
    const f = frame((x) => (x > 0.5 ? [0.5, 0] : [0, 0]));
    expect(f.density).toBeCloseTo(0.5, 10);
    expect(f.centroidX).toBeGreaterThan(0.7);
    expect(f.centroidY).toBeCloseTo(0.5, 10);
    expect(f.spread).toBeGreaterThan(0);
  });

  it('peak is the 95th percentile of cell magnitudes', () => {
    // Magnitude grows with x: 0..1 across the frame.
    const f = frame((x) => [x, 0]);
    const mags = Array.from({ length: COLS }, (_, c) => (c + 0.5) / COLS).sort((a, b) => a - b);
    // Every row repeats the same magnitudes, so p95 over all cells ≈ p95 over one row.
    expect(f.peak).toBeGreaterThan(mags[Math.floor(0.9 * COLS)]);
    expect(f.peak).toBeLessThanOrEqual(1);
  });

  it('divergence and curl of movement that stays inside the frame read ≈ 0 (boundary property)', () => {
    // A Gaussian blob expanding about the center, zero at the frame edges.
    const blob = (x: number, y: number): [number, number] => {
      const g = Math.exp(-((x - 0.5) ** 2 + (y - 0.5) ** 2) / (2 * 0.08 ** 2));
      return [g * (x - 0.5) * 5, g * (y - 0.5) * 5];
    };
    const f = frame(blob);
    expect(Math.abs(f.divergence)).toBeLessThan(1e-3);
  });

  it('single-column and single-row grids stay finite', () => {
    const single = spatialFeatures(frameOf(1, 1, rightward), 0, 1, 1, FLOOR);
    for (const value of Object.values(single)) expect(Number.isFinite(value)).toBe(true);
    expect(single.divergence).toBe(0);
    const row = spatialFeatures(frameOf(5, 1, radial(1)), 0, 5, 1, FLOOR);
    expect(Number.isFinite(row.divergence)).toBe(true);
  });
});

describe('temporal features', () => {
  it('first frame derivatives are 0; acceleration, surge and jerk use fps', () => {
    const fps = 30;
    // Speed 0, 0, 1, 1, 3 (rightward); energy follows the speed.
    const speeds = [0, 0, 1, 1, 3];
    const field = fieldOf(4, 4, speeds.length, (f) => () => [speeds[f] ?? 0, 0]);
    const features = computeFeatures({
      field,
      frameCount: speeds.length,
      cols: 4,
      rows: 4,
      fps,
      floor: 0.01,
    });
    const expectClose = (actual: number[], expected: number[]) => {
      expect(actual).toHaveLength(expected.length);
      expected.forEach((x, i) => expect(actual[i]).toBeCloseTo(x, 4));
    };
    expect(features.acceleration[0]).toBe(0);
    expect(features.surge[0]).toBe(0);
    expect(features.jerk[0]).toBe(0);
    expectClose(features.acceleration, [0, 0, 30, 0, 60]);
    expectClose(features.surge, [0, 0, 30, 0, 60]);
    // jerk = |a_t − a_{t−1}| × fps
    expectClose(features.jerk, [0, 0, 900, 900, 1800]);
  });

  it('continuity is 1 without jerk and 1 / (1 + jerk / p95) otherwise', () => {
    expect(continuityFromJerk([0, 0, 0])).toEqual([1, 1, 1]);
    const jerk = [0, 0, 0, 0, 10];
    const c = continuityFromJerk(jerk);
    const p95 = 8; // linear interpolation: rank 0.95 × 4 = 3.8 → 0 + (10 − 0) × 0.8
    expect(c[4]).toBeCloseTo(1 / (1 + 10 / p95), 10);
    expect(c[0]).toBe(1);
  });

  it('onsets: surge above 2.5σ with energy above the floor, 100 ms refractory', () => {
    const fps = 30;
    const n = 60;
    const surge = new Array<number>(n).fill(0);
    const energy = new Array<number>(n).fill(0.5);
    surge[10] = 10;
    surge[12] = 10; // 67 ms later: inside the refractory period
    surge[20] = 10;
    surge[23] = 10; // exactly 100 ms after 20: allowed
    surge[40] = 10;
    energy[40] = 0.001; // below the floor: not an onset
    expect(detectOnsets(surge, energy, 0.01, fps)).toEqual([10, 20, 23]);
  });

  it('onsets need surge above 2.5 standard deviations', () => {
    // Evenly spread surges have a large σ, so none stands out.
    const surge = Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? 1 : -1));
    expect(detectOnsets(surge, new Array(20).fill(1), 0.01, 30)).toEqual([]);
    expect(detectOnsets(new Array(20).fill(0), new Array(20).fill(1), 0.01, 30)).toEqual([]);
  });

  it('never produces NaN or Infinity, even from a field with NaN in it', () => {
    const field = fieldOf(6, 4, 5, (f) => (f === 2 ? () => [NaN, Infinity] : rightward));
    const features = computeFeatures({
      field,
      frameCount: 5,
      cols: 6,
      rows: 4,
      fps: 30,
      floor: 0.01,
    });
    for (const name of FEATURE_NAMES) {
      for (const value of features[name]) expect(Number.isFinite(value), name).toBe(true);
    }
  });

  it('a still clip has zero energy, zero density and no onsets', () => {
    const field = fieldOf(8, 8, 30, () => still);
    const features = computeFeatures({
      field,
      frameCount: 30,
      cols: 8,
      rows: 8,
      fps: 30,
      floor: 0.01,
    });
    expect(features.energy.every((e) => e === 0)).toBe(true);
    expect(features.density.every((d) => d === 0)).toBe(true);
    expect(features.continuity.every((c) => c === 1)).toBe(true);
    expect(features.onsets).toEqual([]);
  });
});
