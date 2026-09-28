/**
 * Per-frame movement features (SPEC 8.2), computed from the final field (after the noise
 * floor and extraction smoothing).
 *
 * Conventions:
 * - Image coordinates: x right, **y down**. Cell centers p_c are in 0..1 field
 *   coordinates: ((c + 0.5) / cols, (r + 0.5) / rows).
 * - Velocities are field diagonals per second.
 * - `direction = atan2(−F.y, F.x)`: 0 = right, π/2 = up (math convention, up positive).
 * - Temporal derivatives multiply frame-to-frame differences by fps. The first frame's
 *   temporal features (acceleration, surge, jerk) are 0.
 * - Nothing here returns NaN or Infinity: empty or still frames give finite values.
 *
 * Divergence and curl (a documented change from SPEC 8.2's formulas, see DECISIONS):
 * SPEC 8.2 defines them as grid means of central-difference derivatives, but those means
 * telescope to values at the grid's edges (the discrete divergence and Stokes theorems),
 * so they measure only flow across, and circulation around, the frame border. A wink
 * that stays inside its focus box read ≈ 0 on both. Instead, each frame's moving cells
 * are fitted with one affine flow, weighted by speed, and its derivatives are used:
 *
 *   w_c = |v_c|,  p̄ = Σ w p / Σ w,  v̄ = Σ w v / Σ w
 *   Cpp = Σ w (p − p̄)(p − p̄)ᵀ + λ·Σw·I,   λ = ((1/cols)² + (1/rows)²) / 12
 *   Cvp = Σ w (v − v̄)(p − p̄)ᵀ
 *   A   = Cvp · Cpp⁻¹          (A ≈ the Jacobian [[∂u/∂x, ∂u/∂y], [∂v/∂x, ∂v/∂y]])
 *   divergence = A11 + A22,    curl = A21 − A12 = ∂v/∂x − ∂u/∂y
 *
 * λ, about one cell's own spatial variance, keeps the fit well posed when few cells move
 * (one moving cell gives A = 0). Σw ≈ 0 (nothing moves) gives 0 for both. Units and signs
 * are as before: velocity per field length; divergence > 0 when the moving parts spread
 * out (expanding), < 0 when they gather (contracting); and because y points down,
 * **curl > 0 means clockwise as seen on screen** (u = −ω·dy, v = ω·dx is a clockwise
 * swirl with curl 2ω). Pure translation gives 0 for both. Both scale linearly with
 * speed, like the other velocity features.
 *
 * Onsets (also a documented change from SPEC 8.2): see detectOnsets().
 */
import { percentile, percentileOfSorted, std } from '../lib/math';
import type { SignatureFeatures } from './types';

export const EPSILON = 1e-6;
/** Onsets need surge above this many standard deviations of surge. */
export const ONSET_SIGMAS = 2.5;
/** …and above this many times the clip's strong (95th percentile) energy, per second. */
export const ONSET_ENERGY_FACTOR = 3;
/** The frame's strong cells must move faster than this many noise floors. */
export const ONSET_PEAK_FLOORS = 2;
/** Minimum time between onsets, seconds. */
export const ONSET_REFRACTORY_SEC = 0.1;
/** Total weight (Σ|v|) at or below which a frame counts as still for the affine fit. */
const STILL_WEIGHT = 1e-12;

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

