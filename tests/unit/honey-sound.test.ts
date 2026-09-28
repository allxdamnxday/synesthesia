import { describe, expect, it } from 'vitest';
import {
  baselineValues,
  MAX_PRIMARY_PROPERTIES,
  MAX_SPECIFIC_PROPERTIES,
} from '../../src/materials/properties';
import { HONEY_PROPERTIES, HONEY_SOUND_META } from '../../src/materials/sound/honey/meta';
import {
  deriveHoneyParams,
  HONEY_BASE_HZ,
  honeyVariation,
  stutterDepthAmount,
  VOICE_RATIOS,
} from '../../src/materials/sound/honey/params';
import {
  FIRE_SURGE,
  HoneyProgram,
  STUTTER_EDGE,
  STUTTER_FALL_AT,
  stutterGate,
  stutterRateHz,
  syllableRestartPhase,
  type HoneyState,
} from '../../src/materials/sound/honey/program';
import type { PropertyValues } from '../../src/materials/types';
import { createSyntheticSampler, type SyntheticKind } from '../../src/signature/synthetic';
import type { SamplerConfig } from '../../src/signature/types';

const RATE = 200;
const BASE = baselineValues(HONEY_PROPERTIES);

interface Trace {
  amp: number[];
  env: number[];
  pitch: number[];
  cutoff: number[];
  pan: number[];
  rate: number[];
  gate: number[];
  flow: number[];
}

/** Step the control program over a synthetic movement at the control rate. */
function run(
  kind: SyntheticKind,
  props: PropertyValues = {},
  seconds = 3,
  seed = 1,
  config: Partial<SamplerConfig> = {},
): Trace {
  const sampler = createSyntheticSampler(kind);
  sampler.configure({ tailSec: 3, ...config });
  const program = new HoneyProgram(honeyVariation(seed));
  const s: HoneyState = program.createState();
  program.reset(s);
  const all = { ...BASE, ...props };
  const trace: Trace = {
    amp: [],
    env: [],
    pitch: [],
    cutoff: [],
    pan: [],
    rate: [],
    gate: [],
    flow: [],
  };
  const steps = Math.round(seconds * RATE);
  for (let k = 0; k < steps; k++) {
    program.step(s, sampler.sample(k / RATE), all, 1 / RATE);
    trace.amp.push(s.amp);
    trace.env.push(s.env);
    trace.pitch.push(s.pitchCents / 100);
    trace.cutoff.push(s.cutoffCents);
    trace.pan.push(s.panOut);
    trace.rate.push(s.rateHz);
    trace.gate.push(s.gate);
    trace.flow.push(s.flow);
  }
  return trace;
}

const idx = (t: number): number => Math.round(t * RATE);
const at = (series: number[], t: number): number => series[idx(t)] ?? 0;
const part = (series: number[], a: number, b: number): number[] => series.slice(idx(a), idx(b));
const maxIn = (series: number[], a: number, b: number): number => Math.max(...part(series, a, b));
const minIn = (series: number[], a: number, b: number): number => Math.min(...part(series, a, b));
const meanIn = (series: number[], a: number, b: number): number => {
  const p = part(series, a, b);
  return p.reduce((x, y) => x + y, 0) / p.length;
};
const dB = (ratio: number): number => 20 * Math.log10(ratio);

