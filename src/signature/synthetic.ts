/**
 * Synthetic signatures for developing and testing materials before (and independently
 * of) real extraction. `createSyntheticSampler('wink')` plays an analytic wink: an eyelid
 * closes (downward motion), holds, then opens (upward motion), with clear onsets.
 *
 * Features here are a close, simplified approximation of SPEC 8.2 computed from the
 * analytic field; real signatures use src/signature/features.ts. This module is for
 * dev harness pages, benchmarks and tests only.
 */
import { clamp01, lerp, percentile } from '../lib/math';
import {
  DEFAULT_SAMPLER_CONFIG,
  FEATURE_NAMES,
  SIGNED_FEATURES,
  VELOCITY_FEATURES,
  type FeatureName,
  type SamplerConfig,
  type SignatureFrame,
  type SignatureSampler,
} from './types';

export type SyntheticKind = 'wink' | 'sweep' | 'still' | 'swirl';

interface SyntheticData {
  fps: number;
  frameCount: number;
  cols: number;
  rows: number;
  field: Float32Array;
  features: Record<FeatureName, Float32Array>;
  onsets: number[];
  normLo: Record<FeatureName, number>;
  normHi: Record<FeatureName, number>;
}

/** Smooth 0→1→0 bump over [start, end]. */
function bump(t: number, start: number, end: number): number {
  if (t <= start || t >= end) return 0;
  const x = (t - start) / (end - start);
  const s = Math.sin(Math.PI * x);
  return s * s;
}

function gaussian(dx: number, dy: number, radius: number): number {
  return Math.exp(-(dx * dx + dy * dy) / (2 * radius * radius));
}

/** Velocity (u, v) at field point (x, y) and time t, in field diagonals per second. */
function velocityAt(kind: SyntheticKind, x: number, y: number, t: number): [number, number] {
  switch (kind) {
    case 'still':
      return [0, 0];
    case 'sweep': {
      // A soft blob crossing left to right, then rising.
      const cx = lerp(0.15, 0.85, clamp01((t - 0.3) / 1.4));
      const w = gaussian(x - cx, y - 0.55, 0.12) * bump(t, 0.3, 1.7);
      const rise = gaussian(x - 0.7, y - 0.5, 0.15) * bump(t, 1.8, 2.6);
      return [1.2 * w, -1.4 * rise];
    }
    case 'swirl': {
      // Clockwise rotation (as seen on screen) that swells and fades.
      const dx = x - 0.5;
      const dy = y - 0.5;
      const a = bump(t, 0.2, 2.8) * gaussian(dx, dy, 0.22) * 6;
      return [-dy * a, dx * a];
    }
    case 'wink': {
      // Eyelid closes (down), holds, opens (up); the cheek lifts slightly as it closes.
      const lid = gaussian(x - 0.5, (y - 0.42) * 1.6, 0.16);
      const close = bump(t, 0.6, 0.9);
      const open = bump(t, 1.15, 1.45);
      const cheek = gaussian(x - 0.5, y - 0.72, 0.14) * bump(t, 0.62, 0.95);
      const v = lid * (1.8 * close - 1.7 * open) - 0.35 * cheek;
      const u = lid * 0.12 * (close - open) * (x - 0.5) * 4;
      return [u, v];
    }
  }
}

const DURATIONS: Record<SyntheticKind, number> = {
  wink: 2.2,
  sweep: 2.8,
  still: 2,
  swirl: 3,
};

