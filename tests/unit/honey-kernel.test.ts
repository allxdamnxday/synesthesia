import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../src/materials/types';
import { FLUID_TIERS } from '../../src/materials/visual/shared/fluid/projection';
import {
  BLUR_TAPS,
  diffusionSigmaTexels,
  gaussianKernel,
  kernelVariance,
} from '../../src/materials/visual/honey/kernel';
import { honeyViscosity } from '../../src/materials/visual/honey/mapping';

const sum = (k: { weights: number[] }) =>
  k.weights.reduce((acc, w, i) => acc + (i === 0 ? w : 2 * w), 0);

describe("Honey's viscous diffusion kernel", () => {
  it('has the heat kernel width: σ² = 2·ν·dt, in texels of the grid', () => {
    expect(diffusionSigmaTexels(0.03, 1 / 60, 128)).toBeCloseTo(Math.sqrt(0.001) * 128, 9);
    expect(diffusionSigmaTexels(0, FIXED_DT, 128)).toBe(0);
    expect(diffusionSigmaTexels(-1, FIXED_DT, 128)).toBe(0);
    expect(diffusionSigmaTexels(Number.NaN, FIXED_DT, 128)).toBe(0);
  });

  it('spreads the same distance of honey at every quality tier', () => {
    const nu = honeyViscosity(0.5);
    const widths = Object.values(FLUID_TIERS).map(
      (tier) => diffusionSigmaTexels(nu, FIXED_DT, tier.sim) / tier.sim,
    );
    for (const w of widths) expect(w).toBeCloseTo(widths[0] ?? 0, 12);
  });

  it('is a normalized Gaussian whose variance matches σ² over the whole honey range', () => {
    for (const tier of Object.values(FLUID_TIERS)) {
      for (const v of [0, 0.5, 1]) {
        const sigma = diffusionSigmaTexels(honeyViscosity(v), FIXED_DT, tier.sim);
        const k = gaussianKernel(sigma);
        expect(k.weights.length).toBe(BLUR_TAPS + 1);
        expect(sum(k)).toBeCloseTo(1, 12);
        // Linear filtering between texels adds a little; the taps themselves match σ².
        expect(kernelVariance(k) / (sigma * sigma)).toBeGreaterThan(0.85);
        expect(kernelVariance(k) / (sigma * sigma)).toBeLessThan(1.1);
        // The taps reach about three standard deviations.
        expect(k.spacing * BLUR_TAPS).toBeGreaterThanOrEqual(3 * sigma - 1e-9);
        for (let i = 1; i < k.weights.length; i++) {
          expect(k.weights[i]).toBeLessThanOrEqual(k.weights[i - 1] ?? 0);
        }
      }
    }
  });

  it('leaves velocity untouched when there is nothing to diffuse', () => {
    for (const sigma of [0, 1e-6, Number.NaN, -3]) {
      const k = gaussianKernel(sigma);
      expect(k.weights[0]).toBe(1);
      expect(sum(k)).toBe(1);
    }
  });

  it('never spaces taps closer than half a texel', () => {
    expect(gaussianKernel(0.2).spacing).toBe(0.5);
    expect(gaussianKernel(10).spacing).toBeCloseTo(7.5, 12);
  });
});
