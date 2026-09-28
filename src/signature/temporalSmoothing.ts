/**
 * Extraction smoothing (SPEC 8.1 step 9): a centered moving average over time.
 *
 * Frame i averages frames i − k … i + k (k = half the window). Near the ends of the clip
 * the window shrinks to the frames that exist, so the first and last frames are smoothed
 * too. (Keeping the window symmetric instead would leave the end frames raw, and a
 * noisy first or last frame, common right after a keyframe, would stand out as a burst
 * of density or a false onset.) Away from the ends the average is centered, so movement
 * is not shifted in time.
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
    const first = Math.max(0, f - half);
    const last = Math.min(frameCount - 1, f + half);
    acc.fill(0);
    for (let g = first; g <= last; g++) {
      const base = g * stride;
      for (let j = 0; j < stride; j++) acc[j] += data[base + j];
    }
    const n = last - first + 1;
    const base = f * stride;
    for (let j = 0; j < stride; j++) out[base + j] = acc[j] / n;
  }
  return out;
}
