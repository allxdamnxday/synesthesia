import { describe, expect, it } from 'vitest';
import {
  baselineValues,
  MAX_PRIMARY_PROPERTIES,
  MAX_SPECIFIC_PROPERTIES,
} from '../../src/materials/properties';
import {
  BREATH_PROPERTIES,
  BREATH_SOUND_META,
  FORMANT_CHOICES,
} from '../../src/materials/sound/breath/meta';
import {
  AIR,
  bandCompensation,
  bandOctaves,
  breathCenterHz,
  breathVariation,
  CHEST,
  deriveBreathParams,
  FORMANT_1,
  HISS,
  WHISTLE,
  whistleAmount,
} from '../../src/materials/sound/breath/params';
import {
  bandShiftSemitones,
  bandWidening,
  BreathProgram,
  type BreathState,
} from '../../src/materials/sound/breath/program';
import type { PropertyValues } from '../../src/materials/types';
import { createSyntheticSampler, type SyntheticKind } from '../../src/signature/synthetic';
import type { SamplerConfig } from '../../src/signature/types';

const RATE = 200;
const BASE = baselineValues(BREATH_PROPERTIES);

interface Trace {
  amp: number[];
  shift: number[];
  q: number[];
  formantQ: number[];
  pan: number[];
}

function run(
  kind: SyntheticKind,
  props: PropertyValues = {},
  seconds = 2.6,
  config: Partial<SamplerConfig> = {},
  seed = 1,
): Trace {
  const sampler = createSyntheticSampler(kind);
  sampler.configure({ tailSec: 3, ...config });
  const program = new BreathProgram(breathVariation(seed));
  const s: BreathState = program.createState();
  program.reset(s);
  const all = { ...BASE, ...props };
  const trace: Trace = { amp: [], shift: [], q: [], formantQ: [], pan: [] };
  for (let k = 0; k < Math.round(seconds * RATE); k++) {
    program.step(s, sampler.sample(k / RATE), all, 1 / RATE);
    trace.amp.push(s.amp);
    trace.shift.push(s.shiftCents / 100);
    trace.q.push(s.qScale);
    trace.formantQ.push(s.formantQScale);
    trace.pan.push(s.panOut);
  }
  return trace;
}

const idx = (t: number): number => Math.round(t * RATE);
const at = (series: number[], t: number): number => series[idx(t)] ?? 0;
const part = (series: number[], a: number, b: number): number[] => series.slice(idx(a), idx(b));
const maxIn = (series: number[], a: number, b: number): number => Math.max(...part(series, a, b));
const minIn = (series: number[], a: number, b: number): number => Math.min(...part(series, a, b));
const dB = (ratio: number): number => 20 * Math.log10(ratio);
/** Value of `series` where `weights` peaks inside [a, b). */
const atPeakOf = (series: number[], weights: number[], a: number, b: number): number => {
  const w = part(weights, a, b);
  return part(series, a, b)[w.indexOf(Math.max(...w))] ?? 0;
};

