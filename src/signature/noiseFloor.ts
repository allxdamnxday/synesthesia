/**
 * Noise floor and soft threshold (SPEC 8.1 step 8).
 *
 * Auto floor: take the quietest 10% of frames (by energy, the mean cell magnitude), pool
 * all their cell magnitudes, and take the 60th percentile × 1.5, never below
 * MIN_NOISE_FLOOR. Cells then pass through a soft threshold:
 * `v × smoothstep(floor, 2·floor, |v|)`: below the floor a cell is still, above twice
 * the floor it is untouched, and in between it fades in smoothly.
 */
import { percentile, smoothstep } from '../lib/math';
import { MIN_NOISE_FLOOR } from './types';

/** Mean cell magnitude of each frame. `field` is frameCount × cells × 2. */
export function frameEnergies(
  field: Float32Array,
  frameCount: number,
  cells: number,
): Float64Array {
  const energies = new Float64Array(frameCount);
  for (let f = 0; f < frameCount; f++) {
    let sum = 0;
    const base = f * cells * 2;
    for (let c = 0; c < cells; c++) sum += Math.hypot(field[base + 2 * c], field[base + 2 * c + 1]);
    energies[f] = cells > 0 ? sum / cells : 0;
  }
  return energies;
}

/** Indices of the quietest `fraction` of frames (at least one), quietest first. */
export function quietestFrames(energies: ArrayLike<number>, fraction: number): number[] {
  const n = energies.length;
  if (n === 0) return [];
  const count = Math.min(n, Math.max(1, Math.ceil(n * fraction)));
  const order = Array.from({ length: n }, (_, i) => i);
  // Ties break on frame index so the choice never depends on sort internals.
  order.sort((a, b) => energies[a] - energies[b] || a - b);
  return order.slice(0, count);
}

export const AUTO_FLOOR_QUIET_FRACTION = 0.1;
export const AUTO_FLOOR_PERCENTILE = 60;
export const AUTO_FLOOR_FACTOR = 1.5;

/** SPEC 8.1 step 8's automatic noise floor, in field diagonals per second. */
export function autoNoiseFloor(field: Float32Array, frameCount: number, cells: number): number {
  if (frameCount === 0 || cells === 0) return MIN_NOISE_FLOOR;
  const quiet = quietestFrames(frameEnergies(field, frameCount, cells), AUTO_FLOOR_QUIET_FRACTION);
  const magnitudes = new Float64Array(quiet.length * cells);
  let k = 0;
  for (const f of quiet) {
    const base = f * cells * 2;
    for (let c = 0; c < cells; c++) {
      magnitudes[k++] = Math.hypot(field[base + 2 * c], field[base + 2 * c + 1]);
    }
  }
  const floor = percentile(magnitudes, AUTO_FLOOR_PERCENTILE) * AUTO_FLOOR_FACTOR;
  return Number.isFinite(floor) ? Math.max(MIN_NOISE_FLOOR, floor) : MIN_NOISE_FLOOR;
}

/** The floor to use: automatic, or the manual value (made finite and non-negative). */
export function resolveNoiseFloor(
  field: Float32Array,
  frameCount: number,
  cells: number,
  mode: 'auto' | 'manual',
  manual: number,
): number {
  if (mode === 'manual') return Number.isFinite(manual) ? Math.max(0, manual) : MIN_NOISE_FLOOR;
  return autoNoiseFloor(field, frameCount, cells);
}

/** Apply `v × smoothstep(floor, 2·floor, |v|)` to every cell, in place. */
export function applySoftThreshold(field: Float32Array, floor: number): Float32Array {
  for (let i = 0; i < field.length; i += 2) {
    const u = field[i];
    const v = field[i + 1];
    const k = smoothstep(floor, 2 * floor, Math.hypot(u, v));
    field[i] = u * k;
    field[i + 1] = v * k;
  }
  return field;
}
