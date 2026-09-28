/**
 * Notable moments on a composition's timeline, from the signature alone (pure).
 */
import type { TimelineSettings } from '../engine/composition';
import type { KineticSignature } from '../signature/types';

/** A composition's thumbnail shows the wake this long after the strongest movement. */
export const THUMBNAIL_AFTER_PEAK_SEC = 0.25;

/** Index of the frame with the most movement (the first, if several tie). */
export function peakFrame(energy: readonly number[]): number {
  let best = 0;
  for (let i = 1; i < energy.length; i++) {
    if ((energy[i] ?? 0) > (energy[best] ?? 0)) best = i;
  }
  return best;
}

/**
 * Composition time of the signature's peak moment (its strongest movement) in the first
 * pass, which always plays forward.
 */
export function peakMomentTime(
  signature: Pick<KineticSignature, 'features' | 'frameRate'>,
  timeline: Pick<TimelineSettings, 'speed'>,
): number {
  const fps = signature.frameRate > 0 ? signature.frameRate : 30;
  const speed = timeline.speed > 0 ? timeline.speed : 1;
  return peakFrame(signature.features.energy) / fps / speed;
}

/**
 * When a composition's thumbnail is taken: just after the peak moment, so the wake has
 * formed, but never past the end of the timeline.
 */
export function thumbnailTime(
  signature: Pick<KineticSignature, 'features' | 'frameRate'>,
  timeline: Pick<TimelineSettings, 'speed'>,
  duration: number,
): number {
  const t = peakMomentTime(signature, timeline) + THUMBNAIL_AFTER_PEAK_SEC;
  return Math.max(0, Math.min(t, Math.max(0, duration)));
}
