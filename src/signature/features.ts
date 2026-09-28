/**
 * Per-frame movement features (SPEC 8.2), computed from the final field (after the noise
 * floor and extraction smoothing).
 *
 * Conventions:
 * - Image coordinates: x right, **y down**. Cell centers p_c are in 0..1 field
 *   coordinates: ((c + 0.5) / cols, (r + 0.5) / rows).
 * - Velocities are field diagonals per second.
 * - Spatial derivatives use central differences with grid spacing in field units
 *   (1 / cols across, 1 / rows down), one-sided at the borders, and 0 along an axis with a
 *   single cell.
 * - `direction = atan2(−F.y, F.x)`: 0 = right, π/2 = up (math convention, up positive).
 * - `curl = mean(∂v/∂x − ∂u/∂y)`. Because y points down, **curl > 0 means clockwise as
 *   seen on screen** (u = −ω·dy, v = ω·dx is a clockwise swirl with curl 2ω).
 * - Temporal derivatives multiply frame-to-frame differences by fps. The first frame's
 *   temporal features (acceleration, surge, jerk) are 0.
 *
 * Note: the mean of a central-difference derivative over the whole grid telescopes to
 * values near the grid's edges (the discrete divergence and Stokes theorems), so
 * `divergence` and `curl` measure net flow across, and circulation around, the frame
 * border. Movement that stays well inside the frame reads close to 0 on both.
 *
 * Nothing here returns NaN or Infinity: empty or still frames give finite values.
 */
import { percentileOfSorted, std } from '../lib/math';
import type { SignatureFeatures } from './types';

export const EPSILON = 1e-6;
/** Onsets need surge above this many standard deviations of surge (SPEC 8.2). */
export const ONSET_SIGMAS = 2.5;
/** Minimum time between onsets, seconds. */
export const ONSET_REFRACTORY_SEC = 0.1;

export interface SpatialFeatures {
  energy: number;
  peak: number;
  flowX: number;
  flowY: number;
  direction: number;
  coherence: number;
  divergence: number;
  curl: number;
  density: number;
  centroidX: number;
  centroidY: number;
  spread: number;
}

function finite(x: number): number {
  return Number.isFinite(x) ? x : 0;
}

/**
 * Spatial features of one frame. `field` holds rows × cols × 2 values (u, v) starting at
 * `offset`. `scratch` (length ≥ cols × rows) avoids an allocation per frame.
 */
export function spatialFeatures(
  field: ArrayLike<number>,
  offset: number,
  cols: number,
  rows: number,
  floor: number,
  scratch: Float64Array = new Float64Array(cols * rows),
): SpatialFeatures {
  const cells = cols * rows;
  const u = (r: number, c: number): number => field[offset + (r * cols + c) * 2];
  const v = (r: number, c: number): number => field[offset + (r * cols + c) * 2 + 1];

  let sumU = 0;
  let sumV = 0;
  let sumM = 0;
  let dense = 0;
  let wx = 0;
  let wy = 0;
  let div = 0;
  let curl = 0;
  for (let r = 0; r < rows; r++) {
    const py = (r + 0.5) / rows;
    const rUp = Math.max(0, r - 1);
    const rDown = Math.min(rows - 1, r + 1);
    const hy = (rDown - rUp) / rows;
    for (let c = 0; c < cols; c++) {
      const px = (c + 0.5) / cols;
      const cu = u(r, c);
      const cv = v(r, c);
      const m = Math.hypot(cu, cv);
      scratch[r * cols + c] = m;
      sumU += cu;
      sumV += cv;
      sumM += m;
      if (m > floor) dense++;
      wx += m * px;
      wy += m * py;

      const cLeft = Math.max(0, c - 1);
      const cRight = Math.min(cols - 1, c + 1);
      const hx = (cRight - cLeft) / cols;
      const dudx = hx > 0 ? (u(r, cRight) - u(r, cLeft)) / hx : 0;
      const dvdx = hx > 0 ? (v(r, cRight) - v(r, cLeft)) / hx : 0;
      const dudy = hy > 0 ? (u(rDown, c) - u(rUp, c)) / hy : 0;
      const dvdy = hy > 0 ? (v(rDown, c) - v(rUp, c)) / hy : 0;
      div += dudx + dvdy;
      curl += dvdx - dudy;
    }
  }

  const n = cells > 0 ? cells : 1;
  const flowX = sumU / n;
  const flowY = sumV / n;
  const centroidX = sumM > 0 ? wx / sumM : 0.5;
  const centroidY = sumM > 0 ? wy / sumM : 0.5;
  let spreadAcc = 0;
  if (sumM > 0) {
    for (let r = 0; r < rows; r++) {
      const dy = (r + 0.5) / rows - centroidY;
      for (let c = 0; c < cols; c++) {
        const dx = (c + 0.5) / cols - centroidX;
        spreadAcc += scratch[r * cols + c] * (dx * dx + dy * dy);
      }
    }
  }
  const magnitudes = scratch.subarray(0, cells).sort();
  return {
    energy: finite(sumM / n),
    peak: finite(percentileOfSorted(magnitudes, 95)),
    flowX: finite(flowX),
    flowY: finite(flowY),
    direction: finite(Math.atan2(-flowY, flowX)),
    coherence: finite(Math.hypot(sumU, sumV) / (sumM + EPSILON)),
    divergence: finite(div / n),
    curl: finite(curl / n),
    density: finite(dense / n),
    centroidX: finite(centroidX),
    centroidY: finite(centroidY),
    spread: sumM > 0 ? finite(Math.sqrt(spreadAcc / sumM)) : 0,
  };
}