describe('A2 Honey: properties', () => {
  it('follows the property rules (≤ 6 primary, ≤ 3 specific, plain labels)', () => {
    const primary = HONEY_PROPERTIES.filter((p) => p.primary).map((p) => p.id);
    expect(primary).toEqual([
      'viscosity',
      'elasticity',
      'persistence',
      'brightness',
      'intensity',
      'stutterDepth',
    ]);
    expect(primary.length).toBeLessThanOrEqual(MAX_PRIMARY_PROPERTIES);
    const specific = HONEY_PROPERTIES.filter((p) => !p.shared);
    expect(specific.length).toBeLessThanOrEqual(MAX_SPECIFIC_PROPERTIES);
    expect(specific.map((p) => [p.id, p.label, p.kind, p.default])).toEqual([
      ['stutterDepth', 'Stutter depth', 'continuous', 0.5],
    ]);
    // Rigidity is hidden (honey has no rigid state); the rest of the vocabulary is there.
    const ids = HONEY_PROPERTIES.map((p) => p.id);
    expect(ids).not.toContain('rigidity');
    expect(ids).toEqual(expect.arrayContaining(['dispersion', 'density', 'range']));
    for (const p of HONEY_PROPERTIES) {
      expect(p.label).toMatch(/^[A-Z][a-z ]+$/);
      expect(p.description.length).toBeGreaterThan(10);
      expect(p.description.endsWith('.')).toBe(true);
      if (p.kind === 'continuous') expect(p.default).toBe(0.5);
    }
    expect(HONEY_SOUND_META.version).toBe(1);
    expect(HONEY_SOUND_META.id).toBe('honey');
  });

  it('maps each property in the direction its name promises', () => {
    const v = honeyVariation(1);
    const p = (props: PropertyValues) => deriveHoneyParams({ ...BASE, ...props }, v);
    const lo = (id: string) => p({ [id]: 0.1 });
    const hi = (id: string) => p({ [id]: 0.9 });
    // Viscosity: heavy slew (long range), softer attacks, darker, slower stutter.
    expect(hi('viscosity').glideSec).toBeGreaterThan(lo('viscosity').glideSec * 5);
    expect(hi('viscosity').glideSec).toBeGreaterThan(1);
    expect(hi('viscosity').flowFallSec).toBeGreaterThan(lo('viscosity').flowFallSec);
    expect(hi('viscosity').attackSec).toBeGreaterThan(lo('viscosity').attackSec);
    expect(hi('viscosity').cutoffHz).toBeLessThan(lo('viscosity').cutoffHz);
    expect(hi('viscosity').rateHiHz).toBeLessThan(lo('viscosity').rateHiHz);
    // Elasticity: resonance and glide overshoot.
    expect(hi('elasticity').resonance).toBeGreaterThan(lo('elasticity').resonance * 3);
    expect(hi('elasticity').glideQ).toBeGreaterThan(lo('elasticity').glideQ);
    // Persistence: longer release and reverb.
    expect(hi('persistence').releaseSec).toBeGreaterThan(lo('persistence').releaseSec);
    expect(hi('persistence').reverbSend).toBeGreaterThan(lo('persistence').reverbSend);
    expect(hi('persistence').reverbDecaySec).toBeGreaterThan(lo('persistence').reverbDecaySec);
    // Dispersion: wider stereo spread, and detune only above the baseline.
    expect(hi('dispersion').voicePan[1]).toBeGreaterThan(lo('dispersion').voicePan[1]);
    expect(p({}).voiceDetune[1]).toBeCloseTo(p({}).voiceDetune[0], 12);
    expect(hi('dispersion').voiceDetune[1] - hi('dispersion').voiceDetune[0]).toBeGreaterThan(10);
    // Brightness: cutoff and saw.
    expect(hi('brightness').cutoffHz).toBeGreaterThan(lo('brightness').cutoffHz * 4);
    expect(hi('brightness').sawMix).toBeGreaterThan(lo('brightness').sawMix);
    // Intensity: level and drive.
    expect(hi('intensity').level).toBeGreaterThan(lo('intensity').level);
    expect(hi('intensity').drive).toBeGreaterThan(lo('intensity').drive);
    // Range: pitch travel.
    expect(hi('range').rangeSt).toBeGreaterThan(lo('range').rangeSt);
    // Density: one to four voices.
    expect(p({ density: 0 }).voiceLevels.slice(1)).toEqual([0, 0, 0]);
    expect(p({ density: 1 }).voiceLevels.every((l) => l > 0)).toBe(true);
    // Stutter depth: 0 = smooth, 1 = fully separated syllables.
    expect(p({ stutterDepth: 0 }).stutterDepth).toBe(0);
    expect(p({ stutterDepth: 1 }).stutterDepth).toBe(1);
    expect(hi('stutterDepth').stutterDepth).toBeGreaterThan(lo('stutterDepth').stutterDepth);
  });

  it('keeps the hum low and the stacked voices on harmonics', () => {
    expect(HONEY_BASE_HZ).toBe(110);
    expect([...VOICE_RATIOS]).toEqual([1, 2, 1.5, 0.5]);
    const levels = deriveHoneyParams(BASE, honeyVariation(1)).voiceLevels;
    // Power stays level as voices are added.
    const power = (ls: readonly number[]) => ls.reduce((a, l) => a + l * l, 0);
    expect(power(levels)).toBeCloseTo(1, 9);
    expect(
      power(deriveHoneyParams({ ...BASE, density: 1 }, honeyVariation(1)).voiceLevels),
    ).toBeCloseTo(1, 9);
  });

  it('falls back to the baseline for missing or broken values, and clamps', () => {
    const v = honeyVariation(3);
    expect(deriveHoneyParams({}, v)).toEqual(deriveHoneyParams(BASE, v));
    expect(deriveHoneyParams({ ...BASE, viscosity: Number.NaN }, v)).toEqual(
      deriveHoneyParams(BASE, v),
    );
    expect(deriveHoneyParams({ ...BASE, stutterDepth: 4 }, v)).toEqual(
      deriveHoneyParams({ ...BASE, stutterDepth: 1 }, v),
    );
    expect(stutterDepthAmount(-1)).toBe(0);
  });
});

