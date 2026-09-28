/**
 * Pure maths for sparklines (tested in tests/unit/sparkline-math.test.ts).
 *
 * A per-frame series of n values is laid across a width the way the sampler plays it:
 * frame i sits at x = i / n of the width (signature time i / fps on a timeline n / fps
 * long), and the last frame is held to the right edge.
 */

export interface ValueRange {
  min: number;
  max: number;
}

const TINY = 1e-12;

/** 0 at the bottom, the largest value at the top (never a zero-height range). */
export function unsignedRange(values: ArrayLike<number>): ValueRange {
  let max = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Number.isFinite(v) && v > max) max = v;
  }
  return { min: 0, max: Math.max(max, TINY) };
}

/** Symmetric around 0, so 0 sits on the middle line. */
export function signedRange(values: ArrayLike<number>): ValueRange {
  let extent = 0;
  for (let i = 0; i < values.length; i++) {
    const v = Math.abs(values[i]);
    if (Number.isFinite(v) && v > extent) extent = v;
  }
  const a = Math.max(extent, TINY);
  return { min: -a, max: a };
}

/** y for a value: `height` at the range's minimum, 0 at its maximum (SVG y points down). */
export function yFor(value: number, range: ValueRange, height: number): number {
  const span = range.max - range.min;
  const f = span > 0 && Number.isFinite(value) ? (value - range.min) / span : 0;
  return height * (1 - (f < 0 ? 0 : f > 1 ? 1 : f));
}

/** Points of a series across width × height (see the file comment for the x layout). */
export function seriesPoints(
  values: ArrayLike<number>,
  width: number,
  height: number,
  range: ValueRange,
): Array<[number, number]> {
  const n = values.length;
  const points: Array<[number, number]> = [];
  if (n === 0) return points;
  for (let i = 0; i < n; i++) points.push([(i / n) * width, yFor(values[i], range, height)]);
  points.push([width, yFor(values[n - 1], range, height)]);
  return points;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** An SVG path through the points. */
export function linePath(points: ReadonlyArray<readonly [number, number]>): string {
  return points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${round2(x)} ${round2(y)}`).join(' ');
}

/** A closed SVG path between the points and a horizontal baseline at `baselineY`. */
export function areaPath(
  points: ReadonlyArray<readonly [number, number]>,
  baselineY: number,
): string {
  if (points.length === 0) return '';
  const first = points[0];
  const last = points[points.length - 1];
  return `${linePath(points)} L${round2(last[0])} ${round2(baselineY)} L${round2(first[0])} ${round2(baselineY)} Z`;
}

export interface DirectionBucket {
  /** Screen angle of the mean flow in radians (x right, y down): 0 = right, π/2 = down. */
  angle: number;
  /** 0..1: this bucket's mean flow relative to the strongest bucket. */
  strength: number;
}

/**
 * Split a flow series into `count` equal stretches of time and give each one's average
 * direction. Averaging the flow vectors (not the angles) means a stretch that moves back
 * and forth, or not at all, comes out weak instead of pointing somewhere arbitrary.
 */
export function directionBuckets(
  flowX: ArrayLike<number>,
  flowY: ArrayLike<number>,
  count: number,
): DirectionBucket[] {
  const n = Math.min(flowX.length, flowY.length);
  if (n === 0 || !(count >= 1)) return [];
  const k = Math.min(Math.floor(count), n);
  const raw: Array<{ angle: number; magnitude: number }> = [];
  let strongest = 0;
  for (let b = 0; b < k; b++) {
    const i0 = Math.floor((b * n) / k);
    const i1 = Math.max(i0 + 1, Math.floor(((b + 1) * n) / k));
    let sx = 0;
    let sy = 0;
    for (let i = i0; i < i1; i++) {
      sx += Number.isFinite(flowX[i]) ? flowX[i] : 0;
      sy += Number.isFinite(flowY[i]) ? flowY[i] : 0;
    }
    const mx = sx / (i1 - i0);
    const my = sy / (i1 - i0);
    const magnitude = Math.hypot(mx, my);
    if (magnitude > strongest) strongest = magnitude;
    raw.push({ angle: Math.atan2(my, mx), magnitude });
  }
  return raw.map(({ angle, magnitude }) => ({
    angle,
    strength: strongest > TINY ? magnitude / strongest : 0,
  }));
}
