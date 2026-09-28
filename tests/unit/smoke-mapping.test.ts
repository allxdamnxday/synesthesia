import { describe, expect, it } from 'vitest';
import { baselineValues } from '../../src/materials/properties';
import { getVisualMaterial, listVisualMaterials } from '../../src/materials/registry';
import { luminance } from '../../src/materials/visual/shared/fluid/palette';
import { rangeScale } from '../../src/materials/visual/shared/fluid/projection';
import {
  SMOKE_MAX_LIFT,
  SMOKE_MAX_VISCOSITY,
  burstRadius,
  smokeAmount,
  smokeDissipation,
  smokeForceGain,
  smokeLift,
  smokeParams,
  smokeViscosity,
} from '../../src/materials/visual/smoke/mapping';
import { SMOKE_TINTS, smokeTint } from '../../src/materials/visual/smoke/palette';
import { SMOKE_PROPERTIES } from '../../src/materials/visual/smoke/properties';

const baseline = baselineValues(SMOKE_PROPERTIES);
const at = (id: string, value: number) => smokeParams({ ...baseline, [id]: value });
const sweep = (id: string) => [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1].map((v) => at(id, v));

function increasing(values: number[]): boolean {
  return values.every((v, i) => i === 0 || v > (values[i - 1] ?? -Infinity));
}
function decreasing(values: number[]): boolean {
  return increasing(values.map((v) => -v));
}

