import { describe, expect, it } from 'vitest';
import {
  FLOOR_AT_HIGHEST,
  FLOOR_AT_LOWEST,
  describeFloor,
  floorAsPercent,
  floorFromSensitivity,
  formatSensitivity,
  sensitivityFromFloor,
} from '../../src/screens/Prepare/sensitivity';
import { DEFAULT_EXTRACTION_OPTIONS } from '../../src/signature/types';

describe('sensitivity ↔ noise floor', () => {
  it('spans 0.1 to 0.001 field diagonals per second, higher sensitivity = lower floor', () => {
    expect(floorFromSensitivity(0)).toBeCloseTo(FLOOR_AT_LOWEST, 12);
    expect(floorFromSensitivity(1)).toBeCloseTo(FLOOR_AT_HIGHEST, 12);
    expect(FLOOR_AT_LOWEST).toBe(0.1);
    expect(FLOOR_AT_HIGHEST).toBe(0.001);
    let previous = Infinity;
    for (let s = 0; s <= 1.0001; s += 0.05) {
      const floor = floorFromSensitivity(s);
      expect(floor).toBeLessThan(previous);
      previous = floor;
    }
  });

  it('is logarithmic: the default manual floor (0.01) sits in the middle', () => {
    expect(floorFromSensitivity(0.5)).toBeCloseTo(0.01, 12);
    expect(floorFromSensitivity(0.25)).toBeCloseTo(0.1 / Math.sqrt(10), 12);
    expect(sensitivityFromFloor(DEFAULT_EXTRACTION_OPTIONS.manualNoiseFloor)).toBeCloseTo(0.5, 12);
  });

  it('round-trips and clamps', () => {
    for (const s of [0, 0.1, 0.37, 0.5, 0.92, 1]) {
      expect(sensitivityFromFloor(floorFromSensitivity(s))).toBeCloseTo(s, 12);
    }
    expect(sensitivityFromFloor(1)).toBe(0);
    expect(sensitivityFromFloor(0.0001)).toBe(1);
    expect(sensitivityFromFloor(0)).toBe(1);
    expect(floorFromSensitivity(-3)).toBeCloseTo(0.1, 12);
    expect(floorFromSensitivity(7)).toBeCloseTo(0.001, 12);
    expect(floorFromSensitivity(NaN)).toBeCloseTo(0.01, 12);
  });

  it('describes the floor in plain words', () => {
    expect(floorAsPercent(0.1)).toBe('10%');
    expect(floorAsPercent(0.01)).toBe('1%');
    expect(floorAsPercent(0.001)).toBe('0.1%');
    expect(floorAsPercent(0.0316)).toBe('3.2%');
    expect(describeFloor(0.01)).toBe('Movement slower than 1% of the frame per second is ignored.');
    expect(formatSensitivity(0.5)).toBe('50%');
    expect(formatSensitivity(1.2)).toBe('100%');
  });
});