describe('A2 Honey: stutter', () => {
  it('is a smooth square: rises, holds open, falls, rests', () => {
    expect(stutterGate(0)).toBeCloseTo(0, 12);
    expect(stutterGate(STUTTER_EDGE)).toBeCloseTo(1, 12);
    expect(stutterGate((STUTTER_EDGE + STUTTER_FALL_AT) / 2)).toBe(1);
    expect(stutterGate(STUTTER_FALL_AT + STUTTER_EDGE)).toBeCloseTo(0, 12);
    expect(stutterGate(0.95)).toBe(0);
    expect(stutterGate(1.3)).toBeCloseTo(stutterGate(0.3), 12);
    // Continuous everywhere, including across the wrap.
    let worst = 0;
    for (let x = 0; x < 2; x += 0.001) {
      worst = Math.max(worst, Math.abs(stutterGate(x + 0.001) - stutterGate(x)));
    }
    expect(worst).toBeLessThan(0.01);
  });

  it('starts a new syllable on an onset without a jump in level', () => {
    for (let x = 0; x < 1; x += 0.01) {
      const restarted = syllableRestartPhase(x);
      expect(stutterGate(restarted)).toBeCloseTo(stutterGate(x), 9);
      // It lands on the rising edge or at the start of the open span, never later.
      expect(restarted).toBeLessThanOrEqual(STUTTER_EDGE + 1e-12);
    }
    // An open syllable restarts its full open span.
    expect(syllableRestartPhase(0.5)).toBe(STUTTER_EDGE);
  });

  it('stutters faster with more movement', () => {
    const p = deriveHoneyParams(BASE, honeyVariation(1));
    const rates = [0, 0.25, 0.5, 0.75, 1].map((f) => stutterRateHz(p, f));
    for (let i = 1; i < rates.length; i++) expect(rates[i]).toBeGreaterThan(rates[i - 1] ?? 0);
    expect(rates[0]).toBeCloseTo(p.rateLoHz, 12);
    expect(rates[4]).toBeCloseTo(p.rateHiHz, 12);
    expect(p.rateHiHz / p.rateLoHz).toBeGreaterThan(3);
  });
});