describe('Smoke property mapping', () => {
  it('rise lifts warm smoke above the middle, sinks it below, and is neutral at the middle', () => {
    const lifts = sweep('rise').map((p) => p.emit.lift);
    expect(increasing(lifts)).toBe(true);
    expect(smokeLift(0.5)).toBe(0);
    expect(smokeLift(0.2)).toBeLessThan(0);
    expect(smokeLift(1)).toBeCloseTo(SMOKE_MAX_LIFT, 12);
    expect(smokeLift(0)).toBeCloseTo(-SMOKE_MAX_LIFT, 12);
    // The baseline rises.
    expect(smokeParams(baseline).emit.lift).toBeGreaterThan(0);
  });

  it('viscosity thickens the air: true viscosity, drag and lag; fewer curls and eddies', () => {
    const s = sweep('viscosity');
    expect(s[0]?.step.viscosity).toBe(0);
    expect(s[0]?.step.viscosityIterations).toBe(0);
    expect(increasing(s.map((p) => p.step.viscosity))).toBe(true);
    expect(increasing(s.map((p) => p.step.velocityDissipation))).toBe(true);
    expect(decreasing(s.map((p) => p.step.vorticity))).toBe(true);
    expect(decreasing(s.map((p) => p.emit.turbulence))).toBe(true);
    expect(smokeViscosity(1)).toBeCloseTo(SMOKE_MAX_VISCOSITY, 12);
  });

  it('persistence keeps the smoke hanging longer', () => {
    expect(decreasing(sweep('persistence').map((p) => p.step.dyeDissipation))).toBe(true);
    expect(smokeDissipation(0)).toBeGreaterThan(1.5);
    expect(smokeDissipation(1)).toBeLessThan(0.1);
  });

  it('dispersion adds curls and seeded eddies', () => {
    const s = sweep('dispersion');
    expect(increasing(s.map((p) => p.step.vorticity))).toBe(true);
    expect(increasing(s.map((p) => p.emit.turbulence))).toBe(true);
    expect(s[0]?.emit.turbulence).toBe(0);
    // Smoke curls even without dispersion (strong confinement is part of the material).
    expect(s[0]?.step.vorticity).toBeGreaterThan(0);
  });

  it('brightness raises exposure and saturation', () => {
    const s = sweep('brightness');
    expect(increasing(s.map((p) => p.display.exposure))).toBe(true);
    expect(increasing(s.map((p) => p.display.saturation))).toBe(true);
    expect(smokeParams(baseline).display.surfaceLight).toBe(0);
  });

  it('intensity pushes harder', () => {
    expect(increasing(sweep('intensity').map((p) => p.step.forceGain))).toBe(true);
    expect(smokeForceGain(0.5)).toBeCloseTo(6, 12);
  });

  it('density gives off more smoke from more vents', () => {
    const s = sweep('density');
    expect(increasing(s.map((p) => p.emit.smokeAmount))).toBe(true);
    expect(increasing(s.map((p) => p.emit.ventCoverage))).toBe(true);
    expect(smokeAmount(0.5)).toBeCloseTo(2.5, 12);
  });

  it('range projects the movement and scales the burst with it', () => {
    const s = sweep('range');
    expect(s.map((p) => p.step.range)).toEqual([0, 0.1, 0.3, 0.5, 0.7, 0.9, 1]);
    expect(increasing(s.map((p) => p.emit.burstRadius))).toBe(true);
    expect(at('range', 0.9).emit.burstRadius / at('range', 0.5).emit.burstRadius).toBeCloseTo(
      rangeScale(0.9),
      9,
    );
  });

  it('releases its own smoke: the solver dye pass and the push scatter are off', () => {
    for (const def of SMOKE_PROPERTIES) {
      for (const v of [0, 1]) {
        const p = at(def.id, v);
        expect(p.step.dyeAmount).toBe(0);
        expect(p.step.jitterAngle).toBe(0);
        expect(p.step.jitterOffset).toBe(0);
      }
    }
  });

  it('falls back to the baseline for missing or broken values, and clamps', () => {
    expect(smokeParams({})).toEqual(smokeParams(baseline));
    expect(smokeParams({ ...baseline, rise: Number.NaN })).toEqual(smokeParams(baseline));
    expect(smokeParams({ ...baseline, rise: -4 })).toEqual(at('rise', 0));
  });

  it('has finite parameters across the whole range (only lift may be negative)', () => {
    for (const def of SMOKE_PROPERTIES) {
      for (const v of [0, 0.5, 1]) {
        const p = at(def.id, v);
        for (const [key, value] of Object.entries({ ...p.step, ...p.emit, ...p.display })) {
          if (typeof value !== 'number') continue;
          expect(Number.isFinite(value), `${def.id}=${v} ${key}`).toBe(true);
          if (key !== 'lift') expect(value, `${def.id}=${v} ${key}`).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});

describe('Smoke burst radius (divergence → emission radius)', () => {
  it('widens for an expanding movement and narrows for a contracting one', () => {
    const base = 0.035;
    expect(burstRadius(base, 0)).toBeCloseTo(base, 12);
    expect(burstRadius(base, 1)).toBeGreaterThan(2 * base);
    expect(burstRadius(base, -1)).toBeLessThan(base / 2);
    const radii = [-1, -0.5, 0, 0.5, 1].map((d) => burstRadius(base, d));
    expect(increasing(radii)).toBe(true);
  });

  it('clamps out-of-range and broken divergence', () => {
    expect(burstRadius(0.04, 7)).toBeCloseTo(burstRadius(0.04, 1), 12);
    expect(burstRadius(0.04, -7)).toBeCloseTo(burstRadius(0.04, -1), 12);
    expect(burstRadius(0.04, Number.NaN)).toBeCloseTo(0.04, 12);
    expect(burstRadius(-1, 0.5)).toBe(0);
  });
});

describe('Smoke tints', () => {
  it("give a wink's close (down) and open (up) two clearly different pale smokes", () => {
    const up = smokeTint(0, 1);
    const down = smokeTint(0, -1);
    const distance = Math.hypot(up[0] - down[0], up[1] - down[1], up[2] - down[2]);
    expect(distance).toBeGreaterThan(0.3);
    expect(up).toEqual(SMOKE_TINTS.rising);
    expect(down).toEqual(SMOKE_TINTS.falling);
    expect(smokeTint(1, 0)).toEqual(SMOKE_TINTS.level);
    expect(smokeTint(0, 0)).toEqual(SMOKE_TINTS.level);
    // Pale: nothing dark or strongly colored.
    for (const c of [up, down, smokeTint(1, 0), smokeTint(-1, 1), smokeTint(1, -1)]) {
      expect(luminance(c)).toBeGreaterThan(0.6);
    }
    // Warm rising, cool falling.
    expect(up[0]).toBeGreaterThan(up[2]);
    expect(down[2]).toBeGreaterThan(down[0]);
  });
});

describe('Smoke properties', () => {
  it('shows Rise among its primaries, hides elasticity and rigidity', () => {
    const smoke = getVisualMaterial('smoke')?.meta;
    const ids = smoke?.properties.map((p) => p.id) ?? [];
    expect(ids).not.toContain('elasticity');
    expect(ids).not.toContain('rigidity');
    expect(smoke?.properties.filter((p) => p.primary).map((p) => p.id)).toEqual([
      'viscosity',
      'persistence',
      'dispersion',
      'brightness',
      'intensity',
      'rise',
    ]);
    const rise = smoke?.properties.find((p) => p.id === 'rise');
    expect(rise?.shared).toBe(false);
    expect(rise?.default).toBeGreaterThan(0.5);
    expect(smoke?.version).toBe(1);
  });

  it('is listed after Honey and before the Signature view', () => {
    const ids = listVisualMaterials().map((m) => m.meta.id);
    expect(ids.indexOf('smoke')).toBe(ids.indexOf('honey') + 1);
    expect(ids.indexOf('smoke')).toBeLessThan(ids.indexOf('signature'));
  });
});
