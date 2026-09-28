import { describe, expect, it } from 'vitest';
import {
  fineDragValue,
  fractionOf,
  keyboardValue,
  quantize,
  valueFromPosition,
} from '../../src/ui/sliderMath';

describe('slider math', () => {
  it('maps positions to values and back', () => {
    expect(valueFromPosition(50, 200, 0, 1)).toBeCloseTo(0.25);
    expect(valueFromPosition(-10, 200, 0, 1)).toBe(0);
    expect(valueFromPosition(500, 200, 0.25, 2)).toBe(2);
    expect(fractionOf(1.125, 0.25, 2)).toBeCloseTo(0.5);
  });

  it('quantizes to the step grid without float noise', () => {
    expect(quantize(0.30000000000000004, 0.01, 0, 1)).toBe(0.3);
    expect(quantize(0.256, 0.01, 0, 1)).toBe(0.26);
    expect(quantize(3.4, 1, 1, 8)).toBe(3);
    expect(quantize(9, 1, 1, 8)).toBe(8);
  });

  it('fine drag moves ten times slower, relative to the start', () => {
    expect(fineDragValue(0.5, 100, 200, 0, 1)).toBeCloseTo(0.55);
    expect(fineDragValue(0.99, 400, 200, 0, 1)).toBe(1);
  });

  it('keyboard nudges by one step, ten with Shift or Page keys', () => {
    expect(keyboardValue('ArrowRight', false, 0.5, 0.01, 0, 1)).toBe(0.51);
    expect(keyboardValue('ArrowLeft', true, 0.5, 0.01, 0, 1)).toBe(0.4);
    expect(keyboardValue('PageUp', false, 0.95, 0.01, 0, 1)).toBe(1);
    expect(keyboardValue('Home', false, 0.5, 0.01, 0, 1)).toBe(0);
    expect(keyboardValue('x', false, 0.5, 0.01, 0, 1)).toBeNull();
  });
});
