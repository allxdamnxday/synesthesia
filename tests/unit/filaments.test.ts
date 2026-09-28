import { describe, expect, it } from 'vitest';
import { baselineValues } from '../../src/materials/properties';
import { FIXED_DT, type PropertyValues, type Quality } from '../../src/materials/types';
import { FilamentSim, POINTS_PER_STRAND } from '../../src/materials/visual/filaments/FilamentSim';
import {
  FILAMENT_TIER_CAPS,
  filamentCount,
  filamentParams,
} from '../../src/materials/visual/filaments/mapping';
import { FILAMENTS_PROPERTIES } from '../../src/materials/visual/filaments/properties';
import { createSyntheticSampler, type SyntheticKind } from '../../src/signature/synthetic';

const N = POINTS_PER_STRAND;
const baseline = baselineValues(FILAMENTS_PROPERTIES);
const at = (id: string, value: number, quality: Quality = 'draft') =>
  filamentParams({ ...baseline, [id]: value }, quality);
const sweep = (id: string) => [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1].map((v) => at(id, v));

function increasing(values: number[]): boolean {
  return values.every((v, i) => i === 0 || v > (values[i - 1] ?? -Infinity));
}

describe('Filaments property mapping', () => {
  it('lists six primaries with Rigidity among them and Dispersion under More', () => {
    const primary = FILAMENTS_PROPERTIES.filter((p) => p.primary).map((p) => p.id);
    expect(primary).toEqual([
      'viscosity',
      'elasticity',
      'persistence',
      'rigidity',
      'brightness',
      'intensity',
    ]);
    const more = FILAMENTS_PROPERTIES.filter((p) => !p.primary).map((p) => p.id);
    expect(more).toEqual(['dispersion', 'density', 'range', 'length', 'thickness']);
  });

  it('viscosity drags harder, pushes a little less, and lags', () => {
    const s = sweep('viscosity');
    expect(increasing(s.map((p) => p.sim.drag))).toBe(true);
    expect(increasing(s.map((p) => -p.sim.forceGain))).toBe(true);
    expect(s[0]?.sim.lagSec).toBe(0);
    expect(increasing(s.slice(1).map((p) => p.sim.lagSec))).toBe(true);
  });

  it('elasticity springs strands back, from not at all', () => {
    const s = sweep('elasticity');
    expect(s[0]?.sim.spring).toBe(0);
    expect(increasing(s.map((p) => p.sim.spring))).toBe(true);
  });

  it('persistence slows the fading of the ribbons', () => {
    const fades = sweep('persistence').map((p) => p.display.trailFade);
    expect(increasing(fades.map((f) => -f))).toBe(true);
    expect(fades[0]).toBeGreaterThan(5); // gone in a blink
    expect(fades[6]).toBeLessThan(0.3); // lingers for seconds
  });

  it('rigidity stiffens bending; dispersion tangles and scatters', () => {
    expect(increasing(sweep('rigidity').map((p) => p.sim.bend))).toBe(true);
    expect(at('rigidity', 1).sim.bend).toBeCloseTo(1, 12);
    expect(at('rigidity', 0).sim.bend).toBeGreaterThan(0);
    expect(increasing(sweep('dispersion').map((p) => p.sim.tangle))).toBe(true);
    expect(at('dispersion', 0).sim.scatter).toBe(0);
    expect(
      increasing(
        sweep('dispersion')
          .slice(1)
          .map((p) => p.sim.scatter),
      ),
    ).toBe(true);
  });

  it('brightness, intensity, length and thickness do what they say', () => {
    expect(increasing(sweep('brightness').map((p) => p.display.exposure))).toBe(true);
    expect(at('brightness', 0.5).display.exposure).toBeCloseTo(1, 12);
    expect(increasing(sweep('intensity').map((p) => p.sim.forceGain))).toBe(true);
    expect(increasing(sweep('length').map((p) => p.sim.length))).toBe(true);
    expect(increasing(sweep('thickness').map((p) => p.display.width))).toBe(true);
    expect(at('range', 0.3).sim.range).toBeCloseTo(0.3, 12);
  });

  it('density sets the count, capped by quality tier, with the same baseline everywhere', () => {
    expect(increasing([0, 0.25, 0.5, 0.75, 1].map((d) => filamentCount(d, 'high')))).toBe(true);
    for (const quality of ['draft', 'standard', 'high'] as const) {
      expect(filamentCount(1, quality)).toBe(FILAMENT_TIER_CAPS[quality]);
      expect(filamentCount(0.5, quality)).toBe(filamentCount(0.5, 'draft'));
    }
    expect(FILAMENT_TIER_CAPS).toEqual({ draft: 150, standard: 400, high: 800 });
  });

  it('falls back to the baseline for missing or broken values', () => {
    expect(filamentParams({}, 'draft')).toEqual(filamentParams(baseline, 'draft'));
    expect(filamentParams({ ...baseline, rigidity: Number.NaN }, 'draft')).toEqual(
      filamentParams(baseline, 'draft'),
    );
  });
});

