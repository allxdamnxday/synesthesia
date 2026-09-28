import { describe, expect, it } from 'vitest';
import {
  baselineValues,
  MAX_PRIMARY_PROPERTIES,
  MAX_SPECIFIC_PROPERTIES,
} from '../../src/materials/properties';
import { ControlTimeline } from '../../src/materials/sound/shared/controlTimeline';
import { PULSE_PROPERTIES, PULSE_SOUND_META } from '../../src/materials/sound/pulse/meta';
import {
  MIN_PULSE_GAP_SEC,
  PULSE_BASE_HZ,
  SCALES,
  derivePulseParams,
  fireChance,
  pitchSnapAmount,
  pluckDecaySeconds,
  pluckNoiseSeed,
  pulseRandom,
  pulseRateRange,
  quantizeToScale,
  timeSnapAmount,
} from '../../src/materials/sound/pulse/params';
import {
  PulseProgram,
  plucksOf,
  plucksToSchedule,
  type Pluck,
  type PulseState,
} from '../../src/materials/sound/pulse/program';
import type { PropertyValues } from '../../src/materials/types';
import { createSyntheticSampler, type SyntheticKind } from '../../src/signature/synthetic';
import type { SignatureSampler } from '../../src/signature/types';

const RATE = 200;
const BASE = baselineValues(PULSE_PROPERTIES);
const params = (props: PropertyValues = {}) => derivePulseParams({ ...BASE, ...props });

function sampler(kind: SyntheticKind, config: Partial<{ strength: number; loops: number }> = {}) {
  const s = createSyntheticSampler(kind);
  s.configure({ tailSec: 1, ...config });
  return s;
}

/** Step the program from 0 over the whole timeline; every pluck it reports. */
function plucks(s: SignatureSampler, props: PropertyValues = {}, seed = 1): Pluck[] {
  const program = new PulseProgram(seed);
  program.onsets = s;
  const state: PulseState = program.createState();
  program.reset(state);
  const all = { ...BASE, ...props };
  const out: Pluck[] = [];
  for (let k = 0; k < Math.ceil(s.duration * RATE); k++) {
    program.step(state, s.sample(k / RATE), all, 1 / RATE);
    out.push(...plucksOf(state));
  }
  return out;
}

const between = (list: Pluck[], a: number, b: number) => list.filter((p) => p.t >= a && p.t < b);
const semitones = (f: number) => 12 * Math.log2(f / PULSE_BASE_HZ);

describe('A5 Pulse: properties', () => {
  it('follows the property rules (≤ 6 primary, ≤ 3 specific, plain labels)', () => {
    const primary = PULSE_PROPERTIES.filter((p) => p.primary).map((p) => p.id);
    expect(primary).toEqual([
      'rigidity',
      'range',
      'density',
      'persistence',
      'viscosity',
      'intensity',
    ]);
    expect(primary.length).toBeLessThanOrEqual(MAX_PRIMARY_PROPERTIES);
    const specific = PULSE_PROPERTIES.filter((p) => !p.shared);
    expect(specific.length).toBeLessThanOrEqual(MAX_SPECIFIC_PROPERTIES);
    expect(specific.map((p) => p.id)).toEqual(['scale']);
    expect(specific[0]?.kind).toBe('choice');
    expect(specific[0]?.choices).toEqual(['Free', 'Pentatonic', 'Whole-tone']);
    expect(SCALES).toHaveLength(3);
    // Every shared property means something here: none is hidden.
    expect(PULSE_PROPERTIES.filter((p) => p.shared)).toHaveLength(9);
    for (const p of PULSE_PROPERTIES) {
      expect(p.label).toMatch(/^[A-Z][a-z ]+$/);
      expect(p.description.length).toBeGreaterThan(10);
      expect(p.description.endsWith('.')).toBe(true);
      if (p.kind === 'continuous') expect(p.default).toBe(0.5);
    }
    expect(PULSE_SOUND_META.version).toBe(1);
    expect(PULSE_SOUND_META.id).toBe('pulse');
  });
});

