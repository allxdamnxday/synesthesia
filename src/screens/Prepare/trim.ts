/**
 * Trim and playhead maths for the Prepare player (pure; tested in tests/unit/prepare-trim.test.ts).
 *
 * Times are seconds on the clip's own timeline. Frame k of a clip at `fps` spans
 * [k / fps, (k + 1) / fps). Trim handles snap to frame boundaries, so extraction (which
 * samples the middle of each frame interval over the trim) takes whole frames. The
 * playhead shows a frame by its start time and stays between the trim's first frame and
 * its last frame.
 */
import { MAX_CLIP_SECONDS } from '../../signature/types';

export interface Trim {
  startSec: number;
  endSec: number;
}

/** Shortest trim, in frames of the clip (enough for a few frames of movement). */
export const MIN_TRIM_FRAMES = 4;
/** Frame rate assumed when a clip's own rate is unknown. */
export const FALLBACK_FPS = 30;

const EPSILON = 1e-6;

function clampTo(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}

/** The clip's frame rate, or FALLBACK_FPS when it isn't a positive number. */
export function safeFps(fps: number): number {
  return Number.isFinite(fps) && fps > 0 ? fps : FALLBACK_FPS;
}

/** Length of one frame in seconds. */
export function frameDuration(fps: number): number {
  return 1 / safeFps(fps);
}

/** The nearest frame boundary (k / fps). */
export function snapToFrame(t: number, fps: number): number {
  const f = safeFps(fps);
  return Math.round((Number.isFinite(t) ? t : 0) * f) / f;
}

/** The whole clip, or its first minute when it is longer (signatures hold up to a minute). */
export function defaultTrim(durationSec: number, maxSec: number = MAX_CLIP_SECONDS): Trim {
  const d = Number.isFinite(durationSec) ? Math.max(0, durationSec) : 0;
  return { startSec: 0, endSec: Math.min(d, maxSec) };
}

/**
 * Make a proposed trim valid: both ends snapped to frames and inside the clip, and at
 * least MIN_TRIM_FRAMES long. When the handles would cross or crowd, the one being moved
 * gives way (`moving`), so dragging a handle never pushes the other.
 */
export function clampTrim(
  proposed: Trim,
  durationSec: number,
  fps: number,
  moving: 'start' | 'end' | 'both' = 'both',
): Trim {
  const f = safeFps(fps);
  const d = Number.isFinite(durationSec) ? Math.max(0, durationSec) : 0;
  const minLength = Math.min(d, MIN_TRIM_FRAMES / f);
  const snap = (t: number) => clampTo(snapToFrame(t, f), 0, d);
  let start = snap(proposed.startSec);
  let end = snap(proposed.endSec);
  if (end - start < minLength - EPSILON) {
    if (moving === 'start') {
      start = end - minLength;
      if (start < 0) {
        start = 0;
        end = minLength;
      }
    } else {
      end = start + minLength;
      if (end > d) {
        end = d;
        start = Math.max(0, d - minLength);
      }
    }
  }
  return { startSec: start, endSec: end };
}

export function trimLength(trim: Trim): number {
  return Math.max(0, trim.endSec - trim.startSec);
}

/** Longer than extraction accepts (the same tolerance as `startExtraction`). */
export function trimTooLong(trim: Trim, maxSec: number = MAX_CLIP_SECONDS): boolean {
  return trimLength(trim) > maxSec + 1e-3;
}

/** Where the playhead may go: from the trim's first frame to its last frame. */
export function playheadRange(trim: Trim, fps: number): [number, number] {
  const lo = trim.startSec;
  return [lo, Math.max(lo, trim.endSec - frameDuration(fps))];
}

export function clampPlayhead(t: number, trim: Trim, fps: number): number {
  const [lo, hi] = playheadRange(trim, fps);
  return clampTo(Number.isFinite(t) ? t : lo, lo, hi);
}

/** Index of the frame showing at time t. */
export function frameIndexAt(t: number, fps: number): number {
  return Math.floor(t * safeFps(fps) + EPSILON);
}

/** Start time of the frame showing at time t. */
export function frameStartAt(t: number, fps: number): number {
  const f = safeFps(fps);
  return frameIndexAt(t, f) / f;
}

/**
 * The time to give a <video> so it shows the frame that starts at `frameStart`: the middle
 * of the frame, never a boundary where rounding could pick its neighbour.
 */
export function seekTimeFor(frameStart: number, fps: number): number {
  return frameStart + 0.5 * frameDuration(fps);
}

/** The start of the frame `delta` frames from the one at t, kept inside the trim. */
export function stepFrame(t: number, delta: number, trim: Trim, fps: number): number {
  const f = safeFps(fps);
  return clampPlayhead((frameIndexAt(t, f) + Math.round(delta)) / f, trim, f);
}

/**
 * Where in the clip the signature is at signature time `s` (seconds from its start, at
 * speed 1). Field frame i sits at s = i / analysisFps and describes the movement between
 * analysis frames i and i + 1, taken at start + (i + 0.5) / fps and start + (i + 1.5) / fps,
 * so it happens around start + (i + 1) / fps.
 */
export function clipTimeForSignature(s: number, trim: Trim, analysisFps: number): number {
  return trim.startSec + Math.max(0, s) + frameDuration(analysisFps);
}