function build(kind: SyntheticKind, fps: number, cols: number, rows: number): SyntheticData {
  const frameCount = Math.round(DURATIONS[kind] * fps);
  const cells = cols * rows;
  const field = new Float32Array(frameCount * cells * 2);
  const features = {} as Record<FeatureName, Float32Array>;
  for (const name of FEATURE_NAMES) features[name] = new Float32Array(frameCount);
  const floor = 0.02;
  const mags = new Float32Array(cells);

  for (let f = 0; f < frameCount; f++) {
    const t = f / fps;
    let sumU = 0;
    let sumV = 0;
    let sumM = 0;
    let wx = 0;
    let wy = 0;
    let dense = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const [u, v] = velocityAt(kind, (c + 0.5) / cols, (r + 0.5) / rows, t);
        const i = (f * cells + r * cols + c) * 2;
        field[i] = u;
        field[i + 1] = v;
        const m = Math.hypot(u, v);
        mags[r * cols + c] = m;
        sumU += u;
        sumV += v;
        sumM += m;
        wx += m * ((c + 0.5) / cols);
        wy += m * ((r + 0.5) / rows);
        if (m > floor) dense++;
      }
    }
    // Divergence and curl with central differences (one-sided at the edges).
    let div = 0;
    let curl = 0;
    const at = (r: number, c: number, k: 0 | 1): number => {
      const rr = Math.min(rows - 1, Math.max(0, r));
      const cc = Math.min(cols - 1, Math.max(0, c));
      return field[(f * cells + rr * cols + cc) * 2 + k] ?? 0;
    };
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const hx = (Math.min(cols - 1, c + 1) - Math.max(0, c - 1)) / cols;
        const hy = (Math.min(rows - 1, r + 1) - Math.max(0, r - 1)) / rows;
        const dudx = (at(r, c + 1, 0) - at(r, c - 1, 0)) / hx;
        const dvdy = (at(r + 1, c, 1) - at(r - 1, c, 1)) / hy;
        const dvdx = (at(r, c + 1, 1) - at(r, c - 1, 1)) / hx;
        const dudy = (at(r + 1, c, 0) - at(r - 1, c, 0)) / hy;
        div += dudx + dvdy;
        curl += dvdx - dudy;
      }
    }
    const cx = sumM > 0 ? wx / sumM : 0.5;
    const cy = sumM > 0 ? wy / sumM : 0.5;
    let spreadAcc = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const m = mags[r * cols + c] ?? 0;
        const dx = (c + 0.5) / cols - cx;
        const dy = (r + 0.5) / rows - cy;
        spreadAcc += m * (dx * dx + dy * dy);
      }
    }
    const fx = sumU / cells;
    const fy = sumV / cells;
    features.energy[f] = sumM / cells;
    features.peak[f] = percentile(mags, 95);
    features.flowX[f] = fx;
    features.flowY[f] = fy;
    features.direction[f] = Math.atan2(-fy, fx);
    features.coherence[f] = Math.hypot(sumU, sumV) / (sumM + 1e-6);
    features.divergence[f] = div / cells;
    features.curl[f] = curl / cells;
    features.density[f] = dense / cells;
    features.centroidX[f] = cx;
    features.centroidY[f] = cy;
    features.spread[f] = sumM > 0 ? Math.sqrt(spreadAcc / sumM) : 0;
  }
  // Temporal features.
  for (let f = 0; f < frameCount; f++) {
    if (f === 0) continue;
    const ax = (features.flowX[f] ?? 0) - (features.flowX[f - 1] ?? 0);
    const ay = (features.flowY[f] ?? 0) - (features.flowY[f - 1] ?? 0);
    features.acceleration[f] = Math.hypot(ax, ay) * fps;
    features.surge[f] = ((features.energy[f] ?? 0) - (features.energy[f - 1] ?? 0)) * fps;
    features.jerk[f] =
      Math.abs((features.acceleration[f] ?? 0) - (features.acceleration[f - 1] ?? 0)) * fps;
  }
  const jerkP95 = percentile(features.jerk, 95);
  for (let f = 0; f < frameCount; f++) {
    features.continuity[f] = jerkP95 > 0 ? 1 / (1 + (features.jerk[f] ?? 0) / jerkP95) : 1;
  }
  // Onsets: surge above 2.5σ with energy above the floor, 100 ms refractory.
  const surge = features.surge;
  let mu = 0;
  for (const s of surge) mu += s;
  mu /= Math.max(1, surge.length);
  let varAcc = 0;
  for (const s of surge) varAcc += (s - mu) * (s - mu);
  const sigma = Math.sqrt(varAcc / Math.max(1, surge.length));
  const onsets: number[] = [];
  let last = -Infinity;
  for (let f = 0; f < frameCount; f++) {
    if (
      (surge[f] ?? 0) > 2.5 * sigma &&
      (features.energy[f] ?? 0) > floor &&
      f / fps - last >= 0.1
    ) {
      onsets.push(f);
      last = f / fps;
    }
  }
  const normLo = {} as Record<FeatureName, number>;
  const normHi = {} as Record<FeatureName, number>;
  for (const name of FEATURE_NAMES) {
    const values = features[name];
    if (SIGNED_FEATURES.has(name)) {
      normLo[name] = 0;
      normHi[name] = percentile(values.map(Math.abs), 95);
    } else {
      normLo[name] = percentile(values, 5);
      normHi[name] = percentile(values, 95);
    }
  }
  return { fps, frameCount, cols, rows, field, features, onsets, normLo, normHi };
}

/** Tail and rest values for features when there is no movement. */
function restValue(name: FeatureName, last: number): number {
  if (name === 'continuity') return 1;
  if (name === 'centroidX' || name === 'centroidY' || name === 'direction') return last;
  return 0;
}