describe('A2 Honey: control program', () => {
  it('is deterministic, and each seed stutters a little differently', () => {
    expect(run('wink')).toEqual(run('wink'));
    expect(run('wink', {}, 3, 2).amp).not.toEqual(run('wink').amp);
  });

  it('stays silent for a still signature', () => {
    expect(Math.max(...run('still').amp)).toBe(0);
  });

  it('lets the wink be heard as two gestures, each starting with its own "Broo" (SPEC 9.3)', () => {
    // Without the stutter, the envelope shows the two gestures and the gap between them.
    const smooth = run('wink', { stutterDepth: 0 }, 2.4);
    const close = maxIn(smooth.amp, 0.6, 0.98);
    const gap = minIn(smooth.amp, 1.05, 1.25);
    const open = maxIn(smooth.amp, 1.2, 1.55);
    expect(close).toBeGreaterThan(0.2);
    expect(open).toBeGreaterThan(0.2);
    expect(dB(Math.min(close, open) / gap)).toBeGreaterThan(9);
    // At baseline the open onset closes the sound briefly (the "B") before the new syllable.
    const t = run('wink', {}, 2.4);
    const before = minIn(t.amp, 1.12, 1.25);
    expect(dB(maxIn(t.amp, 1.2, 1.5) / before)).toBeGreaterThan(12);
    expect(dB(maxIn(t.amp, 0.6, 0.98) / before)).toBeGreaterThan(12);
  });

  it('stutters faster while the movement is strong, and slows as the honey settles', () => {
    const t = run('wink', {}, 3.2);
    expect(meanIn(t.rate, 0.75, 0.9)).toBeGreaterThan(5);
    expect(meanIn(t.rate, 2.5, 3.2)).toBeLessThan(3.5);
    // A stronger signature (faster movement) stutters faster.
    const slow = run('wink', {}, 3.2, 1, { strength: 0.5 });
    const fast = run('wink', {}, 3.2, 1, { strength: 1.5 });
    expect(meanIn(fast.rate, 0.7, 1.5)).toBeGreaterThan(meanIn(slow.rate, 0.7, 1.5) + 1);
  });

  it('glides down at the end of each movement (the "oot"), and lags behind it', () => {
    const t = run('wink', {}, 3.2);
    // The close ends lower than it began, before the open starts.
    expect(at(t.pitch, 1.18)).toBeLessThan(maxIn(t.pitch, 0.6, 0.9) - 1.5);
    // The open lifts the pitch (moving up raises it), but only after a lag.
    const openPeak = maxIn(t.pitch, 1.3, 2);
    expect(openPeak).toBeGreaterThan(at(t.pitch, 1.2) + 3);
    expect(t.pitch.indexOf(openPeak) / RATE).toBeGreaterThan(1.5);
    // Then it falls away as the honey settles: the final "oot".
    expect(minIn(t.pitch, 2, 2.6)).toBeLessThan(openPeak - 3);
    // A wider Range makes a deeper fall.
    const wide = run('wink', { range: 1 }, 3.2);
    const narrow = run('wink', { range: 0 }, 3.2);
    const fall = (x: Trace) => maxIn(x.pitch, 1.3, 2) - minIn(x.pitch, 2, 2.6);
    expect(fall(wide)).toBeGreaterThan(fall(narrow) * 2);
  });

  it('never jumps in level: the stutter and the "B" are smooth', () => {
    // Even at the fastest stutter (thinnest honey, fastest seed) a syllable's edge lasts
    // over 15 ms.
    let fastest = 0;
    for (let seed = 0; seed < 50; seed++) {
      fastest = Math.max(
        fastest,
        deriveHoneyParams({ viscosity: 0 }, honeyVariation(seed)).rateHiHz,
      );
    }
    expect((STUTTER_EDGE / fastest) * 1000).toBeGreaterThan(15);
    // No 5 ms control step moves the level by more than a third of its peak: every change is
    // a fade of several steps (a click would be the whole level at once).
    const cases: PropertyValues[] = [{}, { stutterDepth: 1 }, { viscosity: 0, persistence: 0 }];
    for (const props of cases) {
      const t = run('wink', props, 3);
      const peak = Math.max(...t.amp);
      let worst = 0;
      for (let i = 1; i < t.amp.length; i++) {
        worst = Math.max(worst, Math.abs((t.amp[i] ?? 0) - (t.amp[i - 1] ?? 0)));
      }
      expect(worst / peak, JSON.stringify(props)).toBeLessThan(1 / 3);
    }
  });

  it('draws the sound out after the movement, longer with Viscosity and Persistence', () => {
    const t = run('wink', {}, 3.2);
    const peak = Math.max(...t.env);
    // Still sounding half a second after the open ends, but fading.
    expect(dB(at(t.env, 2) / peak)).toBeGreaterThan(-24);
    expect(at(t.env, 3)).toBeLessThan(at(t.env, 2));
    const tail = (x: Trace) => meanIn(x.env, 1.8, 2.8) / Math.max(...x.env);
    expect(tail(run('wink', { viscosity: 0.9 }, 3.2))).toBeGreaterThan(
      tail(run('wink', { viscosity: 0.1 }, 3.2)),
    );
    expect(tail(run('wink', { persistence: 0.9 }, 3.2))).toBeGreaterThan(
      tail(run('wink', { persistence: 0.1 }, 3.2)),
    );
  });

  it('opens the filter with the movement, and darkens as the honey draws out', () => {
    const t = run('wink', {}, 3);
    // At rest the syllables' "wah" moves the filter by less than an octave.
    const rest = maxIn(t.cutoff, 0.2, 0.55);
    expect(rest).toBeLessThanOrEqual(0);
    expect(minIn(t.cutoff, 0.2, 0.55)).toBeGreaterThan(-1200);
    // The movement opens it by an octave or more.
    expect(maxIn(t.cutoff, 0.7, 0.95)).toBeGreaterThan(rest + 1200);
    // The drawn-out tail is darker than the movement, though still sounding.
    expect(maxIn(t.cutoff, 2, 2.6)).toBeLessThan(maxIn(t.cutoff, 1.25, 1.5) - 600);
  });

  it('starts a new "Broo" once per sudden gathering, not on slow ones', () => {
    /** Times (s) where the program fires its onset accent. */
    const fires = (kind: SyntheticKind, seconds: number): number[] => {
      const sampler = createSyntheticSampler(kind);
      const program = new HoneyProgram(honeyVariation(1));
      const s = program.createState();
      program.reset(s);
      const out: number[] = [];
      let last = 0;
      for (let k = 0; k < seconds * RATE; k++) {
        program.step(s, sampler.sample(k / RATE), BASE, 1 / RATE);
        if (s.accent > last + 1e-9) out.push(k / RATE);
        last = s.accent;
      }
      return out;
    };
    // The wink: the close and the open, each near its onset (0.70 s and 1.23 s).
    const wink = fires('wink', 2.2);
    expect(wink.length).toBe(2);
    expect(Math.abs((wink[0] ?? 0) - 0.66)).toBeLessThan(0.08);
    expect(Math.abs((wink[1] ?? 0) - 1.2)).toBeLessThan(0.08);
    // The sweep gathers slowly as it crosses (normalized surge < FIRE_SURGE), then suddenly
    // as it rises: one "Broo", at the rise.
    const sweep = fires('sweep', 2.8);
    expect(FIRE_SURGE).toBeGreaterThan(0.35);
    expect(sweep.length).toBe(1);
    expect(sweep[0]).toBeGreaterThan(1.8);
  });

  it('pans toward where the movement is and holds when it stops', () => {
    const t = run('sweep', { dispersion: 1 }, 3.2);
    expect(at(t.pan, 0.6)).toBeLessThan(at(t.pan, 1.5));
    expect(at(t.pan, 3.1)).toBeCloseTo(at(t.pan, 2.7), 1);
  });

  it('every continuous property changes the control output or its parameters', () => {
    for (const def of HONEY_PROPERTIES.filter((p) => p.kind === 'continuous')) {
      const lo = run('wink', { [def.id]: 0.1 }, 2.2);
      const hi = run('wink', { [def.id]: 0.9 }, 2.2);
      const params = (x: number) => deriveHoneyParams({ ...BASE, [def.id]: x }, honeyVariation(1));
      const changed =
        JSON.stringify(lo) !== JSON.stringify(hi) ||
        JSON.stringify(params(0.1)) !== JSON.stringify(params(0.9));
      expect(changed, def.id).toBe(true);
    }
  });
});