function run(
  kind: SyntheticKind,
  steps: number,
  props: PropertyValues = baseline,
  seed = 1,
  quality: Quality = 'draft',
): FilamentSim {
  const sampler = createSyntheticSampler(kind);
  const params = filamentParams(props, quality).sim;
  const sim = new FilamentSim(FILAMENT_TIER_CAPS[quality], 960, 540);
  sim.reset(seed);
  for (let s = 0; s < steps; s++) sim.step(sampler.sample(s * FIXED_DT), params, FIXED_DT);
  return sim;
}

const STATE_KEYS = ['x', 'y', 'ox', 'oy', 'vx', 'vy', 'rx', 'ry', 'fx', 'fy'] as const;
const STRAND_KEYS = ['tint', 'glow', 'appear', 'segment'] as const;

function snapshot(sim: FilamentSim) {
  return [
    ...STATE_KEYS.map((k) => Array.from(sim[k].subarray(0, sim.count * N))),
    ...STRAND_KEYS.map((k) => Array.from(sim[k].subarray(0, sim.count))),
  ];
}

/** Largest relative stretch of any segment. */
function maxStretch(sim: FilamentSim): number {
  let worst = 0;
  for (let f = 0; f < sim.count; f++) {
    const segment = sim.segment[f] ?? 1;
    for (let j = 0; j < N - 1; j++) {
      const i = f * N + j;
      const d = Math.hypot(
        (sim.x[i + 1] ?? 0) - (sim.x[i] ?? 0),
        (sim.y[i + 1] ?? 0) - (sim.y[i] ?? 0),
      );
      worst = Math.max(worst, Math.abs(d - segment) / segment);
    }
  }
  return worst;
}

