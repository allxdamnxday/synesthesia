import { describe, expect, it } from 'vitest';
import {
  baselineValues,
  MAX_PRIMARY_PROPERTIES,
  MAX_SPECIFIC_PROPERTIES,
} from '../../src/materials/properties';
import {
  BODY_CHOICES,
  RESONANCE_PROPERTIES,
  RESONANCE_SOUND_META,
} from '../../src/materials/sound/resonance/meta';
import {
  BODIES,
  MODE_COUNT,
  deriveResonanceParams,
  harmonicReference,
  inharmonicityCents,
  malletSeconds,
  modeRatios,
  strikeVelocity,
} from '../../src/materials/sound/resonance/params';
import { ResonanceProgram, type ResonanceState } from '../../src/materials/sound/resonance/program';
import type { PropertyValues } from '../../src/materials/types';
import { createSyntheticSampler, type SyntheticKind } from '../../src/signature/synthetic';

const RATE = 200;
const BASE = baselineValues(RESONANCE_PROPERTIES);
const params = (props: PropertyValues = {}) => deriveResonanceParams({ ...BASE, ...props });

interface Trace {
  bow: number[];
  damp: number[];
  pan: number[];
}

function run(kind: SyntheticKind, props: PropertyValues = {}, seconds = 3): Trace {
  const sampler = createSyntheticSampler(kind);
  sampler.configure({ tailSec: 3 });
  const program = new ResonanceProgram();
  const s: ResonanceState = program.createState();
  program.reset(s);
  const all = { ...BASE, ...props };
  const trace: Trace = { bow: [], damp: [], pan: [] };
  for (let k = 0; k < Math.round(seconds * RATE); k++) {
    program.step(s, sampler.sample(k / RATE), all, 1 / RATE);
    trace.bow.push(s.bowOut);
    trace.damp.push(s.dampOut);
    trace.pan.push(s.panOut);
  }
  return trace;
}

const at = (series: number[], t: number): number => series[Math.round(t * RATE)] ?? 0;
const maxIn = (series: number[], a: number, b: number): number =>
  Math.max(...series.slice(Math.round(a * RATE), Math.round(b * RATE)));

/** Amplitude-weighted inharmonicity of the sounding modes for these properties. */
function inharmonicity(props: PropertyValues): number {
  const p = params(props);
  const ratios = p.freqs.map((f) => f / p.baseHz);
  return inharmonicityCents(ratios, harmonicReference(BODIES[p.body]?.ratios ?? []), p.gains);
}

describe('A4 Resonance: properties', () => {
  it('follows the property rules (≤ 6 primary, ≤ 3 specific, plain labels)', () => {
    const primary = RESONANCE_PROPERTIES.filter((p) => p.primary).map((p) => p.id);
    expect(primary).toEqual([
      'body',
      'rigidity',
      'elasticity',
      'viscosity',
      'persistence',
      'intensity',
    ]);
    expect(primary.length).toBeLessThanOrEqual(MAX_PRIMARY_PROPERTIES);
    const specific = RESONANCE_PROPERTIES.filter((p) => !p.shared);
    expect(specific.length).toBeLessThanOrEqual(MAX_SPECIFIC_PROPERTIES);
    expect(specific.map((p) => p.id)).toEqual(['body']);
    expect(specific[0]?.kind).toBe('choice');
    expect(specific[0]?.choices).toEqual(['Glass', 'Wood', 'Metal']);
    expect(BODY_CHOICES).toHaveLength(BODIES.length);
    // Every shared property means something here: none is hidden.
    expect(RESONANCE_PROPERTIES.filter((p) => p.shared)).toHaveLength(9);
    for (const p of RESONANCE_PROPERTIES) {
      expect(p.label).toMatch(/^[A-Z][a-z ]+$/);
      expect(p.description.length).toBeGreaterThan(10);
      expect(p.description.endsWith('.')).toBe(true);
      if (p.kind === 'continuous') expect(p.default).toBe(0.5);
    }
    expect(RESONANCE_SOUND_META.version).toBe(1);
    expect(RESONANCE_SOUND_META.id).toBe('resonance');
  });

  it('defines three complete bodies with ascending modes', () => {
    for (const body of BODIES) {
      expect(body.ratios).toHaveLength(MODE_COUNT);
      expect(body.amps).toHaveLength(MODE_COUNT);
      expect([...body.rank].sort((a, b) => a - b)).toEqual(
        Array.from({ length: MODE_COUNT }, (_, i) => i),
      );
      expect(body.ratios[0]).toBe(1);
      for (let i = 1; i < MODE_COUNT; i++) {
        expect(body.ratios[i]).toBeGreaterThan(body.ratios[i - 1] ?? 0);
      }
    }
  });
});

