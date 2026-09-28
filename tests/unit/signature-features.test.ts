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

  // The affine fit recovers a linear field's derivatives, shrunk very slightly by its
  // regularization (λ ≈ one cell's variance, tiny next to the spread of a whole frame).
  it('radial expansion has positive divergence (2k for a linear field) and no curl', () => {
    const f = frame(radial(0.8));
    expect(f.divergence).toBeGreaterThan(0.99 * 1.6);
    expect(f.divergence).toBeLessThanOrEqual(1.6);
    expect(f.curl).toBeCloseTo(0, 10);
    expect(f.coherence).toBeLessThan(0.05);
  });

  it('radial contraction has negative divergence', () => {
    const f = frame(radial(-0.8));
    expect(f.divergence).toBeLessThan(-0.99 * 1.6);
    expect(f.divergence).toBeGreaterThanOrEqual(-1.6);
  });

  it('clockwise rotation on screen has positive curl (y down convention)', () => {
    const cw = swirl(1.5);
    // Sanity: above the center the field moves right, right of the center it moves down.
    expect(cw(0.5, 0.2)[0]).toBeGreaterThan(0);
    expect(cw(0.8, 0.5)[1]).toBeGreaterThan(0);
    const f = frame(cw);
    expect(f.curl).toBeGreaterThan(0.99 * 3);
    expect(f.curl).toBeLessThanOrEqual(3);
    expect(f.divergence).toBeCloseTo(0, 10);
    expect(frame(swirl(-1.5)).curl).toBeLessThan(-0.99 * 3);
  });

  it('divergence and curl scale linearly with speed, and translation adds nothing', () => {
    const base = frame(radial(0.8));
    const doubled = frame((x, y) => {
      const [u, v] = radial(0.8)(x, y);
      return [2 * u, 2 * v];
    });
    expect(doubled.divergence).toBeCloseTo(2 * base.divergence, 10);
    const cw = frame(swirl(1.5));
    const cwPlusDrift = frame((x, y) => {
      const [u, v] = swirl(1.5)(x, y);
      return [u + 3, v - 1];
    });
    // Drift changes the weights (|v|), so the fit moves a little, but the sign and size hold.
    expect(cwPlusDrift.curl).toBeGreaterThan(0.8 * cw.curl);
    expect(Math.abs(cwPlusDrift.divergence)).toBeLessThan(0.1 * cw.curl);
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

  it('single-column and single-row grids stay finite', () => {
    const single = spatialFeatures(frameOf(1, 1, rightward), 0, 1, 1, FLOOR);
    for (const value of Object.values(single)) expect(Number.isFinite(value)).toBe(true);
    expect(single.divergence).toBe(0);
    const row = spatialFeatures(frameOf(5, 1, radial(1)), 0, 5, 1, FLOOR);
    expect(Number.isFinite(row.divergence)).toBe(true);
    expect(row.divergence).toBeGreaterThan(0);
  });

  it('one moving cell has no divergence or curl; two cells moving apart diverge', () => {
    const one = frame((x, y) =>
      Math.abs(x - 0.5) < 0.02 && Math.abs(y - 0.5) < 0.03 ? [1, 0] : [0, 0],
    );
    expect(one.energy).toBeGreaterThan(0);
    expect(one.divergence).toBe(0);
    expect(one.curl).toBe(0);
    const apart = frame((x, y) => {
      if (Math.abs(y - 0.5) > 0.03) return [0, 0];
      if (Math.abs(x - 0.3) < 0.02) return [-1, 0];
      if (Math.abs(x - 0.7) < 0.02) return [1, 0];
      return [0, 0];
    });
    expect(apart.divergence).toBeGreaterThan(0);
    expect(apart.curl).toBeCloseTo(0, 10);
  });
});