describe('A5 Pulse: mapping', () => {
  it('maps each property in the direction its label promises', () => {
    const [narrowLo, narrowHi] = pulseRateRange(0);
    const [wideLo, wideHi] = pulseRateRange(1);
    expect(narrowHi / narrowLo).toBeLessThan(wideHi / wideLo);
    expect(wideHi).toBeGreaterThan(narrowHi);
    expect(wideLo).toBeLessThan(narrowLo);
    expect(params({ range: 0.9 }).pitchSpanSt).toBeGreaterThan(params({ range: 0.1 }).pitchSpanSt);
    expect(params({ density: 0.9 }).fireGain).toBeGreaterThan(params({ density: 0.1 }).fireGain);
    expect(params({ persistence: 0.9 }).decaySec).toBeGreaterThan(
      params({ persistence: 0.1 }).decaySec,
    );
    expect(params({ persistence: 0.9 }).reverbSend).toBeGreaterThan(
      params({ persistence: 0.1 }).reverbSend,
    );
    expect(params({ viscosity: 0.9 }).attackSec).toBeGreaterThan(
      params({ viscosity: 0.1 }).attackSec,
    );
    expect(params({ viscosity: 0.9 }).tone).toBeLessThan(params({ viscosity: 0.1 }).tone);
    expect(params({ viscosity: 0.9 }).pitchSlewSec).toBeGreaterThan(
      params({ viscosity: 0.1 }).pitchSlewSec,
    );
    expect(params({ viscosity: 0.9 }).rateAttackSec).toBeGreaterThan(
      params({ viscosity: 0.1 }).rateAttackSec,
    );
    expect(params({ intensity: 0.9 }).level).toBeGreaterThan(params({ intensity: 0.1 }).level);
    expect(params({ intensity: 0.9 }).drive).toBeGreaterThan(params({ intensity: 0.1 }).drive);
    expect(params({ elasticity: 0.9 }).bendSt).toBeGreaterThan(params({ elasticity: 0.1 }).bendSt);
    expect(params({ elasticity: 0 }).bendSt).toBe(0);
    expect(params({ brightness: 0.9 }).tone).toBeGreaterThan(params({ brightness: 0.1 }).tone);
    expect(params({ brightness: 0.9 }).cutoffHz).toBeGreaterThan(
      params({ brightness: 0.1 }).cutoffHz,
    );
    expect(params({ dispersion: 0.9 }).panScatter).toBeGreaterThan(
      params({ dispersion: 0.1 }).panScatter,
    );
    expect(params({ dispersion: 0.9 }).detuneCents).toBeGreaterThan(
      params({ dispersion: 0.1 }).detuneCents,
    );
    expect(params({ rigidity: 0.9 }).attackSec).toBeLessThan(params({ rigidity: 0.1 }).attackSec);
    expect(params({ rigidity: 0.9 }).tone).toBeGreaterThan(params({ rigidity: 0.1 }).tone);
    expect(params({ scale: 0 }).scale).toBeNull();
    expect(params({ scale: 2 }).scale).toEqual([0, 2, 4, 6, 8, 10]);
  });

  it('Rigidity locks pitch first, then timing', () => {
    expect(pitchSnapAmount(0.1)).toBe(0);
    expect(pitchSnapAmount(0.5)).toBe(1);
    expect(timeSnapAmount(0.5)).toBe(0);
    expect(timeSnapAmount(0.95)).toBe(1);
    expect(timeSnapAmount(0.7)).toBeGreaterThan(0);
  });

  it('snaps to the scale, including across octaves', () => {
    const pentatonic = SCALES[1] ?? [];
    const wholeTone = SCALES[2] ?? [];
    expect(
      [0.4, 1.2, 2.9, 5.4, 6.1, 8.2, 10.4, 11.4].map((s) => quantizeToScale(s, pentatonic)),
    ).toEqual([0, 2, 2, 4, 7, 9, 9, 12]);
    expect(quantizeToScale(-1.2, pentatonic)).toBe(0);
    expect(quantizeToScale(-1.8, pentatonic)).toBe(-3);
    expect([0.9, 3.2, 5.1, 7.4, 11.2].map((s) => quantizeToScale(s, wholeTone))).toEqual([
      0, 4, 6, 8, 12,
    ]);
  });

  it('draws seeded values without generator state', () => {
    expect(pulseRandom(7, 140, 0)).toBe(pulseRandom(7, 140, 0));
    expect(pulseRandom(7, 140, 0)).not.toBe(pulseRandom(8, 140, 0));
    expect(pulseRandom(7, 140, 0)).not.toBe(pulseRandom(7, 141, 0));
    const seedValue = pluckNoiseSeed(7, 140);
    expect(Number.isInteger(seedValue)).toBe(true);
    expect(seedValue).toBeLessThan(2 ** 24);
    expect(Math.fround(seedValue)).toBe(seedValue);
  });

  it('pulses sound more often with more movement density and energy', () => {
    const p = params();
    expect(fireChance(p, 0.9, 0.9)).toBeGreaterThan(fireChance(p, 0.2, 0.9));
    expect(fireChance(p, 0.9, 0.9)).toBeGreaterThan(fireChance(p, 0.9, 0.05));
    expect(fireChance(p, 0, 1)).toBe(0);
    expect(fireChance(p, 1, 0)).toBe(0);
  });

  it('higher notes ring a little shorter', () => {
    const p = params();
    expect(pluckDecaySeconds(p, 880)).toBeLessThan(pluckDecaySeconds(p, 220));
    expect(pluckDecaySeconds(p, PULSE_BASE_HZ)).toBeCloseTo(p.decaySec, 12);
  });

  it('falls back to the baseline for missing or broken values, and clamps', () => {
    expect(derivePulseParams({})).toEqual(params());
    expect(params({ brightness: Number.NaN })).toEqual(params());
    expect(params({ intensity: 7 })).toEqual(params({ intensity: 1 }));
    expect(params({ scale: 9 }).scale).toEqual(SCALES[2]);
  });
});

