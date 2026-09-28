/**
 * Extraction smoothing (SPEC 8.1 step 9): a centered moving average over time.
 *
 * The window stays centered and shrinks symmetrically near the ends of the clip: frame i
 * averages frames i − k … i + k with k = min(half window, i, last − i). The first and
 * last frames are therefore left as they are. Staying centered keeps the average
 * zero-phase, so no movement is shifted in time.
 */

/** Allowed windows are 1, 3, 5, 7 and 9 frames; anything else rounds to the nearest. */
export function normalizeWindow(frames: number): number {
  const half = Math.round(Math.min(4, Math.max(0, Number.isFinite(frames) ? (frames - 1) / 2 : 1)));
  return 2 * half + 1;
}

/**
 * Smooth `data` (frameCount blocks of `stride` values each) over time. Returns a new
 * array; the input is left unchanged.
 */
export function smoothOverTime(
  data: Float32Array,
  frameCount: number,
  stride: number,
  window: number,
): Float32Array {
  const out = new Float32Array(frameCount * stride);
  const half = (normalizeWindow(window) - 1) / 2;
  const acc = new Float64Array(stride);
  for (let f = 0; f < frameCount; f++) {
    const k = Math.min(half, f, frameCount - 1 - f);
    acc.fill(0);
    for (let g = f - k; g <= f + k; g++) {
      const base = g * stride;
      for (let j = 0; j < stride; j++) acc[j] += data[base + j];
    }
    const n = 2 * k + 1;
    const base = f * stride;
    for (let j = 0; j < stride; j++) out[base + j] = acc[j] / n;
  }
  return out;
}
