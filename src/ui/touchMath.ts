/**
 * Pure helpers for finger gestures on horizontal controls (sliders, the sparklines, drawing a
 * focus box). Such controls use `touch-action: pan-y`, so the browser still scrolls the page
 * when a finger moves up or down; the control only takes over once the finger has clearly
 * moved sideways. Tested in tests/unit/touch-math.test.ts.
 */

/** What a finger is doing after moving `dx`, `dy` pixels from where it went down. */
export type TouchIntent = 'undecided' | 'drag' | 'scroll';

/**
 * Up or down past `slop` (and at least as far as sideways) is the page scrolling; sideways
 * past `slop` is a drag of the control; anything less is still undecided (maybe a tap).
 */
export function touchIntent(dx: number, dy: number, slop: number): TouchIntent {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ay > slop && ay >= ax) return 'scroll';
  if (ax > slop) return 'drag';
  return 'undecided';
}

/** A tap: when (ms, any clock) and where (px). */
export interface Tap {
  time: number;
  x: number;
  y: number;
}

/** Double-taps: at most this long (ms) and this far (px) apart. */
export const DOUBLE_TAP_MS = 400;
export const DOUBLE_TAP_PX = 30;

/** Whether `tap` is the second of a double-tap that began with `previous`. */
export function isDoubleTap(
  previous: Tap | null,
  tap: Tap,
  maxMs = DOUBLE_TAP_MS,
  maxPx = DOUBLE_TAP_PX,
): boolean {
  if (!previous) return false;
  const elapsed = tap.time - previous.time;
  return (
    elapsed >= 0 && elapsed < maxMs && Math.hypot(tap.x - previous.x, tap.y - previous.y) < maxPx
  );
}