describe('A3 Breath: properties', () => {
  it('follows the property rules (≤ 6 primary, ≤ 3 specific, plain labels)', () => {
    const primary = BREATH_PROPERTIES.filter((p) => p.primary).map((p) => p.id);
    expect(primary).toEqual([
      'viscosity',
      'elasticity',
      'persistence',
      'dispersion',
      'brightness',
      'intensity',
    ]);
    expect(primary.length).toBeLessThanOrEqual(MAX_PRIMARY_PROPERTIES);
    const specific = BREATH_PROPERTIES.filter((p) => !p.shared);
    expect(specific.length).toBeLessThanOrEqual(MAX_SPECIFIC_PROPERTIES);
    expect(specific.map((p) => p.id)).toEqual(['formant']);
    expect(specific[0]?.kind).toBe('choice');
    expect(specific[0]?.choices).toEqual(['None', 'Ah', 'Oo']);
    expect([...FORMANT_CHOICES]).toEqual(['None', 'Ah', 'Oo']);
    expect(specific[0]?.default).toBe(0);
    // Rigidity is hidden (breath has no rigid form); Range and Density are under "More".
    const ids = BREATH_PROPERTIES.map((p) => p.id);
    expect(ids).not.toContain('rigidity');
    expect(ids).toEqual(expect.arrayContaining(['range', 'density']));
    for (const p of BREATH_PROPERTIES) {
      expect(p.label).toMatch(/^[A-Z][a-z ]+$/);
      expect(p.description.length).toBeGreaterThan(10);
      expect(p.description.endsWith('.')).toBe(true);
    }
    expect(BREATH_SOUND_META.version).toBe(1);
    expect(BREATH_SOUND_META.id).toBe('breath');
  });

  it('maps each property in the direction its name promises', () => {
    const v = breathVariation(1);
    const p = (props: PropertyValues) => deriveBreathParams({ ...BASE, ...props }, v);
    const lo = (id: string) => p({ [id]: 0.1 });
    const hi = (id: string) => p({ [id]: 0.9 });
    // Viscosity: slower swells, slower band, darker.
    expect(hi('viscosity').attackSec).toBeGreaterThan(lo('viscosity').attackSec);
    expect(hi('viscosity').shiftGlideSec).toBeGreaterThan(lo('viscosity').shiftGlideSec);
    expect(hi('viscosity').followSec).toBeGreaterThan(lo('viscosity').followSec);
    expect(hi('viscosity').centerHz).toBeLessThan(lo('viscosity').centerHz);
    // Elasticity: narrower band, more overshoot, and a whistle only at the top.
    expect(hi('elasticity').bandQ[AIR]).toBeGreaterThan(lo('elasticity').bandQ[AIR]);
    expect(hi('elasticity').shiftGlideQ).toBeGreaterThan(lo('elasticity').shiftGlideQ);
    expect(p({}).bandGain[WHISTLE]).toBe(0);
    expect(lo('elasticity').bandGain[WHISTLE]).toBe(0);
    expect(hi('elasticity').bandGain[WHISTLE]).toBeGreaterThan(hi('elasticity').bandGain[AIR]);
    // Persistence: longer release and reverb.
    expect(hi('persistence').releaseSec).toBeGreaterThan(lo('persistence').releaseSec);
    expect(hi('persistence').reverbSend).toBeGreaterThan(lo('persistence').reverbSend);
    expect(hi('persistence').reverbDecaySec).toBeGreaterThan(lo('persistence').reverbDecaySec);
    // Dispersion: wider stereo (the band's width is in the program: see below).
    expect(hi('dispersion').width).toBeGreaterThan(lo('dispersion').width);
    // Brightness: the band rises.
    expect(hi('brightness').centerHz).toBeGreaterThan(lo('brightness').centerHz * 4);
    // Intensity: level and drive.
    expect(hi('intensity').level).toBeGreaterThan(lo('intensity').level);
    expect(hi('intensity').drive).toBeGreaterThan(lo('intensity').drive);
    // Range: how far the band travels.
    expect(hi('range').rangeSt).toBeGreaterThan(lo('range').rangeSt);
    // Density: one band, then a chest layer, then a hiss.
    expect(p({ density: 0 }).bandGain[CHEST]).toBe(0);
    expect(p({ density: 0 }).bandGain[HISS]).toBe(0);
    expect(p({ density: 1 }).bandGain[CHEST]).toBeGreaterThan(0);
    expect(p({ density: 1 }).bandGain[HISS]).toBeGreaterThan(0);
  });

  it('shapes the air into vowels with the Formant choice', () => {
    const v = breathVariation(1);
    const none = deriveBreathParams({ ...BASE, formant: 0 }, v);
    const ah = deriveBreathParams({ ...BASE, formant: 1 }, v);
    const oo = deriveBreathParams({ ...BASE, formant: 2 }, v);
    expect(none.bandGain.slice(FORMANT_1)).toEqual([0, 0, 0]);
    expect(ah.bandGain.slice(FORMANT_1).every((g) => g > 0)).toBe(true);
    // "oo" is rounder: lower formants than "ah".
    expect(oo.bandHz[FORMANT_1]).toBeLessThan(ah.bandHz[FORMANT_1] ?? 0);
    expect(oo.bandHz[FORMANT_1 + 1]).toBeLessThan(ah.bandHz[FORMANT_1 + 1] ?? 0);
    // The plain air steps back when a vowel shapes it.
    expect(ah.bandGain[AIR]).toBeLessThan(none.bandGain[AIR]);
  });

  it('levels bands of different widths, and keeps its band centre in the audible middle', () => {
    expect(bandOctaves(1.5)).toBeGreaterThan(bandOctaves(10));
    expect(bandOctaves(1.414)).toBeCloseTo(1, 1); // Q √2 is about an octave wide
    expect(bandCompensation(1.5)).toBeCloseTo(1, 12);
    expect(bandCompensation(40)).toBeGreaterThan(4);
    expect(breathCenterHz(0.5, 0.5)).toBeGreaterThan(700);
    expect(breathCenterHz(0.5, 0.5)).toBeLessThan(1500);
    expect(whistleAmount(0.5)).toBe(0);
    expect(whistleAmount(1)).toBe(1);
  });

  it('falls back to the baseline for missing or broken values, and clamps', () => {
    const v = breathVariation(2);
    expect(deriveBreathParams({}, v)).toEqual(deriveBreathParams(BASE, v));
    expect(deriveBreathParams({ ...BASE, brightness: Number.NaN }, v)).toEqual(
      deriveBreathParams(BASE, v),
    );
    expect(deriveBreathParams({ ...BASE, formant: 7 }, v)).toEqual(
      deriveBreathParams({ ...BASE, formant: 2 }, v),
    );
  });
});