describe('A4 Resonance: the modal table', () => {
  it('uses a strictly increasing whole-number harmonic reference', () => {
    expect(harmonicReference([1, 2.32, 4.25, 6.63])).toEqual([1, 2, 4, 7]);
    expect(harmonicReference([1, 1.52, 1.97, 2.44])).toEqual([1, 2, 3, 4]);
  });

  it('Rigidity: harmonic at 0, the natural ratios at 0.5, twice as inharmonic at 1', () => {
    for (const body of BODIES) {
      const harmonic = harmonicReference(body.ratios);
      const soft = modeRatios(body, 0, 0.5);
      const natural = modeRatios(body, 0.5, 0.5);
      soft.forEach((r, i) => expect(r).toBeCloseTo(harmonic[i] ?? 0, 9));
      natural.forEach((r, i) => expect(r).toBeCloseTo(body.ratios[i] ?? 0, 9));
    }
    for (const body of [0, 1, 2]) {
      const values = [0, 0.25, 0.5, 0.75, 1].map((g) => inharmonicity({ body, rigidity: g }));
      expect(values[0]).toBeCloseTo(0, 6);
      for (let i = 1; i < values.length; i++) {
        expect(values[i]).toBeGreaterThan(values[i - 1] ?? Infinity);
      }
    }
  });

  it('Range compresses or expands the modes around the fundamental', () => {
    for (const body of [0, 1, 2]) {
      const span = (range: number) => {
        const p = params({ body, range });
        return (p.freqs[MODE_COUNT - 1] ?? 0) / (p.freqs[0] ?? 1);
      };
      expect(span(0)).toBeLessThan(span(0.5));
      expect(span(0.5)).toBeLessThan(span(1));
      expect(params({ body, range: 0.3 }).freqs[0]).toBeCloseTo(BODIES[body]?.baseHz ?? 0, 9);
    }
  });

  it('Elasticity lengthens the ring; Viscosity shortens it, most of all for high modes', () => {
    const ring = (props: PropertyValues, mode = 0) => params(props).decays[mode] ?? 0;
    expect(ring({ elasticity: 0.9 })).toBeGreaterThan(3 * ring({ elasticity: 0.1 }));
    expect(ring({ viscosity: 0.9 })).toBeLessThan(ring({ viscosity: 0.1 }));
    const highOverLow = (v: number) => ring({ viscosity: v }, 8) / ring({ viscosity: v }, 0);
    expect(highOverLow(0.9)).toBeLessThan(highOverLow(0.1));
  });

  it('Density adds modes: six at 0, twelve at 1', () => {
    for (const body of [0, 1, 2]) {
      const sounding = (density: number) => params({ body, density }).gains.filter((g) => g > 0);
      expect(sounding(0)).toHaveLength(6);
      expect(sounding(1)).toHaveLength(12);
      expect(sounding(0.5).length).toBeGreaterThan(6);
    }
  });

  it('Brightness tilts the modes toward the top; nothing sounds near Nyquist', () => {
    const tilt = (b: number) => {
      const g = params({ brightness: b }).gains;
      return (g[8] ?? 0) / (g[0] ?? 1);
    };
    expect(tilt(0.9)).toBeGreaterThan(2 * tilt(0.1));
    const low = deriveResonanceParams({ ...BASE, rigidity: 1, range: 1 }, 22050);
    low.freqs.forEach((f, i) => {
      if (f > 0.45 * 22050) expect(low.gains[i]).toBe(0);
    });
  });
});

