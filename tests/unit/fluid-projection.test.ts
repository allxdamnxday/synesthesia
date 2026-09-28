import { describe, expect, it } from 'vitest';
import {
  FLUID_TIERS,
  MAX_VISCOSITY_ITERATIONS,
  RANGE_SCALE_MAX,
  RANGE_SCALE_MIN,
  diffusionAlpha,
  dyeGridForCanvas,
  fieldDiagonalInCells,
  gridForCanvas,
  projectField,
  rangeScale,
  tierIterations,
} from '../../src/materials/visual/shared/fluid/projection';

describe('Range projection', () => {
  it('fits at 0.5, compresses toward 0 and magnifies toward 1', () => {
    expect(rangeScale(0.5)).toBeCloseTo(1, 12);
    expect(rangeScale(0)).toBeCloseTo(RANGE_SCALE_MIN, 12);
    expect(rangeScale(1)).toBeCloseTo(RANGE_SCALE_MAX, 12);
    let previous = 0;
    for (let r = 0; r <= 1.0001; r += 0.05) {
      const s = rangeScale(r);
      expect(s).toBeGreaterThan(previous);
      previous = s;
    }
  });

  it('clamps out-of-range and missing values', () => {
    expect(rangeScale(-3)).toBeCloseTo(RANGE_SCALE_MIN, 12);
    expect(rangeScale(7)).toBeCloseTo(RANGE_SCALE_MAX, 12);
    expect(rangeScale(Number.NaN)).toBeCloseTo(1, 12);
  });

  it('fills the canvas exactly when the aspect ratios match', () => {
    const r = projectField(0.5, 16 / 9, 16 / 9);
    expect(r).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it('keeps the field aspect (no distorted directions), centred, never cropped at 0.5', () => {
    // A square focus area on a 16:9 canvas: full height, centred horizontally.
    const square = projectField(0.5, 1, 16 / 9);
    expect(square.height).toBeCloseTo(1, 12);
    expect(square.width).toBeCloseTo(9 / 16, 12);
    expect(square.x + square.width / 2).toBeCloseTo(0.5, 12);
    // Its aspect in pixels stays 1:1.
    expect((square.width * 16) / (square.height * 9)).toBeCloseTo(1, 12);
    // A wide field on a square canvas: full width.
    const wide = projectField(0.5, 2, 1);
    expect(wide.width).toBeCloseTo(1, 12);
    expect(wide.height).toBeCloseTo(0.5, 12);
    expect(wide.y + wide.height / 2).toBeCloseTo(0.5, 12);
  });

  it('shrinks toward the centre when compressed and spills past the edges when expanded', () => {
    const small = projectField(0, 16 / 9, 16 / 9);
    expect(small.width).toBeCloseTo(RANGE_SCALE_MIN, 12);
    expect(small.x).toBeCloseTo((1 - RANGE_SCALE_MIN) / 2, 12);
    const big = projectField(1, 16 / 9, 16 / 9);
    expect(big.width).toBeCloseTo(RANGE_SCALE_MAX, 12);
    expect(big.x).toBeLessThan(0);
    expect(big.x + big.width).toBeGreaterThan(1);
  });

  it('converts field diagonals to grid cells, growing with Range', () => {
    const full = projectField(0.5, 16 / 9, 16 / 9);
    expect(fieldDiagonalInCells(full, 228, 128)).toBeCloseTo(Math.hypot(228, 128), 9);
    const magnified = projectField(1, 16 / 9, 16 / 9);
    expect(fieldDiagonalInCells(magnified, 228, 128)).toBeCloseTo(
      RANGE_SCALE_MAX * Math.hypot(228, 128),
      9,
    );
  });
});

describe('fluid grids by quality tier', () => {
  it('uses the SPEC resolutions', () => {
    expect(FLUID_TIERS.draft).toMatchObject({ sim: 64, dye: 256 });
    expect(FLUID_TIERS.standard).toMatchObject({ sim: 128, dye: 512 });
    expect(FLUID_TIERS.high).toMatchObject({ sim: 256, dye: 1024 });
  });

  it('gives the short side the tier size and scales the long side by the aspect', () => {
    expect(gridForCanvas(128, 1920, 1080)).toEqual({ width: 228, height: 128 });
    expect(gridForCanvas(128, 1080, 1920)).toEqual({ width: 128, height: 228 });
    expect(gridForCanvas(256, 1080, 1080)).toEqual({ width: 256, height: 256 });
    expect(gridForCanvas(1024, 32000, 1000, 4096)).toEqual({ width: 4096, height: 1024 });
  });

  it("caps the dye grid at the canvas's own resolution, never below the simulation", () => {
    expect(dyeGridForCanvas('high', 1920, 1080)).toEqual({ width: 1820, height: 1024 });
    expect(dyeGridForCanvas('standard', 480, 270)).toEqual({ width: 480, height: 270 });
    expect(dyeGridForCanvas('standard', 64, 36)).toEqual({ width: 228, height: 128 });
  });
});

describe('viscosity', () => {
  it('alpha is ν·dt·cells²', () => {
    expect(diffusionAlpha(1e-3, 1 / 60, 128)).toBeCloseTo((1e-3 / 60) * 128 * 128, 12);
    expect(diffusionAlpha(-1, 1 / 60, 128)).toBe(0);
  });

  it('scales Jacobi iterations with the square of the grid so tiers look alike', () => {
    expect(tierIterations(8, 128)).toBe(8);
    expect(tierIterations(8, 256)).toBe(32);
    expect(tierIterations(8, 64)).toBe(2);
    expect(tierIterations(1, 64)).toBe(1);
    expect(tierIterations(40, 256)).toBe(MAX_VISCOSITY_ITERATIONS);
    expect(tierIterations(0, 256)).toBe(0);
  });

  it('keeps the low-frequency convergence roughly equal across tiers', () => {
    // For large alpha, Jacobi leaves about (4a / (1 + 4a))^n of a smooth mode unconverged.
    const residual = (nu: number, cells: number) => {
      const a = diffusionAlpha(nu, 1 / 60, cells);
      return ((4 * a) / (1 + 4 * a)) ** tierIterations(12, cells);
    };
    const nu = 6e-3;
    const standard = residual(nu, 128);
    expect(Math.abs(residual(nu, 256) - standard)).toBeLessThan(0.08);
    expect(Math.abs(residual(nu, 64) - standard)).toBeLessThan(0.12);
  });
});