/**
 * Onset frames: surge > 2.5 σ(surge) and energy > floor, at least 100 ms apart
 * (SPEC 8.2). σ is the population standard deviation of surge over the whole signature.
 */
export function detectOnsets(
  surge: ArrayLike<number>,
  energy: ArrayLike<number>,
  floor: number,
  fps: number,
): number[] {
  const threshold = ONSET_SIGMAS * std(surge);
  const onsets: number[] = [];
  let last = -1;
  for (let f = 0; f < surge.length; f++) {
    if (!(surge[f] > threshold && energy[f] > floor)) continue;
    if (last >= 0 && (f - last) / fps < ONSET_REFRACTORY_SEC - 1e-9) continue;
    onsets.push(f);
    last = f;
  }
  return onsets;
}

/** continuity = 1 / (1 + jerk / p95(jerk)); 1 everywhere when there is no jerk at all. */
export function continuityFromJerk(jerk: ArrayLike<number>): number[] {
  const sorted = Float64Array.from(jerk).sort();
  const p95 = percentileOfSorted(sorted, 95);
  const out: number[] = [];
  for (let f = 0; f < jerk.length; f++) {
    out.push(p95 > 0 ? finite(1 / (1 + jerk[f] / p95)) : 1);
  }
  return out;
}

export interface FeatureInput {
  /** frameCount × rows × cols × 2 (u, v), field diagonals per second. */
  field: Float32Array;
  frameCount: number;
  cols: number;
  rows: number;
  /** Analysis frames per second. */
  fps: number;
  /** Noise floor used for density and onsets. */
  floor: number;
}

/** Every SPEC 8.2 feature for every frame, as plain float64 arrays. */
export function computeFeatures(input: FeatureInput): SignatureFeatures {
  const { field, frameCount, cols, rows, fps, floor } = input;
  const cells = cols * rows;
  if (field.length < frameCount * cells * 2) throw new Error('Field is shorter than frameCount');
  const features: SignatureFeatures = {
    energy: [],
    peak: [],
    flowX: [],
    flowY: [],
    direction: [],
    coherence: [],
    divergence: [],
    curl: [],
    acceleration: [],
    surge: [],
    jerk: [],
    continuity: [],
    density: [],
    centroidX: [],
    centroidY: [],
    spread: [],
    onsets: [],
  };
  const scratch = new Float64Array(cells);
  for (let f = 0; f < frameCount; f++) {
    const s = spatialFeatures(field, f * cells * 2, cols, rows, floor, scratch);
    features.energy.push(s.energy);
    features.peak.push(s.peak);
    features.flowX.push(s.flowX);
    features.flowY.push(s.flowY);
    features.direction.push(s.direction);
    features.coherence.push(s.coherence);
    features.divergence.push(s.divergence);
    features.curl.push(s.curl);
    features.density.push(s.density);
    features.centroidX.push(s.centroidX);
    features.centroidY.push(s.centroidY);
    features.spread.push(s.spread);
  }
  for (let f = 0; f < frameCount; f++) {
    if (f === 0) {
      features.acceleration.push(0);
      features.surge.push(0);
      features.jerk.push(0);
      continue;
    }
    const ax = features.flowX[f] - features.flowX[f - 1];
    const ay = features.flowY[f] - features.flowY[f - 1];
    const acceleration = finite(Math.hypot(ax, ay) * fps);
    features.acceleration.push(acceleration);
    features.surge.push(finite((features.energy[f] - features.energy[f - 1]) * fps));
    features.jerk.push(finite(Math.abs(acceleration - features.acceleration[f - 1]) * fps));
  }
  features.continuity = continuityFromJerk(features.jerk);
  features.onsets = detectOnsets(features.surge, features.energy, floor, fps);
  return features;
}