/** Movement confined to a Gaussian blob in the middle of the frame (zero near the edges). */
function blob(fn: (dx: number, dy: number) => [number, number]) {
  return (x: number, y: number): [number, number] => {
    const dx = x - 0.5;
    const dy = y - 0.5;
    const g = Math.exp(-(dx * dx + dy * dy) / (2 * 0.08 ** 2));
    const [u, v] = fn(dx, dy);
    return [g * u, g * v];
  };
}

/** SPEC 8.2's original definition: the grid mean of central-difference divergence. */
function gridMeanDivergence(fn: Parameters<typeof frameOf>[2]): number {
  const field = frameOf(COLS, ROWS, fn);
  const at = (r: number, c: number, k: 0 | 1) =>
    field[(Math.min(ROWS - 1, Math.max(0, r)) * COLS + Math.min(COLS - 1, Math.max(0, c))) * 2 + k];
  let sum = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const hx = (Math.min(COLS - 1, c + 1) - Math.max(0, c - 1)) / COLS;
      const hy = (Math.min(ROWS - 1, r + 1) - Math.max(0, r - 1)) / ROWS;
      sum += (at(r, c + 1, 0) - at(r, c - 1, 0)) / hx + (at(r + 1, c, 1) - at(r - 1, c, 1)) / hy;
    }
  }
  return sum / (COLS * ROWS);
}

