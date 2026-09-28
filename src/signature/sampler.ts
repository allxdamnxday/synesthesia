/**
 * The signature sampler (SPEC 8.4): plays one KineticSignature along the composition
 * timeline for materials. Materials only ever see `SignatureFrame`s from here (or from
 * the synthetic sampler, which shares these semantics).
 *
 * Timing
 * - Frame i sits at signature time i / frameRate. One pass lasts frameCount / frameRate
 *   seconds at speed 1, so the last frame is held for the final 1 / frameRate of a pass.
 * - A composition plays `loops` passes (fractional loop counts cut the last pass short),
 *   then `tailSec` seconds of tail. In `pingpong` mode odd passes play time backwards:
 *   the field and the signed velocity features (flowX, flowY, divergence, curl, surge)
 *   are negated and direction is rotated by π. Unsigned features are unchanged.
 * - In the tail the field is zero and features rest: continuity 1; centroidX, centroidY
 *   and direction hold the value of the last frame played; everything else 0. Times
 *   before 0 rest the same way (holding the first frame) with `inTail: false`.
 *
 * Values
 * - Field and features are interpolated linearly between frames. Direction is an angle,
 *   so it is interpolated (and smoothed) along the shorter arc instead.
 * - Strength multiplies the field and VELOCITY_FEATURES.
 * - Smoothing (0–1) is a zero-phase centred moving average over frames with half-window
 *   round(smoothing × 0.25 × frameRate) (so at most about half a second in all), applied
 *   to the field and every feature. Edges repeat the first and last frame. Smoothed
 *   copies are precomputed per half-window and kept in a small cache, so `sample()` stays
 *   pure, random-access and cheap.
 * - Normalized features (SPEC 8.2): unsigned features map (x − p05) / (p95 − p05) from
 *   the signature's stats, clamped to 0..1; signed features divide by p95(|x|) of the raw
 *   feature, clamped to −1..1. A zero range normalizes to 0. Normalization applies to the
 *   final value (after strength), so a strong signature saturates sooner.
 *
 * `sample()` never allocates: it returns the same frame object (and the same arrays) on
 * every call. The frame is valid until the next call; copy what you keep.
 */
import { clamp01, percentile } from '../lib/math';
import { decodeField } from './fieldCodec';
import {
  DEFAULT_SAMPLER_CONFIG,
  FEATURE_NAMES,
  SIGNED_FEATURES,
  VELOCITY_FEATURES,
  type FeatureName,
  type KineticSignature,
  type SamplerConfig,
  type SignatureFrame,
  type SignatureSampler,
} from './types';

/** Slowest playback rate (matches GLOBAL_CONTROLS.speed.min and timelineDuration()). */
const MIN_SPEED = 0.25;
/** Half of the longest smoothing window, in seconds (smoothing = 1). */
export const SMOOTHING_HALF_WINDOW_SEC = 0.25;
/**
 * Smoothed copies kept besides the raw data (one per distinct half-window): up to 3, and
 * fewer for very large fields so the cache stays within about 64 MB.
 */
const SMOOTHING_CACHE_MAX = 3;
const SMOOTHING_CACHE_BYTES = 64 * 1024 * 1024;
/** Ranges at or below this normalize to 0. */
const RANGE_EPSILON = 1e-12;

const PI = Math.PI;
const TWO_PI = 2 * Math.PI;
const FEATURE_COUNT = FEATURE_NAMES.length;
const DIRECTION = FEATURE_NAMES.indexOf('direction');
const CONTINUITY = FEATURE_NAMES.indexOf('continuity');
const CENTROID_X = FEATURE_NAMES.indexOf('centroidX');
const CENTROID_Y = FEATURE_NAMES.indexOf('centroidY');
const IS_SIGNED: readonly boolean[] = FEATURE_NAMES.map((n) => SIGNED_FEATURES.has(n));
const IS_VELOCITY: readonly boolean[] = FEATURE_NAMES.map((n) => VELOCITY_FEATURES.has(n));
/** Features that hold their last value in the tail (the rest are 0, continuity 1). */
const IS_HELD: readonly boolean[] = FEATURE_NAMES.map(
  (_, q) => q === DIRECTION || q === CENTROID_X || q === CENTROID_Y,
);

/** Smoothing half-window in frames for a smoothing amount (0–1) at a frame rate. */
export function smoothingHalfWindow(smoothing: number, frameRate: number): number {
  const s = Number.isFinite(smoothing) ? clamp01(smoothing) : 0;
  const fps = Number.isFinite(frameRate) && frameRate > 0 ? frameRate : 0;
  return Math.max(0, Math.round(s * SMOOTHING_HALF_WINDOW_SEC * fps));
}