/**
 * A SignatureSampler over an analytic movement. Supports speed, loops (loop and
 * pingpong), tail and strength; `smoothing` is accepted but ignored (the analytic
 * field is already smooth).
 */
export function createSyntheticSampler(
  kind: SyntheticKind = 'wink',
  options: { fps?: number; cols?: number; rows?: number } = {},
): SignatureSampler {
  const data = build(kind, options.fps ?? 30, options.cols ?? 32, options.rows ?? 18);
  const cells = data.cols * data.rows;
  const signatureDuration = data.frameCount / data.fps;
  let config: SamplerConfig = { ...DEFAULT_SAMPLER_CONFIG };
  const frame: SignatureFrame = {
    t: 0,
    cols: data.cols,
    rows: data.rows,
    field: new Float32Array(cells * 2),
    features: {} as Record<FeatureName, number>,
    normalized: {} as Record<FeatureName, number>,
    inTail: false,
  };
  for (const name of FEATURE_NAMES) {
    frame.features[name] = 0;
    frame.normalized[name] = 0;
  }

  const passDuration = (): number => signatureDuration / Math.max(0.25, config.speed);
  const movementDuration = (): number => passDuration() * Math.max(1, config.loops);

  /** Signature time (seconds at speed 1) and whether this pass plays reversed. */
  const locate = (t: number): { s: number; reversed: boolean } => {
    const pass = passDuration();
    const index = Math.min(Math.floor(t / pass), Math.max(1, config.loops) - 1);
    const local = (t - index * pass) * Math.max(0.25, config.speed);
    const reversed = config.loopMode === 'pingpong' && index % 2 === 1;
    const s = Math.min(signatureDuration, Math.max(0, local));
    return { s: reversed ? signatureDuration - s : s, reversed };
  };

  const normalize = (name: FeatureName, value: number): number => {
    const lo = data.normLo[name];
    const hi = data.normHi[name];
    if (SIGNED_FEATURES.has(name)) return hi > 0 ? Math.max(-1, Math.min(1, value / hi)) : 0;
    return hi > lo ? clamp01((value - lo) / (hi - lo)) : 0;
  };

  const sampler: SignatureSampler = {
    get duration() {
      return movementDuration() + Math.max(0, config.tailSec);
    },
    signatureDuration,
    get config() {
      return config;
    },
    configure(opts) {
      config = { ...config, ...opts };
    },
    sample(t) {
      frame.t = t;
      const strength = config.strength;
      if (t >= movementDuration() || t < 0) {
        frame.inTail = t >= movementDuration();
        frame.field.fill(0);
        const lastIndex = data.frameCount - 1;
        for (const name of FEATURE_NAMES) {
          const value = restValue(name, data.features[name][lastIndex] ?? 0);
          frame.features[name] = value;
          frame.normalized[name] = normalize(name, value);
        }
        return frame;
      }
      frame.inTail = false;
      const { s, reversed } = locate(t);
      const pos = Math.min(data.frameCount - 1, s * data.fps);
      const i0 = Math.floor(pos);
      const i1 = Math.min(data.frameCount - 1, i0 + 1);
      const k = pos - i0;
      const sign = reversed ? -1 : 1;
      const base0 = i0 * cells * 2;
      const base1 = i1 * cells * 2;
      for (let j = 0; j < cells * 2; j++) {
        const a = data.field[base0 + j] ?? 0;
        const b = data.field[base1 + j] ?? 0;
        frame.field[j] = (a + (b - a) * k) * sign * strength;
      }
      for (const name of FEATURE_NAMES) {
        const a = data.features[name][i0] ?? 0;
        const b = data.features[name][i1] ?? 0;
        let value = a + (b - a) * k;
        if (reversed && (SIGNED_FEATURES.has(name) || name === 'surge')) value = -value;
        if (reversed && name === 'direction') value = value > 0 ? value - Math.PI : value + Math.PI;
        if (VELOCITY_FEATURES.has(name)) value *= strength;
        frame.features[name] = value;
        frame.normalized[name] = normalize(name, value);
      }
      return frame;
    },
    onsetsBetween(t0, t1) {
      const result: number[] = [];
      const pass = passDuration();
      const loops = Math.max(1, config.loops);
      for (let index = 0; index < loops; index++) {
        const reversed = config.loopMode === 'pingpong' && index % 2 === 1;
        for (const onset of data.onsets) {
          const s = onset / data.fps;
          const local = (reversed ? signatureDuration - s : s) / Math.max(0.25, config.speed);
          const t = index * pass + local;
          if (t >= t0 && t < t1 && t < movementDuration()) result.push(t);
        }
      }
      return result.sort((a, b) => a - b);
    },
  };
  return sampler;
}
