/**
 * Peak normalization for offline renders (SPEC 9.1: "Offline renders peak-normalize to −1 dBFS
 * by default"). Pure and deterministic: one float64 gain applied to every sample.
 */

/** −1 dBFS as a linear peak. */
export const DEFAULT_NORMALIZE_DB = -1;

/** Largest absolute sample across all channels. */
export function peakOf(channels: readonly ArrayLike<number>[]): number {
  let peak = 0;
  for (const data of channels) {
    for (let i = 0; i < data.length; i++) {
      const a = Math.abs(data[i] ?? 0);
      if (a > peak) peak = a;
    }
  }
  return peak;
}

/**
 * Scale every channel so the peak sits at `targetDb` dBFS. Silence is left untouched.
 * Returns the gain applied (1 for silence).
 */
export function normalizePeakInPlace(
  channels: readonly Float32Array[],
  targetDb = DEFAULT_NORMALIZE_DB,
): number {
  const peak = peakOf(channels);
  if (!(peak > 0)) return 1;
  const target = Math.pow(10, targetDb / 20);
  // Aim a hair low so float32 rounding can never push a sample above the target.
  const gain = (target / peak) * (1 - 1e-7);
  for (const data of channels) {
    for (let i = 0; i < data.length; i++) data[i] = (data[i] ?? 0) * gain;
  }
  return gain;
}

/** Normalize an AudioBuffer in place. Returns the gain applied. */
export function normalizeBufferPeak(buffer: AudioBuffer, targetDb = DEFAULT_NORMALIZE_DB): number {
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
  return normalizePeakInPlace(channels, targetDb);
}