function clampIndex(i: number, n: number): number {
  return i < 0 ? 0 : i >= n ? n - 1 : i;
}

/**
 * Zero-phase centred moving average along the frame axis. `src` and `out` hold
 * `frameCount × channels` values, frame-major. Each output frame is the mean of the
 * `2 × halfWindow + 1` frames centred on it; frames beyond either end repeat the edge
 * frame. `out` may not alias `src`.
 */
export function smoothFrames(
  src: ArrayLike<number>,
  frameCount: number,
  channels: number,
  halfWindow: number,
  out: Float32Array | Float64Array,
): void {
  const total = frameCount * channels;
  if (halfWindow <= 0 || frameCount <= 1) {
    for (let i = 0; i < total; i++) out[i] = src[i];
    return;
  }
  const width = 2 * halfWindow + 1;
  const acc = new Float64Array(channels);
  for (let k = -halfWindow; k <= halfWindow; k++) {
    const base = clampIndex(k, frameCount) * channels;
    for (let j = 0; j < channels; j++) acc[j] += src[base + j];
  }
  for (let j = 0; j < channels; j++) out[j] = acc[j] / width;
  for (let f = 1; f < frameCount; f++) {
    const addBase = clampIndex(f + halfWindow, frameCount) * channels;
    const subBase = clampIndex(f - halfWindow - 1, frameCount) * channels;
    const outBase = f * channels;
    for (let j = 0; j < channels; j++) {
      acc[j] += src[addBase + j] - src[subBase + j];
      out[outBase + j] = acc[j] / width;
    }
  }
}

/** Circular moving average of angles (radians): the angle of the mean unit vector. */
export function smoothAngles(
  angles: ArrayLike<number>,
  halfWindow: number,
  out: Float64Array,
): void {
  const n = angles.length;
  if (halfWindow <= 0 || n <= 1) {
    for (let i = 0; i < n; i++) out[i] = angles[i];
    return;
  }
  const cos = new Float64Array(n);
  const sin = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    cos[i] = Math.cos(angles[i]);
    sin[i] = Math.sin(angles[i]);
  }
  const cosOut = new Float64Array(n);
  const sinOut = new Float64Array(n);
  smoothFrames(cos, n, 1, halfWindow, cosOut);
  smoothFrames(sin, n, 1, halfWindow, sinOut);
  for (let i = 0; i < n; i++) out[i] = Math.atan2(sinOut[i], cosOut[i]);
}

/**
 * Interpolate between two angles along the shorter arc. Returns `a` exactly at k = 0
 * and stays within [−π, π].
 */
export function lerpAngle(a: number, b: number, k: number): number {
  let d = b - a;
  if (d > PI) d -= TWO_PI;
  else if (d < -PI) d += TWO_PI;
  let v = a + d * k;
  if (v > PI) v -= TWO_PI;
  else if (v < -PI) v += TWO_PI;
  return v;
}

