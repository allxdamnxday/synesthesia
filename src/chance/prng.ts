/**
 * Seeded randomness (SPEC 12.1). Everything downstream of a seed is deterministic:
 * the same seed gives the same sequence on every machine.
 *
 * - `createRng(seed)`: sfc32 (Chris Doty-Humphrey's Small Fast Counting generator),
 *   seeded through SplitMix32. Returns floats in [0, 1).
 * - `hash32(...ints)`: MurmurHash3-style mixer for deriving seeds, e.g. a track's seed
 *   in an album is `toDisplaySeed(hash32(masterSeed, index))`.
 *
 * Only integer arithmetic (Math.imul, shifts) is used, so results are bit-identical
 * across JavaScript engines.
 */

export type Rng = () => number;

/** Seeds shown to people are 6-digit numbers: 0–999999. */
export const SEED_SPACE = 1_000_000;

function splitmix32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

/** A seeded generator of floats in [0, 1). */
export function createRng(seed: number): Rng {
  const init = splitmix32(seed);
  let a = init();
  let b = init();
  let c = init();
  let d = init();
  const next = (): number => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  // Discard the first outputs so similar seeds diverge immediately.
  for (let i = 0; i < 12; i++) next();
  return next;
}

/**
 * Mix integers into one well-distributed unsigned 32-bit value. Inputs are truncated to
 * integers and reduced modulo 2^32.
 */
export function hash32(...values: number[]): number {
  let h = 0x9747b28c ^ values.length;
  for (const value of values) {
    let k = Math.trunc(value) >>> 0;
    k = Math.imul(k, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, 0x1b873593);
    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xe6546b64) | 0;
  }
  h ^= values.length * 4;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Hash a string (e.g. a material id) to an unsigned 32-bit value. */
export function hashString32(text: string): number {
  const codes: number[] = [];
  for (let i = 0; i < text.length; i++) codes.push(text.charCodeAt(i));
  return hash32(...codes);
}

/** Reduce any 32-bit value to a 6-digit display seed (0–999999). */
export function toDisplaySeed(value: number): number {
  return (value >>> 0) % SEED_SPACE;
}

/** Integer in [0, maxExclusive). */
export function randomInt(rng: Rng, maxExclusive: number): number {
  return Math.floor(rng() * maxExclusive);
}

/** Float in [lo, hi). */
export function randomRange(rng: Rng, lo: number, hi: number): number {
  return lo + (hi - lo) * rng();
}

/** Standard normal sample (Box–Muller). */
export function randomNormal(rng: Rng): number {
  const u = 1 - rng(); // (0, 1]
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Fisher–Yates shuffle, in place. Returns the same array. */
export function shuffleInPlace<T>(rng: Rng, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(rng, i + 1);
    const tmp = items[i];
    items[i] = items[j];
    items[j] = tmp;
  }
  return items;
}

/** Pick `count` distinct items (order is the draw order). */
export function sampleWithoutReplacement<T>(rng: Rng, items: readonly T[], count: number): T[] {
  const pool = items.slice();
  shuffleInPlace(rng, pool);
  return pool.slice(0, Math.max(0, Math.min(count, pool.length)));
}
