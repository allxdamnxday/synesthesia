import { describe, expect, it } from 'vitest';
import {
  baselineValues,
  MAX_PRIMARY_PROPERTIES,
  MAX_SPECIFIC_PROPERTIES,
} from '../../src/materials/properties';
import { WATER_PROPERTIES, WATER_SOUND_META } from '../../src/materials/sound/water/meta';
import {
  deriveWaterParams,
  quantizePentatonic,
  waterVariation,
} from '../../src/materials/sound/water/params';
import { WaterProgram, type WaterState } from '../../src/materials/sound/water/program';
import type { PropertyValues } from '../../src/materials/types';
import { createSyntheticSampler, type SyntheticKind } from '../../src/signature/synthetic';

const RATE = 200;
const BASE = baselineValues(WATER_PROPERTIES);

interface Trace {
  pitch: number[];
  amp: number[];
  deviation: number[];
  flutter: number[];
  pan: number[];
}

/** Step the control program over a synthetic movement at the control rate. */
function run(kind: SyntheticKind, props: PropertyValues = {}, seconds = 3, seed = 1): Trace {
  const sampler = createSyntheticSampler(kind);
  sampler.configure({ tailSec: 3 });
  const program = new WaterProgram(waterVariation(seed));
  const s: WaterState = program.createState();
  program.reset(s);
  const all = { ...BASE, ...props };
  const trace: Trace = { pitch: [], amp: [], deviation: [], flutter: [], pan: [] };
  const steps = Math.round(seconds * RATE);
  for (let k = 0; k < steps; k++) {
    program.step(s, sampler.sample(k / RATE), all, 1 / RATE);
    trace.pitch.push(s.pitchCents);
    trace.amp.push(s.amp);
    trace.deviation.push(s.deviation);
    trace.flutter.push(s.flutterDepth);
    trace.pan.push(s.panOut);
  }
  return trace;
}

const at = (series: number[], t: number): number => series[Math.round(t * RATE)] ?? 0;
const maxIn = (series: number[], a: number, b: number): number =>
  Math.max(...series.slice(Math.round(a * RATE), Math.round(b * RATE)));
const minIn = (series: number[], a: number, b: number): number =>
  Math.min(...series.slice(Math.round(a * RATE), Math.round(b * RATE)));

describe('A1 Water: properties', () => {
  it('follows the property rules (≤ 6 primary, ≤ 3 specific, plain labels)', () => {
    const primary = WATER_PROPERTIES.filter((p) => p.primary).map((p) => p.id);
    expect(primary).toEqual([
      'viscosity',
      'elasticity',
      'persistence',
      'dispersion',
      'brightness',
      'intensity',
    ]);
    expect(primary.length).toBeLessThanOrEqual(MAX_PRIMARY_PROPERTIES);
    const specific = WATER_PROPERTIES.filter((p) => !p.shared);
    expect(specific.length).toBeLessThanOrEqual(MAX_SPECIFIC_PROPERTIES);
    expect(specific.map((p) => p.id)).toEqual(['register']);
    const register = specific[0];
    expect(register?.kind).toBe('choice');
    expect(register?.choices).toEqual(['Low', 'Middle', 'High']);
    for (const p of WATER_PROPERTIES) {
      expect(p.label).toMatch(/^[A-Z][a-z ]+$/);
      expect(p.description.length).toBeGreaterThan(10);
      expect(p.description.endsWith('.')).toBe(true);
    }
    expect(WATER_SOUND_META.version).toBe(1);
  });

  it('maps each shared property in the direction its name promises', () => {
    const v = waterVariation(1);
    const p = (props: PropertyValues) => deriveWaterParams({ ...BASE, ...props }, v);
    expect(p({ viscosity: 0.9 }).glideSec).toBeGreaterThan(p({ viscosity: 0.1 }).glideSec);
    expect(p({ viscosity: 0.9 }).attackSec).toBeGreaterThan(p({ viscosity: 0.1 }).attackSec);
    expect(p({ viscosity: 0.9 }).cutoffHz).toBeLessThan(p({ viscosity: 0.1 }).cutoffHz);
    expect(p({ elasticity: 0.9 }).glideQ).toBeGreaterThan(p({ elasticity: 0.1 }).glideQ);
    expect(p({ elasticity: 0.9 }).vibMaxSt).toBeGreaterThan(p({ elasticity: 0.1 }).vibMaxSt);
    expect(p({ persistence: 0.9 }).releaseSec).toBeGreaterThan(p({ persistence: 0.1 }).releaseSec);
    expect(p({ persistence: 0.9 }).reverbSend).toBeGreaterThan(p({ persistence: 0.1 }).reverbSend);
    expect(p({ persistence: 0.9 }).reverbDecaySec).toBeGreaterThan(
      p({ persistence: 0.1 }).reverbDecaySec,
    );
    const wide = p({ dispersion: 0.9 });
    const narrow = p({ dispersion: 0.1 });
    expect(wide.voiceDetune[1] - wide.voiceDetune[0]).toBeGreaterThan(
      narrow.voiceDetune[1] - narrow.voiceDetune[0],
    );
    expect(wide.voicePan[1]).toBeGreaterThan(narrow.voicePan[1]);
    expect(p({ brightness: 0.9 }).indexBase).toBeGreaterThan(p({ brightness: 0.1 }).indexBase);
    expect(p({ brightness: 0.9 }).cutoffHz).toBeGreaterThan(p({ brightness: 0.1 }).cutoffHz);
    expect(p({ intensity: 0.9 }).level).toBeGreaterThan(p({ intensity: 0.1 }).level);
    expect(p({ intensity: 0.9 }).drive).toBeGreaterThan(p({ intensity: 0.1 }).drive);
    expect(p({ range: 0.9 }).rangeSt).toBeGreaterThan(p({ range: 0.1 }).rangeSt);
    expect(p({ density: 0 }).voiceLevels.slice(1)).toEqual([0, 0]);
    expect(p({ density: 1 }).voiceLevels.every((l) => l > 0)).toBe(true);
    expect(p({ rigidity: 0 }).quantize).toBe(0);
    expect(p({ rigidity: 1 }).quantize).toBe(1);
    expect(p({ register: 0 }).baseHz).toBe(220);
    expect(p({ register: 2 }).baseHz).toBe(880);
  });

  it('snaps to the major pentatonic scale', () => {
    expect([0.4, 1.2, 2.9, 5.4, 6.1, 8.2, 10.4, 11.4].map(quantizePentatonic)).toEqual([
      0, 2, 2, 4, 7, 9, 9, 12,
    ]);
    expect(quantizePentatonic(-1.2)).toBe(0);
    expect(quantizePentatonic(-1.8)).toBe(-3);
    expect(quantizePentatonic(14.2)).toBe(14);
  });
});

