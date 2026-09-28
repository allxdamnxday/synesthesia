import { describe, expect, it } from 'vitest';
import { baselineValues } from '../../src/materials/properties';
import { WATER_PROPERTIES } from '../../src/materials/visual/water/properties';
import {
  WATER_MAX_VISCOSITY,
  waterDyeAmount,
  waterDyeDissipation,
  waterForceGain,
  waterParams,
  waterViscosity,
} from '../../src/materials/visual/water/mapping';

const baseline = baselineValues(WATER_PROPERTIES);
const at = (id: string, value: number) => waterParams({ ...baseline, [id]: value });
const sweep = (id: string) => [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1].map((v) => at(id, v));

function increasing(values: number[]): boolean {
  return values.every((v, i) => i === 0 || v > (values[i - 1] ?? -Infinity));
}
function nonDecreasing(values: number[]): boolean {
  return values.every((v, i) => i === 0 || v >= (values[i - 1] ?? -Infinity));
}

describe('Water property mapping', () => {
  it('viscosity thickens the water: more ν, drag, iterations, lag; fewer fine swirls', () => {
    const s = sweep('viscosity');
    expect(s[0]?.step.viscosity).toBe(0);
    expect(s[0]?.step.viscosityIterations).toBe(0);
    expect(increasing(s.map((p) => p.step.viscosity))).toBe(true);
    expect(increasing(s.map((p) => p.step.velocityDissipation))).toBe(true);
    expect(nonDecreasing(s.map((p) => p.step.viscosityIterations))).toBe(true);
    expect(nonDecreasing(s.map((p) => p.step.forceLowPassSec))).toBe(true);
    expect(s[6]?.step.vorticity).toBeLessThan(s[0]?.step.vorticity ?? 0);
    expect(waterViscosity(1)).toBeCloseTo(WATER_MAX_VISCOSITY, 12);
  });

  it('persistence keeps the dye longer', () => {
    const rates = sweep('persistence').map((p) => p.step.dyeDissipation);
    expect(increasing(rates.map((r) => -r))).toBe(true);
    expect(waterDyeDissipation(0)).toBeGreaterThan(2); // gone within about half a second
    expect(waterDyeDissipation(1)).toBeLessThan(0.1); // lingers for many seconds
  });

  it('dispersion adds swirl and seeded scatter', () => {
    const s = sweep('dispersion');
    expect(increasing(s.map((p) => p.step.vorticity))).toBe(true);
    expect(nonDecreasing(s.map((p) => p.step.jitterAngle))).toBe(true);
    expect(nonDecreasing(s.map((p) => p.step.jitterOffset))).toBe(true);
    expect(s[0]?.step.jitterAngle).toBe(0);
  });

  it('brightness raises exposure and saturation', () => {
    const s = sweep('brightness');
    expect(increasing(s.map((p) => p.display.exposure))).toBe(true);
    expect(increasing(s.map((p) => p.display.saturation))).toBe(true);
    expect(at('brightness', 0.5).display.exposure).toBeCloseTo(1, 12);
  });

  it('intensity pushes harder', () => {
    expect(increasing(sweep('intensity').map((p) => p.step.forceGain))).toBe(true);
    expect(waterForceGain(0.5)).toBeCloseTo(6, 12);
  });

  it('density releases more dye over more of the water', () => {
    const s = sweep('density');
    expect(increasing(s.map((p) => p.step.dyeAmount))).toBe(true);
    expect(increasing(s.map((p) => p.step.dyeSpotCoverage))).toBe(true);
    expect(waterDyeAmount(0.5)).toBeCloseTo(4, 12);
  });

  it('passes Range, palette and surface light through', () => {
    expect(at('range', 0.8).step.range).toBeCloseTo(0.8, 12);
    expect(at('palette', 2).palette).toBe(2);
    expect(at('surfaceLight', 0.3).display.surfaceLight).toBeCloseTo(0.3, 12);
  });

  it('falls back to the baseline for missing or broken values, and clamps', () => {
    const fromNothing = waterParams({});
    expect(fromNothing).toEqual(waterParams(baseline));
    expect(waterParams({ ...baseline, brightness: Number.NaN })).toEqual(waterParams(baseline));
    expect(waterParams({ ...baseline, intensity: 7 })).toEqual(at('intensity', 1));
    expect(waterParams({ ...baseline, palette: 9 }).palette).toBe(2);
  });

  it('has finite, positive solver parameters across the whole range', () => {
    for (const def of WATER_PROPERTIES.filter((d) => d.kind === 'continuous')) {
      for (const v of [0, 0.5, 1]) {
        const p = at(def.id, v);
        for (const [key, value] of Object.entries({ ...p.step, ...p.display })) {
          expect(Number.isFinite(value), `${def.id}=${v} ${key}`).toBe(true);
          expect(value, `${def.id}=${v} ${key}`).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});