describe('Filaments simulation', () => {
  it('is deterministic: the same seed and frames give identical strand arrays', () => {
    const a = run('wink', 150);
    const b = run('wink', 150);
    expect(snapshot(a)).toEqual(snapshot(b));
    // reset() recreates the seeded state: a reused instance matches a fresh one.
    const sampler = createSyntheticSampler('wink');
    const params = filamentParams(baseline, 'draft').sim;
    a.reset(1);
    for (let s = 0; s < 150; s++) a.step(sampler.sample(s * FIXED_DT), params, FIXED_DT);
    expect(snapshot(a)).toEqual(snapshot(b));
  });

  it('lays out a different (equally full) field for another seed', () => {
    const a = run('still', 1, baseline, 1);
    const b = run('still', 1, baseline, 2);
    expect(b.count).toBe(a.count);
    expect(snapshot(a)).not.toEqual(snapshot(b));
  });

  it('covers the canvas evenly', () => {
    const sim = run('still', 1);
    const cells = new Array<number>(9).fill(0);
    for (let f = 0; f < sim.count; f++) {
      const i = f * N + (N >> 1);
      const cx = Math.floor(((sim.rx[i] ?? 0) / sim.worldWidth) * 3);
      const cy = Math.floor(((sim.ry[i] ?? 0) / sim.worldHeight) * 3);
      if (cx >= 0 && cx < 3 && cy >= 0 && cy < 3)
        cells[cy * 3 + cx] = (cells[cy * 3 + cx] ?? 0) + 1;
    }
    for (const c of cells) expect(c).toBeGreaterThan(sim.count / 9 / 2.5);
  });

  it('stays at rest when the signature is still', () => {
    const sim = run('still', 120);
    expect(sim.meanDisplacement()).toBeLessThan(1e-6);
    for (let i = 0; i < sim.count * N; i++) expect(Math.abs(sim.vx[i] ?? 0)).toBeLessThan(1e-4);
  });

  it('bends in the wink and keeps its strands whole and rooted', () => {
    const closing = run('wink', 54);
    expect(closing.meanDisplacement()).toBeGreaterThan(0.002);
    // Strands in the lid move down as it closes (world y up).
    let down = 0;
    let moving = 0;
    for (let i = 0; i < closing.count * N; i++) {
      const v = closing.vy[i] ?? 0;
      if (Math.abs(v) > 0.05) {
        moving++;
        if (v < 0) down++;
      }
    }
    expect(moving).toBeGreaterThan(20);
    expect(down / moving).toBeGreaterThan(0.6);
    expect(maxStretch(closing)).toBeLessThan(0.1);
    for (let f = 0; f < closing.count; f++) {
      expect(closing.x[f * N]).toBe(closing.rx[f * N]);
      expect(closing.y[f * N]).toBe(closing.ry[f * N]);
    }
  });

  it('elasticity springs the strands back to rest after the wink', () => {
    const loose = run('wink', 330, { ...baseline, elasticity: 0 }).meanDisplacement();
    const springy = run('wink', 330, { ...baseline, elasticity: 1 }).meanDisplacement();
    expect(springy).toBeLessThan(loose * 0.3);
  });

  it('rigidity keeps the resting curve while the wink pushes', () => {
    const curveError = (sim: FilamentSim) => {
      let sum = 0;
      for (let f = 0; f < sim.count; f++) {
        for (let j = 1; j < N - 1; j++) {
          const b = f * N + j;
          const cx = (sim.x[b + 1] ?? 0) - (sim.x[b - 1] ?? 0);
          const cy = (sim.y[b + 1] ?? 0) - (sim.y[b - 1] ?? 0);
          const along = sim.restAlong[b] ?? 0;
          const across = sim.restAcross[b] ?? 0;
          const tx = 0.5 * ((sim.x[b - 1] ?? 0) + (sim.x[b + 1] ?? 0)) + along * cx - across * cy;
          const ty = 0.5 * ((sim.y[b - 1] ?? 0) + (sim.y[b + 1] ?? 0)) + along * cy + across * cx;
          sum += Math.hypot((sim.x[b] ?? 0) - tx, (sim.y[b] ?? 0) - ty);
        }
      }
      return sum;
    };
    const limp = curveError(run('wink', 70, { ...baseline, rigidity: 0 }));
    const stiff = curveError(run('wink', 70, { ...baseline, rigidity: 1 }));
    expect(stiff).toBeLessThan(limp * 0.3);
  });

  it('draws each strand from its own seed, whatever the count', () => {
    const sparse = run('still', 1, { ...baseline, density: 0.2 });
    const dense = run('still', 1, { ...baseline, density: 0.6 });
    expect(sparse.count).toBeLessThan(dense.count);
    for (let i = 0; i < N; i++) {
      expect(sparse.rx[i]).toBe(dense.rx[i]);
      expect(sparse.ry[i]).toBe(dense.ry[i]);
    }
  });

  it('follows Density and Length during play', () => {
    const sampler = createSyntheticSampler('still');
    const sim = new FilamentSim(FILAMENT_TIER_CAPS.draft, 960, 540);
    sim.reset(1);
    const few = filamentParams({ ...baseline, density: 0.3 }, 'draft').sim;
    const more = filamentParams({ ...baseline, density: 0.5 }, 'draft').sim;
    for (let s = 0; s < 5; s++) sim.step(sampler.sample(s * FIXED_DT), few, FIXED_DT);
    const before = sim.count;
    sim.step(sampler.sample(5 * FIXED_DT), more, FIXED_DT);
    expect(sim.count).toBe(more.count);
    // New strands fade in.
    expect(sim.appear[before]).toBeLessThan(0.1);
    for (let s = 6; s < 60; s++) sim.step(sampler.sample(s * FIXED_DT), more, FIXED_DT);
    expect(sim.appear[before]).toBe(1);
    // A new Length reshapes every strand at once, keeping segments (nearly) whole while
    // the strands take up their new resting curves.
    const longer = filamentParams({ ...baseline, density: 0.5, length: 0.8 }, 'draft').sim;
    sim.step(sampler.sample(60 * FIXED_DT), longer, FIXED_DT);
    expect(sim.segment[0]).toBeCloseTo(longer.length / (N - 1), 12);
    expect(maxStretch(sim)).toBeLessThan(0.05);
  });

  it('stays finite at every extreme', () => {
    for (const value of [0, 1]) {
      const props: PropertyValues = {};
      for (const def of FILAMENTS_PROPERTIES) props[def.id] = value;
      const sim = run('wink', 150, props, 5, 'draft');
      const finite = STATE_KEYS.every((key) =>
        sim[key].subarray(0, sim.count * N).every((v) => Number.isFinite(v)),
      );
      expect(finite).toBe(true);
    }
  });
});
