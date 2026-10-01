import { describe, expect, it } from 'vitest';
import { baselineValues } from '../../src/materials/properties';
import { getVisualMaterial, listVisualMaterials } from '../../src/materials/registry';
import { PALETTE_SIZE, luminance } from '../../src/materials/visual/shared/fluid/palette';
import {
  honeyDrag,
  honeyDyeAmount,
  honeyDyeDissipation,
  honeyLag,
  honeyMobility,
  honeyParams,
  honeyRelax,
  honeySpring,
  honeyViscosity,
} from '../../src/materials/visual/honey/mapping';
import { HONEY_PALETTE_BYTES } from '../../src/materials/visual/honey/palettes';
import { HONEY_PROPERTIES } from '../../src/materials/visual/honey/properties';
import { WATER_PROPERTIES } from '../../src/materials/visual/water/properties';
import { WATER_MAX_VISCOSITY, waterParams } from '../../src/materials/visual/water/mapping';

const baseline = baselineValues(HONEY_PROPERTIES);
const at = (id: string, value: number) => honeyParams({ ...baseline, [id]: value });
const sweep = (id: string) => [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1].map((v) => at(id, v));

function increasing(values: number[]): boolean {
  return values.every((v, i) => i === 0 || v > (values[i - 1] ?? -Infinity));
}
function decreasing(values: number[]): boolean {
  return increasing(values.map((v) => -v));
}

