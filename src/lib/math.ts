/** Small pure math helpers shared by signature, engine, and material code. */

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Inverse of lerp: where x sits between a and b (unclamped). Returns 0 when a == b. */
export function invLerp(a: number, b: number, x: number): number {
  return a === b ? 0 : (x - a) / (b - a);
}

/**
 * Hermite smoothstep. When edge0 == edge1 it behaves as a step at the edge
 * (0 at or below, 1 above), which keeps a zero noise floor well defined.
 */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 === edge0) return x > edge0 ? 1 : 0;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Map x from [inLo, inHi] to [outLo, outHi], clamped to the output range. */
export function mapRange(
  x: number,
  inLo: number,
  inHi: number,
  outLo: number,
  outHi: number,
): number {
  return lerp(outLo, outHi, clamp01(invLerp(inLo, inHi, x)));
}

export function mean(values: ArrayLike<number>): number {
  const n = values.length;
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += values[i];
  return sum / n;
}

/** Population standard deviation. */
export function std(values: ArrayLike<number>): number {
  const n = values.length;
  if (n === 0) return 0;
  const m = mean(values);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const d = values[i] - m;
    acc += d * d;
  }
  return Math.sqrt(acc / n);
}

/**
 * Percentile with linear interpolation between closest ranks (same as NumPy's default).
 * `p` is 0..100. Does not modify the input. Returns 0 for empty input.
 */
export function percentile(values: ArrayLike<number>, p: number): number {
  const n = values.length;
  if (n === 0) return 0;
  const sorted = Float64Array.from(values).sort();
  return percentileOfSorted(sorted, p);
}

/** Percentile of data that is already sorted ascending (see `percentile`). */
export function percentileOfSorted(sorted: ArrayLike<number>, p: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  if (n === 1) return sorted[0];
  const rank = (clamp(p, 0, 100) / 100) * (n - 1);
  const lo = Math.floor(rank);
  const hi = Math.min(lo + 1, n - 1);
  const frac = rank - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
}

/** Wrap an angle to (−π, π]. */
export function wrapAngle(a: number): number {
  const twoPi = Math.PI * 2;
  let x = a % twoPi;
  if (x <= -Math.PI) x += twoPi;
  else if (x > Math.PI) x -= twoPi;
  return x;
}

/** Decibels to linear gain. */
export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/** Linear gain to decibels (−Infinity for 0). */
export function gainToDb(gain: number): number {
  return 20 * Math.log10(gain);
}
