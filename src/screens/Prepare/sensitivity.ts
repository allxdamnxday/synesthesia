/**
 * Sensitivity ↔ noise floor (SPEC 8.1 step 8). The manual Sensitivity slider (0–1, under
 * Advanced) maps logarithmically onto the noise floor: higher sensitivity is a lower floor.
 * 0 is a floor of 0.1 field diagonals per second (only broad, quick movement counts); 1 is
 * 0.001 (the finest movement counts). The default manual floor, 0.01, sits in the middle.
 */

/** Floor at sensitivity 0 (least sensitive), in field diagonals per second. */
export const FLOOR_AT_LOWEST = 0.1;
/** Floor at sensitivity 1 (most sensitive). */
export const FLOOR_AT_HIGHEST = 0.001;

const LOG_LOWEST = Math.log10(FLOOR_AT_LOWEST);
const LOG_HIGHEST = Math.log10(FLOOR_AT_HIGHEST);

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Noise floor for a sensitivity (0–1). */
export function floorFromSensitivity(sensitivity: number): number {
  const s = Number.isFinite(sensitivity) ? clamp01(sensitivity) : 0.5;
  return 10 ** (LOG_LOWEST + (LOG_HIGHEST - LOG_LOWEST) * s);
}

/** Sensitivity (0–1) for a noise floor; floors outside the range clamp to its ends. */
export function sensitivityFromFloor(floor: number): number {
  if (!(floor > 0)) return 1;
  return clamp01((Math.log10(floor) - LOG_LOWEST) / (LOG_HIGHEST - LOG_LOWEST));
}

/** The floor as a share of the frame per second, to two significant digits: "0.32%". */
export function floorAsPercent(floor: number): string {
  if (!(floor > 0)) return '0%';
  return `${Number((floor * 100).toPrecision(2))}%`;
}

/** One plain sentence about what a floor means. */
export function describeFloor(floor: number): string {
  return `Movement slower than ${floorAsPercent(floor)} of the frame per second is ignored.`;
}

/** Slider readout: "50%". */
export function formatSensitivity(sensitivity: number): string {
  return `${Math.round(clamp01(sensitivity) * 100)}%`;
}
