import { describe, expect, it } from 'vitest';
import { baselineValues } from '../../src/materials/properties';
import { FIXED_DT, type PropertyValues, type Quality } from '../../src/materials/types';
import { BubbleSim, EXIT_BELOW } from '../../src/materials/visual/bubbles/BubbleSim';
import {
  BUBBLE_TIER_CAPS,
  bubbleCount,
  bubbleParams,
  bubblePopRate,
} from '../../src/materials/visual/bubbles/mapping';
import { BUBBLES_PROPERTIES } from '../../src/materials/visual/bubbles/properties';
import { createSyntheticSampler, type SyntheticKind } from '../../src/signature/synthetic';

const baseline = baselineValues(BUBBLES_PROPERTIES);
const at = (id: string, value: number, quality: Quality = 'draft') =>
  bubbleParams({ ...baseline, [id]: value }, quality);
const sweep = (id: string) => [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1].map((v) => at(id, v));

function increasing(values: number[]): boolean {
  return values.every((v, i) => i === 0 || v > (values[i - 1] ?? -Infinity));
}
function nonIncreasing(values: number[]): boolean {
  return values.every((v, i) => i === 0 || v <= (values[i - 1] ?? Infinity));
}

describe('Descending bubbles property mapping', () => {
  it('viscosity drags harder, pushes a little less, and lags', () => {
    const s = sweep('viscosity');
    expect(increasing(s.map((p) => p.sim.drag))).toBe(true);
    expect(nonIncreasing(s.map((p) => p.sim.forceGain))).toBe(true);
    // How far a push carries a bubble (gain ÷ drag) falls steeply.
    const reach = s.map((p) => p.sim.forceGain / p.sim.drag);
    expect(reach[0]).toBeGreaterThan(4 * (reach[6] ?? 0));
    expect(s[0]?.sim.lagSec).toBe(0);
    expect(increasing(s.slice(1).map((p) => p.sim.lagSec))).toBe(true);
  });

  it('elasticity adds wobble and spring-back, from none at 0', () => {
    const s = sweep('elasticity');
    expect(s[0]?.sim.spring).toBe(0);
    expect(s[0]?.sim.wobbleDrive).toBe(0);
    expect(increasing(s.map((p) => p.sim.spring))).toBe(true);
    expect(increasing(s.slice(1).map((p) => p.sim.wobbleDrive))).toBe(true);
    expect(increasing(s.map((p) => -p.sim.wobbleDamping))).toBe(true); // rings longer
  });

  it('persistence keeps touched bubbles and their glow longer', () => {
    const s = sweep('persistence');
    expect(increasing(s.map((p) => -p.sim.glowDecay))).toBe(true);
    expect(nonIncreasing(s.map((p) => p.sim.popRate))).toBe(true);
    expect(bubblePopRate(0)).toBeGreaterThan(3);
    expect(bubblePopRate(1)).toBe(0);
  });

  it('dispersion spreads the fall, adds wandering and scatters the push', () => {
    const s = sweep('dispersion');
    expect(s[0]?.sim.spread).toBe(0);
    expect(s[6]?.sim.spread).toBe(1);
    expect(increasing(s.map((p) => p.sim.walk))).toBe(true);
    expect(s[0]?.sim.scatter).toBe(0);
    expect(increasing(s.slice(1).map((p) => p.sim.scatter))).toBe(true);
  });

  it('brightness, intensity, fall speed and size do what they say', () => {
    expect(increasing(sweep('brightness').map((p) => p.display.exposure))).toBe(true);
    expect(at('brightness', 0.5).display.exposure).toBeCloseTo(1, 12);
    expect(increasing(sweep('intensity').map((p) => p.sim.forceGain))).toBe(true);
    expect(increasing(sweep('fallSpeed').map((p) => p.sim.fallSpeed))).toBe(true);
    expect(increasing(sweep('size').map((p) => p.display.radius))).toBe(true);
    expect(at('range', 0.8).sim.range).toBeCloseTo(0.8, 12);
  });

  it('density sets the count, capped by quality tier, with the same baseline everywhere', () => {
    expect(increasing([0, 0.25, 0.5, 0.75, 1].map((d) => bubbleCount(d, 'high')))).toBe(true);
    for (const quality of ['draft', 'standard', 'high'] as const) {
      expect(bubbleCount(1, quality)).toBe(BUBBLE_TIER_CAPS[quality]);
      expect(bubbleCount(0.5, quality)).toBe(bubbleCount(0.5, 'draft'));
    }
    expect(BUBBLE_TIER_CAPS).toEqual({ draft: 1500, standard: 4000, high: 8000 });
  });

  it('falls back to the baseline for missing or broken values', () => {
    expect(bubbleParams({}, 'draft')).toEqual(bubbleParams(baseline, 'draft'));
    expect(bubbleParams({ ...baseline, viscosity: Number.NaN }, 'draft')).toEqual(
      bubbleParams(baseline, 'draft'),
    );
    expect(bubbleParams({ ...baseline, brightness: 7 }, 'draft')).toEqual(
      bubbleParams({ ...baseline, brightness: 1 }, 'draft'),
    );
  });
});