/** λ of the affine fit: one cell's own spatial variance in field units. */
export function affineRegularization(cols: number, rows: number): number {
  return (1 / (cols * cols) + 1 / (rows * rows)) / 12;
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

  // Pass 1: sums, magnitudes, and the speed-weighted means of position and velocity.
  let sumU = 0;
  let sumV = 0;
  let sumM = 0;
  let dense = 0;
  let wx = 0;
  let wy = 0;
  let wu = 0;
  let wv = 0;
  for (let r = 0; r < rows; r++) {
    const py = (r + 0.5) / rows;
    for (let c = 0; c < cols; c++) {
      const px = (c + 0.5) / cols;
      const i = offset + (r * cols + c) * 2;
      const cu = field[i];
      const cv = field[i + 1];
      const m = Math.hypot(cu, cv);
      scratch[r * cols + c] = m;
      sumU += cu;
      sumV += cv;
      sumM += m;
      if (m > floor) dense++;
      wx += m * px;
      wy += m * py;
      wu += m * cu;
      wv += m * cv;
    }
  }
  const n = cells > 0 ? cells : 1;
  const flowX = sumU / n;
  const flowY = sumV / n;
  const moving = sumM > STILL_WEIGHT;
  // The magnitude-weighted centroid is also the fit's mean position p̄.
  const centroidX = moving ? wx / sumM : 0.5;
  const centroidY = moving ? wy / sumM : 0.5;

  // Pass 2: weighted (co)variances about the means, for the affine fit and the spread.
  let divergence = 0;
  let curl = 0;
  let spread = 0;
  if (moving) {
    const meanU = wu / sumM;
    const meanV = wv / sumM;
    let cxx = 0;
    let cxy = 0;
    let cyy = 0;
    let uX = 0;
    let uY = 0;
    let vX = 0;
    let vY = 0;
    for (let r = 0; r < rows; r++) {
      const dy = (r + 0.5) / rows - centroidY;
      for (let c = 0; c < cols; c++) {
        const w = scratch[r * cols + c];
        if (w === 0) continue;
        const dx = (c + 0.5) / cols - centroidX;
        const i = offset + (r * cols + c) * 2;
        const du = field[i] - meanU;
        const dv = field[i + 1] - meanV;
        cxx += w * dx * dx;
        cxy += w * dx * dy;
        cyy += w * dy * dy;
        uX += w * du * dx;
        uY += w * du * dy;
        vX += w * dv * dx;
        vY += w * dv * dy;
      }
    }
    spread = Math.sqrt((cxx + cyy) / sumM);
    const ridge = affineRegularization(cols, rows) * sumM;
    const a = cxx + ridge;
    const b = cxy;
    const d = cyy + ridge;
    const det = a * d - b * b;
    if (det > 0) {
      // A = Cvp · Cpp⁻¹ with Cvp = [[uX, uY], [vX, vY]], Cpp⁻¹ = [[d, −b], [−b, a]] / det.
      const a11 = (uX * d - uY * b) / det;
      const a12 = (uY * a - uX * b) / det;
      const a21 = (vX * d - vY * b) / det;
      const a22 = (vY * a - vX * b) / det;
      divergence = a11 + a22;
      curl = a21 - a12;
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
    divergence: finite(divergence),
    curl: finite(curl),
    density: finite(dense / n),
    centroidX: finite(centroidX),
    centroidY: finite(centroidY),
    spread: finite(spread),
  };
}

/**
 * Onset frames, where movement gathers suddenly. A frame is an onset when
 *
 *   surge > max(2.5 σ(surge), 3 × p95(energy))   and   peak > 2 × floor,
 *
 * at least 100 ms after the previous onset. σ is the population standard deviation of
 * surge over the whole signature. Surge is per second, so the second term asks energy to
 * rise by at least the clip's strong energy within about a third of a second: small
 * wobbles in steady movement don't count (SPEC 8.2's 2.5 σ alone flagged them).
 *
 * `peak` (the frame's 95th-percentile cell speed) is compared with the per-cell floor,
 * because the whole-frame mean energy of a small movement can sit below a per-cell floor.
 * It must clear 2 × floor, where the soft threshold passes cells untouched: the auto floor
 * sits right at the noise's own strong cells, so on a still clip with camera noise
 * `peak > floor` let noise through (an onset at frame 4 of the noise fixture, with peak
 * 0.0074 against a floor of 0.0071).
 */
export function detectOnsets(
  surge: ArrayLike<number>,
  energy: ArrayLike<number>,
  peak: ArrayLike<number>,
  floor: number,
  fps: number,
): number[] {
  const threshold = Math.max(
    ONSET_SIGMAS * std(surge),
    ONSET_ENERGY_FACTOR * percentile(energy, 95),
  );
  const minPeak = ONSET_PEAK_FLOORS * floor;
  const onsets: number[] = [];
  let last = -1;
  for (let f = 0; f < surge.length; f++) {
    if (!(surge[f] > threshold && peak[f] > minPeak)) continue;
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

/** Every feature for every frame, as plain float64 arrays. */
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
  features.onsets = detectOnsets(features.surge, features.energy, features.peak, floor, fps);
  return features;
}