describe('A4 Resonance: mapping directions', () => {
  it('maps each property in the direction its label promises', () => {
    expect(params({ rigidity: 0.9 }).hardness).toBeGreaterThan(params({ rigidity: 0.1 }).hardness);
    expect(params({ viscosity: 0.9 }).hardness).toBeLessThan(params({ viscosity: 0.1 }).hardness);
    expect(params({ viscosity: 0.9 }).bowAttackSec).toBeGreaterThan(
      params({ viscosity: 0.1 }).bowAttackSec,
    );
    expect(params({ viscosity: 0.9 }).cutoffHz).toBeLessThan(params({ viscosity: 0.1 }).cutoffHz);
    expect(params({ elasticity: 0.9 }).bounceCents).toBeGreaterThan(
      params({ elasticity: 0.1 }).bounceCents,
    );
    expect(params({ elasticity: 0 }).bounceCents).toBe(0);
    expect(params({ persistence: 0.9 }).dampRate).toBeLessThan(
      params({ persistence: 0.1 }).dampRate,
    );
    expect(params({ persistence: 0.9 }).reverbSend).toBeGreaterThan(
      params({ persistence: 0.1 }).reverbSend,
    );
    expect(params({ persistence: 0.9 }).reverbDecaySec).toBeGreaterThan(
      params({ persistence: 0.1 }).reverbDecaySec,
    );
    expect(params({ intensity: 0.9 }).level).toBeGreaterThan(params({ intensity: 0.1 }).level);
    expect(params({ intensity: 0.9 }).drive).toBeGreaterThan(params({ intensity: 0.1 }).drive);
    expect(params({ brightness: 0.9 }).cutoffHz).toBeGreaterThan(
      params({ brightness: 0.1 }).cutoffHz,
    );
    expect(params({ dispersion: 0.9 }).width).toBeGreaterThan(params({ dispersion: 0.1 }).width);
    expect(params({ dispersion: 0.9 }).detuneCents).toBeGreaterThan(
      params({ dispersion: 0.1 }).detuneCents,
    );
    expect(params({ body: 0 }).baseHz).toBeGreaterThan(params({ body: 1 }).baseHz);
    expect(params({ body: 1 }).baseHz).toBeGreaterThan(params({ body: 2 }).baseHz);
    expect(params({ body: 1 }).decays[0]).toBeLessThan(params({ body: 2 }).decays[0] ?? 0);
  });

  it('strikes: harder and shorter with velocity and hardness', () => {
    expect(strikeVelocity(0)).toBeCloseTo(0.45);
    expect(strikeVelocity(1)).toBe(1);
    expect(malletSeconds(0.9, 0.9)).toBeLessThan(malletSeconds(0.1, 0.9));
    expect(malletSeconds(0.5, 1)).toBeLessThan(malletSeconds(0.5, 0.5));
    expect(malletSeconds(0, 0)).toBeLessThanOrEqual(1.6e-3);
    expect(malletSeconds(1, 1)).toBeGreaterThanOrEqual(0.08e-3);
  });

  it('falls back to the baseline for missing or broken values, and clamps', () => {
    expect(deriveResonanceParams({})).toEqual(params());
    expect(params({ brightness: Number.NaN })).toEqual(params());
    expect(params({ intensity: 7 })).toEqual(params({ intensity: 1 }));
    expect(params({ body: 9 }).body).toBe(2);
    for (const def of RESONANCE_PROPERTIES.filter((d) => d.kind === 'continuous')) {
      for (const v of [0, 0.5, 1]) {
        const p = params({ [def.id]: v });
        for (const list of [p.freqs, p.decays, p.gains]) {
          for (const x of list) expect(Number.isFinite(x) && x >= 0, `${def.id}=${v}`).toBe(true);
        }
      }
    }
  });
});

describe('A4 Resonance: control program', () => {
  it('is deterministic', () => {
    expect(run('wink')).toEqual(run('wink'));
  });

  it('is silent and damped for a still signature', () => {
    const still = run('still');
    expect(Math.max(...still.bow)).toBe(0);
    expect(Math.min(...still.damp)).toBeGreaterThan(0);
  });

  it('sings while the wink moves and lifts the damper, then damps in the hold (SPEC 9.3)', () => {
    const t = run('wink', {}, 2.4);
    // Singing follows the movement: the close (0.54–1.02 s) and the open (1.08–1.54 s).
    expect(maxIn(t.bow, 0.7, 0.9)).toBeGreaterThan(0.1);
    expect(maxIn(t.bow, 1.25, 1.45)).toBeGreaterThan(0.1);
    expect(at(t.bow, 0.3)).toBe(0);
    // The damper is off while moving and back on in the hold and after the movement.
    expect(at(t.damp, 0.8)).toBeLessThan(0.05 * params().dampRate);
    expect(at(t.damp, 1.3)).toBeLessThan(0.05 * params().dampRate);
    expect(at(t.damp, 1.1)).toBeGreaterThan(0.5 * params().dampRate);
    expect(at(t.damp, 2.2)).toBeCloseTo(params().dampRate, 3);
  });

  it('Viscosity slows the singing; Persistence eases the damper', () => {
    const quick = run('wink', { viscosity: 0.1 }, 2.4);
    const slow = run('wink', { viscosity: 0.9 }, 2.4);
    expect(at(slow.bow, 0.66)).toBeLessThan(at(quick.bow, 0.66));
    const short = run('wink', { persistence: 0.1 }, 2.4);
    const long = run('wink', { persistence: 0.9 }, 2.4);
    expect(at(long.damp, 2.2)).toBeLessThan(at(short.damp, 2.2));
  });

  it('pans toward where the movement is and holds when it stops', () => {
    const t = run('sweep', { dispersion: 1 }, 3.2);
    expect(at(t.pan, 0.6)).toBeLessThan(at(t.pan, 1.5));
    expect(at(t.pan, 3.1)).toBeCloseTo(at(t.pan, 2.8), 1);
  });
});