describe('A3 Breath: band shape', () => {
  it('opens (up and wider) with expansion and closes (down and narrower) with contraction', () => {
    expect(bandShiftSemitones(14, 0.5, 1)).toBeGreaterThan(5);
    expect(bandShiftSemitones(14, 0.5, -1)).toBeLessThan(-5);
    expect(bandShiftSemitones(14, 0.5, 0)).toBe(0);
    expect(bandWidening(0.5, 0.5, 1)).toBeGreaterThan(bandWidening(0.5, 0.5, 0));
    expect(bandWidening(0.5, 0.5, -1)).toBeLessThan(bandWidening(0.5, 0.5, 0));
  });

  it('sits higher for movement higher in the frame', () => {
    expect(bandShiftSemitones(14, 0.2, 0)).toBeGreaterThan(bandShiftSemitones(14, 0.8, 0));
  });

  it('widens with spread × Dispersion', () => {
    expect(bandWidening(1, 1, 0)).toBeGreaterThan(bandWidening(1, 0, 0));
    expect(bandWidening(1, 1, 0)).toBeGreaterThan(bandWidening(0, 1, 0));
    expect(bandWidening(0, 1, 0)).toBe(bandWidening(1, 0, 0));
  });
});

describe('A3 Breath: control program', () => {
  it('is deterministic', () => {
    expect(run('wink')).toEqual(run('wink'));
  });

  it('stays silent for a still signature', () => {
    expect(Math.max(...run('still').amp)).toBe(0);
  });

  it('lets the wink be heard as two breaths: close then open (SPEC 9.3)', () => {
    const t = run('wink', {}, 2.2);
    const close = maxIn(t.amp, 0.6, 0.98);
    const gap = minIn(t.amp, 1.0, 1.2);
    const open = maxIn(t.amp, 1.15, 1.6);
    expect(dB(close / 2.4)).toBeGreaterThan(-6);
    expect(dB(open / 2.4)).toBeGreaterThan(-6);
    expect(dB(Math.min(close, open) / gap)).toBeGreaterThan(10);
  });

  it('closes the band on the close (the eyelid and cheek gather) and opens it on the open', () => {
    const t = run('wink', {}, 2.2);
    const closeShift = atPeakOf(t.shift, t.amp, 0.6, 0.98);
    const openShift = atPeakOf(t.shift, t.amp, 1.15, 1.6);
    expect(closeShift).toBeLessThan(-4);
    expect(openShift).toBeGreaterThan(closeShift + 4);
    expect(atPeakOf(t.q, t.amp, 0.6, 0.98)).toBeGreaterThan(atPeakOf(t.q, t.amp, 1.15, 1.6));
  });

  it('breathes in on expansion: the same movement played backwards swells and opens', () => {
    // Pingpong plays the wink backwards on the second pass: its close becomes an expansion
    // (divergence flips sign) with exactly the same energy and position.
    const t = run('wink', {}, 4.6, { loops: 2, loopMode: 'pingpong', tailSec: 0.5 });
    const forward = [0.6, 0.98] as const; // contraction
    const backward = [3.42, 3.8] as const; // the same gesture reversed: expansion
    // Loudness: the level times the square root of the band's width (pink noise carries the
    // same power in every octave, so a band twice as wide lets twice the power through).
    const loudness = t.amp.map((a, i) => a / Math.sqrt(t.q[i] ?? 1));
    const ampF = maxIn(loudness, ...forward);
    const ampB = maxIn(loudness, ...backward);
    expect(dB(ampB / ampF)).toBeGreaterThan(3);
    const shiftF = atPeakOf(t.shift, t.amp, ...forward);
    const shiftB = atPeakOf(t.shift, t.amp, ...backward);
    expect(shiftB - shiftF).toBeGreaterThan(8);
    // Expansion widens the band (lower Q), contraction narrows it.
    expect(atPeakOf(t.q, t.amp, ...backward)).toBeLessThan(atPeakOf(t.q, t.amp, ...forward) * 0.6);
  });

  it('holds the band where it was when the movement stops', () => {
    const t = run('wink', {}, 2.6);
    expect(at(t.shift, 2.5)).toBeCloseTo(at(t.shift, 2), 3);
  });

  it('a wider Range moves the band further', () => {
    const narrow = run('wink', { range: 0 }, 2.2);
    const wide = run('wink', { range: 1 }, 2.2);
    const travel = (x: Trace) => Math.max(...x.shift) - Math.min(...x.shift);
    expect(travel(wide)).toBeGreaterThan(travel(narrow) * 3);
  });

  it('a spread-out movement with more Dispersion gives a broader band', () => {
    const narrow = run('wink', { dispersion: 0 }, 2.2);
    const wide = run('wink', { dispersion: 1 }, 2.2);
    expect(atPeakOf(wide.q, wide.amp, 1.15, 1.6)).toBeLessThan(
      atPeakOf(narrow.q, narrow.amp, 1.15, 1.6) * 0.75,
    );
  });

  it('pans toward where the movement is and holds when it stops', () => {
    const t = run('sweep', { dispersion: 1 }, 3.2);
    expect(at(t.pan, 0.6)).toBeLessThan(at(t.pan, 1.5));
    expect(at(t.pan, 3.1)).toBeCloseTo(at(t.pan, 2.7), 1);
  });

  it('every property changes the control output or its parameters', () => {
    for (const def of BREATH_PROPERTIES) {
      const [a, b] = def.kind === 'choice' ? [0, 2] : [0.1, 0.9];
      const lo = run('wink', { [def.id]: a }, 2.2);
      const hi = run('wink', { [def.id]: b }, 2.2);
      const params = (x: number) =>
        deriveBreathParams({ ...BASE, [def.id]: x }, breathVariation(1));
      const changed =
        JSON.stringify(lo) !== JSON.stringify(hi) ||
        JSON.stringify(params(a)) !== JSON.stringify(params(b));
      expect(changed, def.id).toBe(true);
    }
  });
});