/** Run the simulation along a synthetic signature. */
function run(
  kind: SyntheticKind,
  steps: number,
  props: PropertyValues = baseline,
  seed = 1,
  quality: Quality = 'draft',
): BubbleSim {
  const sampler = createSyntheticSampler(kind);
  const params = bubbleParams(props, quality).sim;
  const sim = new BubbleSim(BUBBLE_TIER_CAPS[quality], 960, 540);
  sim.reset(seed);
  for (let s = 0; s < steps; s++) sim.step(sampler.sample(s * FIXED_DT), params, FIXED_DT);
  return sim;
}

const STATE_KEYS = [
  'px',
  'py',
  'dx',
  'dy',
  'vx',
  'vy',
  'lx',
  'ly',
  'wx',
  'wy',
  'size',
  'fall',
  'fragility',
  'deflect',
  'wear',
  'gx',
  'gy',
  'wob',
  'wobV',
  'axX',
  'axY',
  'gen',
] as const;

function snapshot(sim: BubbleSim) {
  return STATE_KEYS.map((key) => Array.from(sim[key].subarray(0, sim.count)));
}

describe('Descending bubbles simulation', () => {
  it('is deterministic: the same seed and frames give identical particle arrays', () => {
    const a = run('wink', 150);
    const b = run('wink', 150);
    expect(a.count).toBe(b.count);
    expect(snapshot(a)).toEqual(snapshot(b));
    // reset() recreates the seeded state: a reused instance matches a fresh one.
    const sampler = createSyntheticSampler('wink');
    const params = bubbleParams(baseline, 'draft').sim;
    for (let s = 0; s < 40; s++) a.step(sampler.sample(s * FIXED_DT), params, FIXED_DT);
    a.reset(1);
    for (let s = 0; s < 150; s++) a.step(sampler.sample(s * FIXED_DT), params, FIXED_DT);
    expect(snapshot(a)).toEqual(snapshot(b));
  });

  it('gives a different (equally full) field for another seed', () => {
    const a = run('wink', 30, baseline, 1);
    const b = run('wink', 30, baseline, 2);
    expect(snapshot(a)).not.toEqual(snapshot(b));
    expect(b.count).toBe(a.count);
  });

  it('fills the whole height from the first step', () => {
    const sim = run('still', 1);
    const quarters = [0, 0, 0, 0];
    for (let i = 0; i < sim.count; i++) {
      const q = Math.floor(((sim.py[i] ?? 0) / sim.worldHeight) * 4);
      if (q >= 0 && q < 4) quarters[q] = (quarters[q] ?? 0) + 1;
    }
    for (const q of quarters) expect(q).toBeGreaterThan(sim.count * 0.15);
  });

  it('sinks steadily when the signature is still, and nothing is displaced', () => {
    const sampler = createSyntheticSampler('still');
    const params = bubbleParams(baseline, 'draft').sim;
    const sim = new BubbleSim(BUBBLE_TIER_CAPS.draft, 960, 540);
    sim.reset(3);
    sim.step(sampler.sample(0), params, FIXED_DT);
    const before = Array.from(sim.py.subarray(0, sim.count));
    const gen = Array.from(sim.gen.subarray(0, sim.count));
    for (let s = 1; s <= 60; s++) sim.step(sampler.sample(s * FIXED_DT), params, FIXED_DT);
    let sank = 0;
    let compared = 0;
    for (let i = 0; i < sim.count; i++) {
      expect(sim.dx[i]).toBe(0);
      expect(sim.dy[i]).toBe(0);
      if (sim.gen[i] !== gen[i]) continue; // left through the bottom and started again
      compared++;
      if ((sim.py[i] ?? 0) < (before[i] ?? 0)) sank++;
    }
    expect(compared).toBeGreaterThan(sim.count * 0.8);
    expect(sank / compared).toBeGreaterThan(0.95);
  });

  it("pushes bubbles in the wink's path down as it closes and up as it opens", () => {
    // The lid moves around field (0.5, 0.42): world x ≈ 0.89, y ≈ 0.58 on a 16:9 canvas.
    const inLid = (sim: BubbleSim, i: number) =>
      Math.abs((sim.px[i] ?? 0) + (sim.dx[i] ?? 0) - 0.89) < 0.15 &&
      Math.abs((sim.py[i] ?? 0) + (sim.dy[i] ?? 0) - 0.58) < 0.08;
    const meanVy = (sim: BubbleSim) => {
      let sum = 0;
      let n = 0;
      for (let i = 0; i < sim.count; i++) {
        if (!inLid(sim, i)) continue;
        sum += sim.vy[i] ?? 0;
        n++;
      }
      return n > 0 ? sum / n : 0;
    };
    expect(meanVy(run('wink', 48))).toBeLessThan(-0.1); // closing: down
    expect(meanVy(run('wink', 80))).toBeGreaterThan(0.05); // opening: up
    // Glow follows the push.
    const closing = run('wink', 54);
    let glowing = 0;
    for (let i = 0; i < closing.count; i++) {
      if (Math.hypot(closing.gx[i] ?? 0, closing.gy[i] ?? 0) > 0.5) glowing++;
    }
    expect(glowing).toBeGreaterThan(20);
  });

  it('elasticity springs pushed bubbles back to their paths', () => {
    const meanDisplacement = (sim: BubbleSim) => {
      let sum = 0;
      for (let i = 0; i < sim.count; i++) sum += Math.hypot(sim.dx[i] ?? 0, sim.dy[i] ?? 0);
      return sum / sim.count;
    };
    const loose = meanDisplacement(run('wink', 300, { ...baseline, elasticity: 0 }));
    const springy = meanDisplacement(run('wink', 300, { ...baseline, elasticity: 1 }));
    expect(springy).toBeLessThan(loose * 0.5);
  });

  it('persistence decides whether touched bubbles pop and re-form', () => {
    const popped = (props: PropertyValues) => {
      const sampler = createSyntheticSampler('wink');
      const params = bubbleParams(props, 'draft').sim;
      const sim = new BubbleSim(BUBBLE_TIER_CAPS.draft, 960, 540);
      sim.reset(1);
      let count = 0;
      for (let s = 0; s < 150; s++) {
        sim.step(sampler.sample(s * FIXED_DT), params, FIXED_DT);
        for (let i = 0; i < sim.count; i++) if ((sim.wear[i] ?? 0) >= 1) count++;
      }
      return count;
    };
    expect(popped({ ...baseline, persistence: 0 })).toBeGreaterThan(200);
    expect(popped({ ...baseline, persistence: 1 })).toBe(0);
  });

  it('draws its randomness per bubble, whatever the count', () => {
    // Slot 0 wanders identically in a sparse and a dense field.
    const sparse = run('still', 30, { ...baseline, density: 0.2 });
    const dense = run('still', 30, { ...baseline, density: 0.6 });
    expect(sparse.count).toBeLessThan(dense.count);
    expect(sparse.px[0]).toBe(dense.px[0]);
    expect(sparse.py[0]).toBe(dense.py[0]);
    expect(sparse.wx[0]).toBe(dense.wx[0]);
  });

  it('follows Density during play: new bubbles start above the top edge', () => {
    const sampler = createSyntheticSampler('still');
    const sim = new BubbleSim(BUBBLE_TIER_CAPS.draft, 960, 540);
    sim.reset(1);
    const few = bubbleParams({ ...baseline, density: 0.2 }, 'draft').sim;
    const many = bubbleParams({ ...baseline, density: 0.6 }, 'draft').sim;
    for (let s = 0; s < 10; s++) sim.step(sampler.sample(s * FIXED_DT), few, FIXED_DT);
    const before = sim.count;
    sim.step(sampler.sample(10 * FIXED_DT), many, FIXED_DT);
    expect(sim.count).toBe(many.count);
    for (let i = before; i < sim.count; i++) {
      expect(sim.py[i]).toBeGreaterThan(sim.worldHeight);
    }
    sim.step(sampler.sample(11 * FIXED_DT), few, FIXED_DT);
    expect(sim.count).toBe(few.count);
  });

  it('stays finite at every extreme', () => {
    for (const value of [0, 1]) {
      const props: PropertyValues = {};
      for (const def of BUBBLES_PROPERTIES) props[def.id] = value;
      const sim = run('wink', 200, props, 5, 'standard');
      for (const key of STATE_KEYS) {
        for (let i = 0; i < sim.count; i++) expect(Number.isFinite(sim[key][i])).toBe(true);
      }
      for (let i = 0; i < sim.count; i++) {
        expect(sim.py[i]).toBeGreaterThan(-EXIT_BELOW - 1);
      }
    }
  });
});