describe('Honey property mapping', () => {
  it('viscosity thickens the honey: wider diffusion, heavier drag, longer lag, less travel', () => {
    const s = sweep('viscosity');
    expect(increasing(s.map((p) => p.body.viscosity))).toBe(true);
    expect(increasing(s.map((p) => p.step.velocityDissipation))).toBe(true);
    expect(increasing(s.map((p) => p.step.forceLowPassSec))).toBe(true);
    // Mobility: how far the honey follows the push (steady speed per unit of push).
    expect(decreasing(s.map((p) => p.step.forceGain / p.step.velocityDissipation))).toBe(true);
    // Thicker honey takes the color in more smoothly and can't hold swirls.
    expect(decreasing(s.map((p) => p.step.dyeSpots))).toBe(true);
    expect(s[6]?.step.vorticity).toBe(0);
    expect(honeyViscosity(1) / honeyViscosity(0)).toBeCloseTo(8, 9);
  });

  it('diffuses with its own Gaussian kernel, never the under-converging Jacobi pass', () => {
    for (const p of sweep('viscosity')) {
      expect(p.step.viscosity).toBe(0);
      expect(p.step.viscosityIterations).toBe(0);
    }
  });

  it('is always slower and thicker than Water', () => {
    const honey = honeyParams(baseline);
    const water = waterParams(baselineValues(WATER_PROPERTIES));
    // Even the runniest honey is thicker than the thickest water.
    expect(honeyViscosity(0)).toBeGreaterThan(WATER_MAX_VISCOSITY);
    expect(honey.step.forceLowPassSec).toBeGreaterThan(water.step.forceLowPassSec * 3);
    expect(honey.step.velocityDissipation).toBeGreaterThan(water.step.velocityDissipation * 3);
    // At the same Persistence, color stays in honey far longer.
    expect(honey.step.dyeDissipation).toBeLessThan(water.step.dyeDissipation / 3);
    for (const p of sweep('viscosity')) expect(p.step.forceLowPassSec).toBeGreaterThan(0);
  });

  it('marks the moment of movement with color while the honey lags behind', () => {
    const p = honeyParams(baseline);
    expect(p.step.dyeFromRawField).toBe(true);
    expect(p.step.dyeStrokeLength).toBeGreaterThan(0);
    expect(p.step.dyeSpots).toBeGreaterThan(0);
  });

  it('elasticity springs the honey back: stiffer spring, longer memory', () => {
    const s = sweep('elasticity');
    expect(s[0]?.body.springStiffness).toBe(0);
    expect(increasing(s.map((p) => p.body.springStiffness))).toBe(true);
    expect(decreasing(s.map((p) => p.body.displacementRelax))).toBe(true);
    expect(honeySpring(0)).toBe(0);
    expect(honeyRelax(1)).toBeGreaterThan(0);
    // At full elasticity and baseline viscosity the spring is underdamped: it overshoots.
    const full = at('elasticity', 1);
    const damping = full.step.velocityDissipation / (2 * Math.sqrt(full.body.springStiffness));
    expect(damping).toBeLessThan(0.5);
  });

  it('persistence keeps the color longer', () => {
    expect(decreasing(sweep('persistence').map((p) => p.step.dyeDissipation))).toBe(true);
    expect(honeyDyeDissipation(0)).toBeGreaterThan(0.5); // mostly gone within a few seconds
    expect(honeyDyeDissipation(1)).toBeLessThan(0.02); // stays for a minute
  });

  it('dispersion pushes the honey unevenly', () => {
    const s = sweep('dispersion');
    expect(s[0]?.step.jitterAngle).toBe(0);
    expect(s[0]?.step.jitterOffset).toBe(0);
    expect(increasing(s.map((p) => p.step.jitterAngle))).toBe(true);
    expect(increasing(s.map((p) => p.step.jitterOffset))).toBe(true);
  });

  it('brightness raises exposure and saturation', () => {
    const s = sweep('brightness');
    expect(increasing(s.map((p) => p.display.exposure))).toBe(true);
    expect(increasing(s.map((p) => p.display.saturation))).toBe(true);
  });

  it('intensity drags the honey harder without changing how thick it is', () => {
    const s = sweep('intensity');
    expect(increasing(s.map((p) => p.step.forceGain))).toBe(true);
    for (const p of s) {
      expect(p.step.velocityDissipation).toBeCloseTo(honeyDrag(0.5), 12);
      expect(p.step.forceLowPassSec).toBeCloseTo(honeyLag(0.5), 12);
    }
    expect(at('intensity', 0.5).step.forceGain).toBeCloseTo(
      honeyMobility(0.5) * honeyDrag(0.5),
      12,
    );
  });

  it('density folds in more color over more of the honey', () => {
    const s = sweep('density');
    expect(increasing(s.map((p) => p.step.dyeAmount))).toBe(true);
    expect(increasing(s.map((p) => p.step.dyeSpotCoverage))).toBe(true);
    expect(honeyDyeAmount(0.5)).toBeCloseTo(2.5, 12);
  });

  it('passes Range, palette and surface light through', () => {
    expect(at('range', 0.8).step.range).toBeCloseTo(0.8, 12);
    expect(at('palette', 2).palette).toBe(2);
    expect(at('surfaceLight', 0.3).display.surfaceLight).toBeCloseTo(0.3, 12);
  });

  it('hue turns the colors where the honey is drawn, and nothing else', () => {
    expect(honeyParams(baseline).display.hue).toBe(0);
    expect(at('hue', 0.75).display.hue).toBeCloseTo(0.25, 12);
    expect(at('hue', 0).display.hue).toBe(0.5);
    expect(at('hue', 1).display.hue).toBe(0.5);
    for (const v of [0, 0.1, 0.9, 1]) {
      const p = at('hue', v);
      expect({ ...p, display: { ...p.display, hue: 0 } }).toEqual(honeyParams(baseline));
    }
  });

  it('falls back to the baseline for missing or broken values, and clamps', () => {
    expect(honeyParams({})).toEqual(honeyParams(baseline));
    expect(honeyParams({ ...baseline, elasticity: Number.NaN })).toEqual(honeyParams(baseline));
    expect(honeyParams({ ...baseline, viscosity: 3 })).toEqual(at('viscosity', 1));
    expect(honeyParams({ ...baseline, palette: 9 }).palette).toBe(2);
  });

  it('has finite, non-negative parameters across the whole range', () => {
    for (const def of HONEY_PROPERTIES.filter((d) => d.kind === 'continuous')) {
      for (const v of [0, 0.5, 1]) {
        const p = at(def.id, v);
        const numbers = { ...p.step, ...p.body, ...p.display };
        for (const [key, value] of Object.entries(numbers)) {
          if (typeof value !== 'number') continue;
          expect(Number.isFinite(value), `${def.id}=${v} ${key}`).toBe(true);
          expect(value, `${def.id}=${v} ${key}`).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});

describe('Honey properties', () => {
  it('shows the six shared primaries and Hue, hides rigidity, and keeps the rest under More', () => {
    const honey = getVisualMaterial('honey')?.meta;
    const ids = honey?.properties.map((p) => p.id) ?? [];
    expect(ids).not.toContain('rigidity');
    expect(honey?.properties.filter((p) => p.primary).map((p) => p.id)).toEqual([
      'viscosity',
      'elasticity',
      'persistence',
      'dispersion',
      'brightness',
      'intensity',
      'hue',
    ]);
    expect(honey?.properties.find((p) => p.id === 'palette')?.choices).toEqual([
      'Amber',
      'Dark honey',
      'Pale gold',
    ]);
    expect(honey?.version).toBe(1);
  });

  it('is listed right after Water', () => {
    const ids = listVisualMaterials().map((m) => m.meta.id);
    expect(ids.indexOf('honey')).toBe(ids.indexOf('water') + 1);
  });
});

describe('Honey palettes', () => {
  const colorAt = (bytes: Uint8Array, turn: number) => {
    const i = Math.floor(turn * PALETTE_SIZE) * 4;
    return [(bytes[i] ?? 0) / 255, (bytes[i + 1] ?? 0) / 255, (bytes[i + 2] ?? 0) / 255] as const;
  };

  it("fold a wink's close (down) and open (up) in as two clearly different honey shades", () => {
    expect(HONEY_PALETTE_BYTES.length).toBe(3);
    for (const bytes of HONEY_PALETTE_BYTES) {
      const up = colorAt(bytes, 0.25);
      const down = colorAt(bytes, 0.75);
      const distance = Math.hypot(up[0] - down[0], up[1] - down[1], up[2] - down[2]);
      expect(distance).toBeGreaterThan(0.3);
      expect(luminance(up)).toBeGreaterThan(luminance(down));
      expect(luminance(down)).toBeGreaterThan(0.15);
    }
  });

  it('stay within warm honey tones in every direction', () => {
    for (const bytes of HONEY_PALETTE_BYTES) {
      for (let i = 0; i < PALETTE_SIZE; i++) {
        const [r, g, b] = [bytes[i * 4] ?? 0, bytes[i * 4 + 1] ?? 0, bytes[i * 4 + 2] ?? 0];
        expect(r).toBeGreaterThanOrEqual(g);
        expect(g).toBeGreaterThanOrEqual(b);
      }
    }
  });
});