describe('A5 Pulse: control program', () => {
  it('is deterministic, and the seed changes the pattern', () => {
    const wink = sampler('sweep');
    expect(plucks(wink)).toEqual(plucks(wink));
    expect(plucks(wink, {}, 2)).not.toEqual(plucks(wink, {}, 1));
  });

  it('stays silent for a still signature', () => {
    expect(plucks(sampler('still'))).toEqual([]);
  });

  it('plucks the wink close and open at their exact onset times (SPEC 9.3)', () => {
    const s = sampler('wink');
    const onsets = s.onsetsBetween(0, s.duration);
    expect(onsets).toHaveLength(2);
    for (const seed of [1, 2, 3, 4, 5]) {
      const list = plucks(s, {}, seed);
      for (const onset of onsets) {
        const accent = list.find((p) => p.accent && Math.abs(p.t - onset) < 1e-9);
        expect(accent, `seed ${seed}: accent at ${onset}`).toBeDefined();
        expect(accent?.velocity).toBeGreaterThan(0.85);
      }
      // Nothing before the movement, nothing in the tail, and the accent is the first pluck
      // of each gesture.
      expect(between(list, 0, 0.54)).toEqual([]);
      expect(between(list, 1.6, 10)).toEqual([]);
      expect(between(list, 1.05, (onsets[1] ?? 0) - 1e-9)).toEqual([]);
    }
  });

  it('keeps plucks apart and in time order', () => {
    for (const kind of ['wink', 'sweep', 'swirl'] as const) {
      const variants: PropertyValues[] = [{}, { density: 1, range: 1 }, { rigidity: 0.8 }];
      for (const props of variants) {
        const list = plucks(sampler(kind), props);
        for (let i = 1; i < list.length; i++) {
          expect(list[i]?.t ?? 0).toBeGreaterThan((list[i - 1]?.t ?? 0) + MIN_PULSE_GAP_SEC - 1e-9);
        }
      }
    }
  });

  it('pulses faster as the movement gathers energy', () => {
    const count = (strength: number) =>
      plucks(sampler('sweep', { strength }), { density: 1 }).length;
    expect(count(2)).toBeGreaterThan(count(0.5));
    // Within one movement: the sweep's fast rise pulses faster than its slow crossing.
    const list = plucks(sampler('sweep'), { density: 1, range: 1 });
    const crossing = between(list, 0.4, 1.6).length / 1.2;
    const rise = between(list, 1.95, 2.45).length / 0.5;
    expect(rise).toBeGreaterThan(crossing);
  });

  it('Density thins or fills the pulse', () => {
    const s = sampler('sweep');
    expect(plucks(s, { density: 0.1 }).length).toBeLessThan(plucks(s, { density: 0.9 }).length);
  });

  it('high Rigidity lands every pluck on the steady grid; low Rigidity leaves them free', () => {
    const s = sampler('sweep');
    const onGrid = (list: Pluck[], hz: number) =>
      list.every((p) => Math.abs(p.t * hz - Math.round(p.t * hz)) < 1e-6);
    const rigid = plucks(s, { rigidity: 1 });
    expect(rigid.length).toBeGreaterThan(4);
    expect(onGrid(rigid, params({ rigidity: 1 }).gridHz)).toBe(true);
    const free = plucks(s, { rigidity: 0.5 });
    expect(onGrid(free, params({ rigidity: 0.5 }).gridHz)).toBe(false);
    // The wink's accents move onto the grid too (a finding: rigid timing blurs the moment).
    const wink = plucks(sampler('wink'), { rigidity: 1 });
    expect(onGrid(wink, params({ rigidity: 1 }).gridHz)).toBe(true);
  });

  it('plays higher for higher movement, snapped to the Scale', () => {
    // Sweep: the crossing sits low in the frame, the rise higher.
    const list = plucks(sampler('sweep'), { density: 1 });
    const crossing = between(list, 0.4, 1.6).map((p) => semitones(p.freq));
    const rise = between(list, 2.0, 2.6).map((p) => semitones(p.freq));
    expect(Math.min(...rise)).toBeGreaterThan(Math.max(...crossing));
    // Pentatonic at baseline: every note within detune of the scale.
    const detune = params().detuneCents / 100;
    for (const st of [...crossing, ...rise]) {
      expect(Math.abs(st - quantizeToScale(st, SCALES[1] ?? []))).toBeLessThanOrEqual(
        detune + 1e-9,
      );
    }
    // Free scale: at least one note clearly off the scale.
    const free = plucks(sampler('sweep'), { density: 1, scale: 0, dispersion: 0 });
    expect(
      free.some((p) => {
        const st = semitones(p.freq);
        return Math.abs(st - quantizeToScale(st, SCALES[1] ?? [])) > 0.3;
      }),
    ).toBe(true);
  });

  it('pans toward where the movement is', () => {
    const list = plucks(sampler('sweep'), { density: 1, dispersion: 0 });
    const early = between(list, 0.4, 0.9).map((p) => p.pan);
    const late = between(list, 1.2, 1.7).map((p) => p.pan);
    expect(Math.max(...early)).toBeLessThan(Math.min(...late));
  });
});

