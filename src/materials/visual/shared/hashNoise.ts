/**
 * Counter-based randomness for particle and strand simulations: a pure integer hash of a
 * few integers → uniform floats. Unlike a sequential PRNG stream, the value for
 * (particle i, event k) never depends on how many other particles exist or on what
 * happened before, so a simulation draws exactly the same random values whatever its
 * state or particle count. Keys come from the seeded PRNG (`src/chance/prng.ts`) at
 * `reset()`, so everything still derives from the composition's seed.
 *
 * Integer arithmetic only (Math.imul, shifts, xor): bit-identical on every JS engine.
 */

/** "lowbias32" (Chris Wellons, public domain): a well-mixed 32-bit integer permutation. */
export function mix32(x: number): number {
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

/** Hash three integers (each taken modulo 2^32) to an unsigned 32-bit value. */
export function hash3(a: number, b: number, c: number): number {
  let h = mix32((a ^ 0x9e3779b9) >>> 0);
  h = mix32(((h ^ b) + 0x7f4a7c15) >>> 0);
  return mix32(((h ^ c) + 0x94d049bb) >>> 0);
}

/** 24 bits of a hash as a float in [0, 1). */
export function unitFromHash(h: number): number {
  return (h >>> 8) / 16777216;
}

/** Uniform float in [0, 1) for (a, b, c). */
export function hashUnit(a: number, b: number, c: number): number {
  return unitFromHash(hash3(a, b, c));
}

/** Uniform float in [−1, 1) for (a, b, c). */
export function hashSigned(a: number, b: number, c: number): number {
  return unitFromHash(hash3(a, b, c)) * 2 - 1;
}

/** Low 16 bits of a hash as a float in [−1, 1). */
export function lowSigned(h: number): number {
  return (h & 0xffff) / 32768 - 1;
}

/** High 16 bits of a hash as a float in [−1, 1). */
export function highSigned(h: number): number {
  return (h >>> 16) / 32768 - 1;
}

/**
 * √3: scales a uniform value in [−1, 1) (variance ⅓) to unit variance, for random walks
 * that should have a given standard deviation.
 */
export const UNIFORM_TO_UNIT_VARIANCE = Math.sqrt(3);

/**
 * Smooth seeded value noise in 2D (0..1), from a lattice hashed with `key`. Used for
 * slowly varying seeded patterns (strand orientations, streams), never for per-step
 * randomness.
 */
export function valueNoise2(key: number, x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hashUnit(key, ix, iy);
  const b = hashUnit(key, ix + 1, iy);
  const c = hashUnit(key, ix, iy + 1);
  const d = hashUnit(key, ix + 1, iy + 1);
  const top = a + (b - a) * sx;
  const bottom = c + (d - c) * sx;
  return top + (bottom - top) * sy;
}