describe('divergence and curl of movement that stays inside the frame', () => {
  it('SPEC 8.2 grid means read ≈ 0 for it (they only see the frame border)', () => {
    expect(Math.abs(gridMeanDivergence(blob((dx, dy) => [5 * dx, 5 * dy])))).toBeLessThan(1e-3);
  });

  // The blob's own divergence is 10 at its center and falls off (and turns negative at its
  // rim); the speed-weighted fit lands in between, ≈ 1.7.
  it('the affine fit registers an expanding and a contracting blob', () => {
    const out = frame(blob((dx, dy) => [5 * dx, 5 * dy]));
    expect(out.divergence).toBeGreaterThan(1);
    expect(out.curl).toBeCloseTo(0, 10);
    const gather = frame(blob((dx, dy) => [-5 * dx, -5 * dy]));
    expect(gather.divergence).toBeCloseTo(-out.divergence, 10);
  });

  it('the affine fit registers a blob turning clockwise on screen (curl > 0)', () => {
    const cw = frame(blob((dx, dy) => [-5 * dy, 5 * dx]));
    expect(cw.curl).toBeGreaterThan(1);
    expect(cw.divergence).toBeCloseTo(0, 10);
    expect(frame(blob((dx, dy) => [5 * dy, -5 * dx])).curl).toBeCloseTo(-cw.curl, 10);
  });

  it('a translating blob has neither', () => {
    const f = frame(blob(() => [1, -0.5]));
    expect(f.energy).toBeGreaterThan(0);
    expect(f.divergence).toBeCloseTo(0, 10);
    expect(f.curl).toBeCloseTo(0, 10);
  });

  /** The blob moved so its center is at (cx, cy). */
  const blobAt =
    (cx: number, cy: number, fn: (dx: number, dy: number) => [number, number]) =>
    (x: number, y: number) =>
      blob(fn)(x - cx + 0.5, y - cy + 0.5);

  it('works away from the center too (the fit is about the moving cells, not the frame)', () => {
    // Centered on the cell at column 20, row 9 (so the sampled blob is symmetric), with
    // room around it so the frame edge doesn't cut off its tails.
    const cx = 20.5 / COLS;
    const cy = 9.5 / ROWS;
    const expansion = frame(blobAt(cx, cy, (dx, dy) => [5 * dx, 5 * dy])).divergence;
    expect(expansion).toBeGreaterThan(1);
    expect(frame(blobAt(cx, cy, (dx, dy) => [-5 * dy, 5 * dx])).curl).toBeGreaterThan(1);
    const drift = frame(blobAt(cx, cy, () => [1, 0]));
    expect(Math.abs(drift.divergence)).toBeLessThan(1e-3 * expansion);
    expect(Math.abs(drift.curl)).toBeLessThan(1e-3 * expansion);
  });

  it('a translating blob sampled off the grid reads a little divergence', () => {
    // The fit reads speed changing across the moving cells as expansion or contraction. A
    // blob falling between cell centers (or cut off by the frame edge) has a lopsided
    // speed profile about its centroid, so it reads a small divergence: a few percent of
    // a real expansion's with the same peak speed.
    for (const [cx, cy] of [
      [0.63, 0.52],
      [0.8, 0.7],
    ] as const) {
      const expansion = frame(blobAt(cx, cy, (dx, dy) => [5 * dx, 5 * dy])).divergence;
      const drift = frame(blobAt(cx, cy, () => [5 * 0.08, 0]));
      expect(Math.abs(drift.divergence)).toBeLessThan(0.1 * expansion);
      expect(Math.abs(drift.curl)).toBeLessThan(0.1 * expansion);
    }
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

  it('onsets: surge above max(2.5σ, 3 × p95 energy) with peak above 2 floors, 100 ms apart', () => {
    const fps = 30;
    const n = 60;
    const surge = new Array<number>(n).fill(0);
    const energy = new Array<number>(n).fill(0.1); // 3 × p95 = 0.3 per second
    const peak = new Array<number>(n).fill(0.5);
    surge[10] = 10;
    surge[12] = 10; // 67 ms later: inside the refractory period
    surge[20] = 10;
    surge[23] = 10; // exactly 100 ms after 20: allowed
    surge[40] = 10;
    peak[40] = 0.001; // the frame's strong cells are below the floor: not an onset
    surge[50] = 10;
    peak[50] = 0.015; // above the floor but inside the soft threshold's fade-in: noise level
    expect(detectOnsets(surge, energy, peak, 0.01, fps)).toEqual([10, 20, 23]);
    // Whole-frame energy below the per-cell floor doesn't matter; peak does.
    expect(detectOnsets(surge, new Array<number>(n).fill(0.001), peak, 0.01, fps)).toEqual([
      10, 20, 23,
    ]);
  });

  it('onsets need surge above 2.5 standard deviations', () => {
    // Evenly spread surges have a large σ, so none stands out.
    const surge = Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? 1 : -1));
    const ones = new Array<number>(20).fill(1);
    expect(detectOnsets(surge, new Array<number>(20).fill(0.01), ones, 0.01, 30)).toEqual([]);
    expect(detectOnsets(new Array<number>(20).fill(0), ones, ones, 0.01, 30)).toEqual([]);
  });

  it('steady movement with small wobbles has no onsets (SPEC 8.2’s 2.5σ alone found some)', () => {
    const fps = 30;
    // Moving steadily from the first frame, with a few small wobbles in speed.
    const speeds = Array.from({ length: 75 }, (_, f) => 0.5 + (f % 17 === 5 ? 0.02 : 0));
    const field = fieldOf(8, 8, speeds.length, (f) => () => [speeds[f] ?? 0, 0]);
    const features = computeFeatures({ field, frameCount: 75, cols: 8, rows: 8, fps, floor: 0.01 });
    expect(features.onsets).toEqual([]);
    // The old rule (surge > 2.5σ with energy above the floor) flags every wobble.
    const sigma = Math.sqrt(features.surge.reduce((s, x) => s + x * x, 0) / 75);
    expect(features.surge.filter((s) => s > 2.5 * sigma).length).toBeGreaterThan(0);
  });

  it('a movement that starts from stillness has one onset where it starts', () => {
    const speeds = Array.from({ length: 60 }, (_, f) => (f >= 10 ? 0.5 : 0));
    const field = fieldOf(8, 8, 60, (f) => () => [speeds[f] ?? 0, 0]);
    const features = computeFeatures({
      field,
      frameCount: 60,
      cols: 8,
      rows: 8,
      fps: 30,
      floor: 0.01,
    });
    expect(features.onsets).toEqual([10]);
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
