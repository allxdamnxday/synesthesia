/**
 * A material's own dip around a jump of the timeline.
 *
 * The engine fades out and back in around a seek, but it resynchronises a starved scheduler
 * (a busy main thread let the scheduled audio run out) as a seek *without* fading. Until the
 * resync every parameter holds its last scheduled value, so the sound freezes; at the resync
 * it would then leap to where the composition really is. Two leaps click: the level's, and a
 * filter's (a band-pass whose centre and width jump within one render quantum rings).
 *
 * So after a seek (ContinuityMode 'seek') a material:
 * - scales its level by `seekDipGain`: from wherever it froze down to silence (over at least
 *   SEEK_DIP_OUT_SEC), silent while everything else moves, then a smooth fade back in;
 * - skips the other control buses' points while `seekGlideHolds` (the first
 *   SEEK_GLIDE_SEC), so they glide from their frozen values to the new ones, mostly while the
 *   level is silent.
 *
 * Skipped points (`null`, or `seekGlideHolds` true) are simply not written: the bus then ramps
 * straight from its frozen value to the next point, however the jump falls between the 5 ms
 * control points. Under an ordinary seek the engine's own dip covers all of this; the render
 * never seeks, so it never hears it.
 */
import { smoothstep } from '../../../lib/math';

/** Shortest fade from the frozen level to silence, seconds. */
export const SEEK_DIP_OUT_SEC = 0.004;
/** The other buses glide to their new values over at least this long, seconds. */
export const SEEK_GLIDE_SEC = 0.02;
/** Silent until this long after the jump (the glides have arrived), seconds. */
export const SEEK_DIP_SILENT_UNTIL_SEC = 0.025;
/** Fade back in, seconds. */
export const SEEK_DIP_IN_SEC = 0.015;

/**
 * Level multiplier for a control point `sinceSeek` seconds after a seek, or `null` for a point
 * too close to the jump to write. Pure.
 */
export function seekDipGain(sinceSeek: number): number | null {
  if (!(sinceSeek >= SEEK_DIP_OUT_SEC)) return null;
  return smoothstep(
    SEEK_DIP_SILENT_UNTIL_SEC,
    SEEK_DIP_SILENT_UNTIL_SEC + SEEK_DIP_IN_SEC,
    sinceSeek,
  );
}

/** True while the other buses' points after a seek are skipped (they glide instead). Pure. */
export function seekGlideHolds(sinceSeek: number): boolean {
  return !(sinceSeek >= SEEK_GLIDE_SEC);
}