describe('A5 Pulse: scheduling across windows', () => {
  interface Scheduled {
    ctx: number;
    freq: number;
    seed: number;
  }

  /** The material's scheduling logic with a fake event lane (see pulse.ts). */
  function lane(s: SignatureSampler) {
    const program = new PulseProgram(1);
    program.onsets = s;
    const timeline = new ControlTimeline(program, { historySec: 1, maxFastForwardSec: 60 });
    const events: Scheduled[] = [];
    return {
      events,
      schedule(t0: number, t1: number, ctx0: number, props: PropertyValues = {}) {
        let continued = true;
        let first = true;
        const offset = ctx0 - t0;
        timeline.schedule(
          {
            sampler: s,
            props: { ...BASE, ...props },
            t0,
            t1,
            ctxTimeAtT0: ctx0,
            controlRate: RATE,
          },
          {
            begin: (mode) => {
              continued = mode === 'continue';
            },
            point: (_ctx, state) => {
              for (const p of plucksToSchedule(state, first, continued, t0)) {
                events.push({ ctx: p.t + offset, freq: p.freq, seed: p.seed });
              }
              first = false;
            },
          },
        );
      },
      cancelFrom(ctx: number) {
        timeline.cancelFrom(ctx);
        for (let i = events.length - 1; i >= 0; i--) {
          if ((events[i]?.ctx ?? 0) >= ctx - 1e-9) events.splice(i, 1);
        }
      },
    };
  }

  const byTime = (list: Scheduled[]) => [...list].sort((a, b) => a.ctx - b.ctx);

  it('writes the same plucks for one window or many (preview = offline)', () => {
    const s = sampler('sweep', { loops: 2 });
    const single = lane(s);
    single.schedule(0, s.duration, 0);
    expect(single.events.length).toBeGreaterThan(8);
    for (const size of [0.05, 0.037, 0.2]) {
      const many = lane(s);
      for (let t = 0; t < s.duration; t += size) {
        const end = Math.min(s.duration, t + size);
        many.schedule(t, end, t);
      }
      expect(many.events).toEqual(single.events);
    }
  });

  it('a live edit reschedules from the edit without losing or doubling plucks', () => {
    const s = sampler('sweep');
    const offset = 5;
    const live = lane(s);
    live.schedule(0, 1.6, offset);
    const cancelAt = 1.2345 + offset;
    live.cancelFrom(cancelAt);
    live.schedule(1.2345, 2.5, cancelAt);
    const reference = lane(s);
    reference.schedule(0, 2.5, offset);
    const got = byTime(live.events);
    const want = byTime(reference.events);
    expect(got.map((e) => e.ctx)).toHaveLength(want.length);
    got.forEach((e, i) => {
      expect(e.ctx).toBeCloseTo(want[i]?.ctx ?? 0, 9);
      expect(e.seed).toBe(want[i]?.seed);
    });
  });

  it('a seek skips what is past and plays on exactly as from the start', () => {
    const s = sampler('sweep');
    const live = lane(s);
    live.schedule(0, 0.5, 2);
    live.cancelFrom(2.3);
    live.schedule(1.1, 2.5, 2.3);
    const after = live.events.filter((e) => e.ctx >= 2.3);
    const reference = lane(s);
    reference.schedule(0, 2.5, 0);
    const want = reference.events.filter((e) => e.ctx >= 1.1 - 1e-9);
    expect(after.map((e) => e.ctx - 1.2)).toHaveLength(want.length);
    after.forEach((e, i) => expect(e.ctx - 1.2).toBeCloseTo(want[i]?.ctx ?? 0, 9));
  });
});