describe('A1 Water: control program', () => {
  it('is deterministic', () => {
    expect(run('wink')).toEqual(run('wink'));
  });

  it('stays silent for a still signature', () => {
    const still = run('still');
    expect(Math.max(...still.amp)).toBe(0);
  });

  it('rises in pitch with rising movement and ends high', () => {
    // Sweep: across (0.3–1.7 s), then up (1.8–2.6 s).
    const t = run('sweep', {}, 3.2);
    const crossing = at(t.pitch, 1.2);
    const riseStart = at(t.pitch, 1.85);
    const riseEnd = at(t.pitch, 2.55);
    expect(riseEnd - crossing).toBeGreaterThan(600); // > 6 semitones above the crossing
    expect(riseEnd - riseStart).toBeGreaterThan(600);
    // Through the rise the pitch only goes up, apart from the vibrato that Elasticity adds
    // on jolts; without elasticity it never drops by an audible amount (2 cents is far
    // below the ~5 cent threshold of hearing a pitch change).
    const plain = run('sweep', { elasticity: 0 }, 3.2);
    for (let x = 1.9; x < 2.5; x += 0.05) {
      expect(at(t.pitch, x + 0.05)).toBeGreaterThan(at(t.pitch, x) - 100);
      expect(at(plain.pitch, x + 0.05)).toBeGreaterThan(at(plain.pitch, x) - 2);
    }
    // It doesn't fall back as the movement slows: still high after the rise ends.
    expect(at(t.pitch, 2.8)).toBeGreaterThan(crossing + 600);
  });

  it('lets the wink be heard as two gestures: close then open (SPEC 9.3)', () => {
    const t = run('wink', {}, 2.2);
    const close = maxIn(t.amp, 0.6, 0.95);
    const gap = minIn(t.amp, 0.95, 1.18);
    const open = maxIn(t.amp, 1.15, 1.6);
    expect(close).toBeGreaterThan(0.1);
    expect(open).toBeGreaterThan(0.1);
    expect(20 * Math.log10(Math.min(close, open) / gap)).toBeGreaterThan(12);
    // Close moves down (pitch falls), open moves up (pitch rises).
    expect(at(t.pitch, 0.88)).toBeLessThan(at(t.pitch, 0.65));
    expect(at(t.pitch, 1.42)).toBeGreaterThan(at(t.pitch, 1.18) + 300);
  });

  it('fires one short buzz per sudden gathering, not a sustained one', () => {
    const t = run('wink', {}, 2.2);
    let fires = 0;
    for (let i = 1; i < t.flutter.length; i++) {
      if ((t.flutter[i] ?? 0) > 0.02 && (t.flutter[i - 1] ?? 0) <= (t.flutter[i] ?? 0) * 0.5)
        fires++;
    }
    expect(fires).toBe(2);
    expect(at(t.flutter, 0.95)).toBeLessThan(0.01);
  });

  it('pans toward where the movement is and holds when it stops', () => {
    // Sweep crosses left to right: pan moves right, then stays.
    const t = run('sweep', { dispersion: 1 }, 3.2);
    expect(at(t.pan, 0.6)).toBeLessThan(at(t.pan, 1.5));
    expect(at(t.pan, 3.1)).toBeCloseTo(at(t.pan, 2.7), 1);
  });

  it('every continuous property changes the control output or its parameters', () => {
    const base = run('wink', {}, 2.2);
    for (const def of WATER_PROPERTIES.filter((p) => p.kind === 'continuous')) {
      const lo = run('wink', { [def.id]: 0.1 }, 2.2);
      const hi = run('wink', { [def.id]: 0.9 }, 2.2);
      const params = (x: number) => deriveWaterParams({ ...BASE, [def.id]: x }, waterVariation(1));
      const changed =
        JSON.stringify(lo) !== JSON.stringify(hi) ||
        JSON.stringify(params(0.1)) !== JSON.stringify(params(0.9));
      expect(changed, def.id).toBe(true);
    }
    expect(base.amp.length).toBe(440);
  });
});