/** The same direction, played backwards: rotated by π, kept within (−π, π]. */
function reverseDirection(v: number): number {
  return v > 0 ? v - PI : v + PI;
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Merge options into a configuration and make it safe: speed ≥ 0.25, loops ≥ 1,
 * tail ≥ 0, smoothing 0–1, strength ≥ 0. Missing or non-finite values keep the previous
 * value (or the default).
 */
export function resolveSamplerConfig(
  base: Readonly<SamplerConfig>,
  opts: Partial<SamplerConfig> = {},
): SamplerConfig {
  const num = (key: 'speed' | 'loops' | 'tailSec' | 'smoothing' | 'strength'): number =>
    finiteOr(opts[key], finiteOr(base[key], DEFAULT_SAMPLER_CONFIG[key]));
  const loopMode = opts.loopMode ?? base.loopMode;
  return {
    speed: Math.max(MIN_SPEED, num('speed')),
    loops: Math.max(1, num('loops')),
    tailSec: Math.max(0, num('tailSec')),
    loopMode: loopMode === 'pingpong' ? 'pingpong' : 'loop',
    smoothing: clamp01(num('smoothing')),
    strength: Math.max(0, num('strength')),
  };
}

/** Field and features at one smoothing half-window. */
interface Track {
  field: Float32Array;
  features: Float64Array[];
}

/**
 * Create a sampler for a signature. The field is decoded once here; smoothing is
 * precomputed on demand (per distinct half-window) when `configure()` changes it.
 */
export function createSampler(
  signature: KineticSignature,
  initial: Partial<SamplerConfig> = {},
): SignatureSampler {
  const frameCount = signature.frameCount;
  const fps = signature.frameRate;
  const { cols, rows } = signature.grid;
  const stride = cols * rows * 2;
  if (!Number.isInteger(frameCount) || frameCount < 1) {
    throw new Error(`Signature has ${frameCount} frames; it needs at least one`);
  }
  if (!(fps > 0)) throw new Error(`Signature frame rate ${fps} is not positive`);

  const rawField = decodeField(signature.field.data);
  if (rawField.length !== frameCount * stride) {
    throw new Error(`Field has ${rawField.length} values, expected ${frameCount * stride}`);
  }
  const rawFeatures = FEATURE_NAMES.map((name) => {
    const values = signature.features[name];
    if (values.length !== frameCount) {
      throw new Error(`Feature "${name}" has ${values.length} values, expected ${frameCount}`);
    }
    return Float64Array.from(values);
  });
  const raw: Track = { field: rawField, features: rawFeatures };
  const onsets = signature.features.onsets.slice().sort((a, b) => a - b);
  const signatureDuration = frameCount / fps;

  // Normalization bounds, from the raw (unsmoothed, unscaled) signature.
  const normLo = new Float64Array(FEATURE_COUNT);
  const normHi = new Float64Array(FEATURE_COUNT);
  FEATURE_NAMES.forEach((name, q) => {
    const values = rawFeatures[q];
    if (IS_SIGNED[q]) {
      normLo[q] = 0;
      normHi[q] = percentile(values.map(Math.abs), 95);
    } else {
      const stats = signature.stats[name];
      normLo[q] = stats && Number.isFinite(stats.p05) ? stats.p05 : percentile(values, 5);
      normHi[q] = stats && Number.isFinite(stats.p95) ? stats.p95 : percentile(values, 95);
    }
  });
  const normalize = (q: number, v: number): number => {
    if (IS_SIGNED[q]) {
      const hi = normHi[q];
      if (!(hi > RANGE_EPSILON)) return 0;
      const x = v / hi;
      return x < -1 ? -1 : x > 1 ? 1 : x;
    }
    const lo = normLo[q];
    const range = normHi[q] - lo;
    if (!(range > RANGE_EPSILON)) return 0;
    const x = (v - lo) / range;
    return x < 0 ? 0 : x > 1 ? 1 : x;
  };

  // Smoothed tracks, least recently used first.
  const cache = new Map<number, Track>();
  const cacheSize = Math.max(
    1,
    Math.min(SMOOTHING_CACHE_MAX, Math.floor(SMOOTHING_CACHE_BYTES / (rawField.byteLength || 1))),
  );
  const trackFor = (halfWindow: number): Track => {
    if (halfWindow <= 0 || frameCount <= 1) return raw;
    const hit = cache.get(halfWindow);
    if (hit) {
      cache.delete(halfWindow);
      cache.set(halfWindow, hit);
      return hit;
    }
    const field = new Float32Array(rawField.length);
    smoothFrames(rawField, frameCount, stride, halfWindow, field);
    const features = rawFeatures.map((values, q) => {
      const out = new Float64Array(frameCount);
      if (q === DIRECTION) smoothAngles(values, halfWindow, out);
      else smoothFrames(values, frameCount, 1, halfWindow, out);
      return out;
    });
    const track: Track = { field, features };
    cache.set(halfWindow, track);
    while (cache.size > cacheSize) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
    return track;
  };

  const frame: SignatureFrame = {
    t: 0,
    cols,
    rows,
    field: new Float32Array(stride),
    features: {} as Record<FeatureName, number>,
    normalized: {} as Record<FeatureName, number>,
    inTail: false,
  };
  for (const name of FEATURE_NAMES) {
    frame.features[name] = 0;
    frame.normalized[name] = 0;
  }

  // Derived state, recomputed by configure().
  let config: SamplerConfig = resolveSamplerConfig(DEFAULT_SAMPLER_CONFIG, initial);
  let speed = 1;
  let strength = 1;
  let pingpong = false;
  let pass = signatureDuration;
  let movement = signatureDuration;
  let lastPass = 0;
  let track = raw;
  const restTail = new Float64Array(FEATURE_COUNT);
  const restTailNorm = new Float64Array(FEATURE_COUNT);
  const restBefore = new Float64Array(FEATURE_COUNT);
  const restBeforeNorm = new Float64Array(FEATURE_COUNT);

  /** Interpolated (smoothed, unscaled) feature q at a fractional frame position. */
  const featureAt = (q: number, pos: number): number => {
    const values = track.features[q];
    const i0 = Math.floor(pos);
    const i1 = i0 + 1 < frameCount ? i0 + 1 : i0;
    const k = pos - i0;
    if (q === DIRECTION) return lerpAngle(values[i0], values[i1], k);
    return values[i0] + (values[i1] - values[i0]) * k;
  };

  const fillRest = (
    values: Float64Array,
    norm: Float64Array,
    pos: number,
    reversed: boolean,
  ): void => {
    for (let q = 0; q < FEATURE_COUNT; q++) {
      let v = 0;
      if (q === CONTINUITY) v = 1;
      else if (IS_HELD[q]) {
        v = featureAt(q, pos);
        if (reversed && q === DIRECTION) v = reverseDirection(v);
      }
      values[q] = v;
      norm[q] = normalize(q, v);
    }
  };

  const apply = (next: SamplerConfig): void => {
    config = next;
    speed = next.speed;
    strength = next.strength;
    pingpong = next.loopMode === 'pingpong';
    pass = signatureDuration / speed;
    movement = pass * next.loops;
    lastPass = Math.max(0, Math.ceil(next.loops) - 1);
    track = trackFor(smoothingHalfWindow(next.smoothing, fps));
    // The last frame played: where the final (possibly partial) pass ends.
    const endLocal = Math.min(signatureDuration, Math.max(0, (movement - lastPass * pass) * speed));
    const endReversed = pingpong && lastPass % 2 === 1;
    const endS = endReversed ? signatureDuration - endLocal : endLocal;
    fillRest(
      restTail,
      restTailNorm,
      Math.min(frameCount - 1, Math.max(0, endS * fps)),
      endReversed,
    );
    fillRest(restBefore, restBeforeNorm, 0, false);
  };
  apply(config);

  const writeRest = (inTail: boolean): SignatureFrame => {
    frame.inTail = inTail;
    frame.field.fill(0);
    const values = inTail ? restTail : restBefore;
    const norm = inTail ? restTailNorm : restBeforeNorm;
    for (let q = 0; q < FEATURE_COUNT; q++) {
      const name = FEATURE_NAMES[q];
      frame.features[name] = values[q];
      frame.normalized[name] = norm[q];
    }
    return frame;
  };

  const sampler: SignatureSampler = {
    get duration() {
      return movement + config.tailSec;
    },
    signatureDuration,
    get config() {
      return config;
    },
    configure(opts) {
      apply(resolveSamplerConfig(config, opts));
    },
    sample(t) {
      frame.t = t;
      if (!(t >= 0)) return writeRest(false);
      if (t >= movement) return writeRest(true);
      frame.inTail = false;

      let index = Math.floor(t / pass);
      if (index > lastPass) index = lastPass;
      let local = (t - index * pass) * speed;
      if (local < 0) local = 0;
      else if (local > signatureDuration) local = signatureDuration;
      const reversed = pingpong && index % 2 === 1;
      let pos = (reversed ? signatureDuration - local : local) * fps;
      if (pos > frameCount - 1) pos = frameCount - 1;
      else if (pos < 0) pos = 0;
      const i0 = Math.floor(pos);
      const i1 = i0 + 1 < frameCount ? i0 + 1 : i0;
      const k = pos - i0;

      const src = track.field;
      const out = frame.field;
      const base0 = i0 * stride;
      const base1 = i1 * stride;
      const gain = reversed ? -strength : strength;
      for (let j = 0; j < stride; j++) {
        const a = src[base0 + j];
        out[j] = (a + (src[base1 + j] - a) * k) * gain;
      }

      for (let q = 0; q < FEATURE_COUNT; q++) {
        const values = track.features[q];
        const a = values[i0];
        const b = values[i1];
        let v: number;
        if (q === DIRECTION) {
          v = lerpAngle(a, b, k);
          if (reversed) v = reverseDirection(v);
        } else {
          v = a + (b - a) * k;
          if (reversed && IS_SIGNED[q]) v = -v;
          if (IS_VELOCITY[q]) v *= strength;
        }
        const name = FEATURE_NAMES[q];
        frame.features[name] = v;
        frame.normalized[name] = normalize(q, v);
      }
      return frame;
    },
    onsetsBetween(t0, t1) {
      const result: number[] = [];
      if (!(t1 > t0)) return result;
      for (let index = 0; index <= lastPass; index++) {
        const reversed = pingpong && index % 2 === 1;
        for (const onset of onsets) {
          const s = onset / fps;
          const t = index * pass + (reversed ? signatureDuration - s : s) / speed;
          if (t >= t0 && t < t1 && t < movement) result.push(t);
        }
      }
      return result.sort((a, b) => a - b);
    },
  };
  return sampler;
}
