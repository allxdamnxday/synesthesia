/**
 * A material's own, longer dip after a jump of the timeline (a seek, or the engine's resync
 * of a starved scheduler), for materials whose filters would ring if their controls leapt.
 *
 * The engine fades out before every jump, jumps in silence and stays silent for one control
 * step (so a material's first control point after a jump is never heard; see AudioEngine).
 * It fades back in about 13 ms after the jump. A resonant or narrow filter whose centre leaps
 * to a new place at the jump still rings for a while, and that ringing would be heard as the
 * engine fades in. So after a seek (ContinuityMode 'seek') such a material:
 * - scales its level by `seekDipGain`: silent from its first control point until
 *   SEEK_DIP_SILENT_UNTIL_SEC, then a smooth fade back in;
 * - skips the other control buses' points while `seekGlideHolds` (the first
 *   SEEK_GLIDE_SEC), so they glide from the values held at the jump to the new ones while the
 *   level is silent.
 *
 * Skipped points (`seekGlideHolds` true) are simply not written: the bus then ramps straight
 * from its held value to the next point written. The render never seeks, so it never hears
 * any of this.
 */
import { smoothstep } from '../../../lib/math';

/**
 * No longer needed: the engine's own dip now covers the fade to silence at the jump.
 * Kept (0) for code written against the earlier version.
 */
export const SEEK_DIP_OUT_SEC = 0;
/** The other buses glide to their new values over at least this long, seconds. */
export const SEEK_GLIDE_SEC = 0.02;
/** Silent until this long after the jump (the glides have arrived), seconds. */
export const SEEK_DIP_SILENT_UNTIL_SEC = 0.025;
/** Fade back in, seconds. */
export const SEEK_DIP_IN_SEC = 0.015;

/**
 * Level multiplier for a control point `sinceSeek` seconds after a seek (`null` only for a
 * point before the jump or an invalid time: don't write it). Pure.
 */
export function seekDipGain(sinceSeek: number): number | null {
  if (!(sinceSeek >= 0)) return null;
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
