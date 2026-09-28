/** Pure value math for the Slider (tested in tests/unit/ui-math.test.ts). */

export function clampTo(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Snap to the step grid anchored at `min`, and trim float noise. */
export function quantize(value: number, step: number, min: number, max: number): number {
  const clamped = clampTo(value, min, max);
  if (step <= 0) return clamped;
  const snapped = min + Math.round((clamped - min) / step) * step;
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)) + 1);
  return clampTo(Number(snapped.toFixed(decimals)), min, max);
}

/** Absolute position on the track → value. `x` is relative to the track's left edge. */
export function valueFromPosition(x: number, width: number, min: number, max: number): number {
  if (width <= 0) return min;
  return min + clampTo(x / width, 0, 1) * (max - min);
}

/** Value → fraction 0..1 along the track. */
export function fractionOf(value: number, min: number, max: number): number {
  return max === min ? 0 : clampTo((value - min) / (max - min), 0, 1);
}

/**
 * Fine (Shift) drag: the value moves relative to where the drag started, at `factor`
 * times normal speed, so small adjustments are easy on a trackpad.
 */
export function fineDragValue(
  startValue: number,
  dx: number,
  width: number,
  min: number,
  max: number,
  factor = 0.1,
): number {
  if (width <= 0) return startValue;
  return clampTo(startValue + (dx / width) * (max - min) * factor, min, max);
}

/** Keyboard nudges: arrows move one step, Shift+arrows and Page keys ten steps. */
export function keyboardValue(
  key: string,
  shift: boolean,
  value: number,
  step: number,
  min: number,
  max: number,
): number | null {
  const big = step * 10;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowUp':
      return quantize(value + (shift ? big : step), step, min, max);
    case 'ArrowLeft':
    case 'ArrowDown':
      return quantize(value - (shift ? big : step), step, min, max);
    case 'PageUp':
      return quantize(value + big, step, min, max);
    case 'PageDown':
      return quantize(value - big, step, min, max);
    case 'Home':
      return min;
    case 'End':
      return max;
    default:
      return null;
  }
}
