/**
 * The A5 Pulse Karplus-Strong processor (pluck.worklet.js), run sample by sample in Node.
 */
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadProcessor, peakOf, pitchOf, rmsOf, run, type Steps } from './helpers/worklet';

const SR = 48000;
const FILE = resolve(import.meta.dirname, '../../src/materials/sound/pulse/pluck.worklet.js');
const Pluck = loadProcessor(FILE, 'sp-pluck', SR);

const db = (x: number): number => 20 * Math.log10(x);
const at = (sec: number): number => Math.round(sec * SR);
const cents = (f: number, ref: number): number => 1200 * Math.log2(f / ref);

interface PluckSpec {
  at: number;
  freq?: number;
  velocity?: number;
  decay?: number;
  tone?: number;
  pan?: number;
  bend?: number;
  bendHz?: number;
  bendDecay?: number;
  attack?: number;
  seed?: number;
}

/** Automation for a list of plucks (each sets its values and a new trigger serial). */
function plucks(list: PluckSpec[], extra: Record<string, Steps> = {}): Record<string, Steps> {
  const steps: Record<string, [number, number][]> = {};
  const set = (name: string, frame: number, value: number) => {
    (steps[name] ??= []).push([frame, value]);
  };
  list.forEach((p, i) => {
    const frame = at(p.at);
    set('freq', frame, p.freq ?? 440);
    set('velocity', frame, p.velocity ?? 1);
    set('decay', frame, p.decay ?? 1);
    set('tone', frame, p.tone ?? 0.5);
    set('pan', frame, p.pan ?? 0);
    set('bend', frame, p.bend ?? 0);
    set('bendHz', frame, p.bendHz ?? 8);
    set('bendDecay', frame, p.bendDecay ?? 0.1);
    set('attack', frame, p.attack ?? 0.0005);
    set('seed', frame, p.seed ?? 1234 + i);
    set('trigger', frame, i + 1);
  });
  return { ...steps, ...extra };
}

describe('A5 Pulse strings: parameters', () => {
  it('declares every per-pluck parameter as a-rate (read at the exact sample)', () => {
    const rates = new Map(Pluck.parameterDescriptors.map((d) => [d.name, d.automationRate]));
    for (const name of [
      'trigger',
      'freq',
      'velocity',
      'decay',
      'tone',
      'pan',
      'bend',
      'bendHz',
      'bendDecay',
      'attack',
      'seed',
      'reset',
    ]) {
      expect(rates.get(name), name).toBe('a-rate');
    }
  });
});

describe('A5 Pulse strings: sound', () => {
  it('is silent until plucked, then starts at the exact sample', () => {
    const start = at(0.0503); // mid-block
    const [left = new Float32Array()] = run(Pluck, {
      frames: at(0.2),
      params: plucks([{ at: start / SR }]),
    });
    expect(peakOf(left, 0, start)).toBe(0);
    expect(peakOf(left, start, start + 64)).toBeGreaterThan(0);
  });

  it('plays in tune across the range', () => {
    for (const freq of [110, 220, 440, 880, 1320]) {
      const [left = new Float32Array()] = run(Pluck, {
        frames: at(0.5),
        params: plucks([{ at: 0.01, freq, decay: 2 }]),
      });
      const heard = pitchOf(left, SR, at(0.15), at(0.45), 60, 2000);
      expect(Math.abs(cents(heard, freq)), `${freq} Hz`).toBeLessThan(6);
    }
  });

  it('rings for the ring time it is given (T60)', () => {
    const [left = new Float32Array()] = run(Pluck, {
      frames: at(1.3),
      params: plucks([{ at: 0.01, freq: 220, decay: 1, tone: 0.3 }]),
    });
    // −60 dB per second on the fundamental: about 30 dB between windows 0.5 s apart once the
    // upper harmonics (which die faster) have faded.
    const drop = db(rmsOf(left, at(0.4), at(0.5)) / rmsOf(left, at(0.9), at(1.0)));
    expect(drop).toBeGreaterThan(25);
    expect(drop).toBeLessThan(36);
    const long = run(Pluck, {
      frames: at(1.3),
      params: plucks([{ at: 0.01, freq: 220, decay: 3, tone: 0.3 }]),
    })[0];
    expect(db(rmsOf(long ?? new Float32Array(), at(0.9), at(1.0)))).toBeGreaterThan(
      db(rmsOf(left, at(0.9), at(1.0))) + 15,
    );
  });

  it('tone brightens the pluck; a long attack softens its onset', () => {
    const zeroCrossings = (data: Float32Array, from: number, to: number): number => {
      let z = 0;
      for (let i = from + 1; i < to; i++) if ((data[i] ?? 0) * (data[i - 1] ?? 0) < 0) z++;
      return z;
    };
    const render = (tone: number, attack: number) =>
      run(Pluck, {
        frames: at(0.3),
        params: plucks([{ at: 0.01, freq: 220, tone, attack, decay: 1 }]),
      })[0] ?? new Float32Array();
    const dark = render(0, 0.0005);
    const bright = render(1, 0.0005);
    expect(zeroCrossings(bright, at(0.02), at(0.1))).toBeGreaterThan(
      2 * zeroCrossings(dark, at(0.02), at(0.1)),
    );
    // Time to reach half the peak level (RMS in 1 ms hops).
    const rise = (data: Float32Array): number => {
      const hop = at(0.001);
      const levels: number[] = [];
      for (let i = at(0.01); i < at(0.1); i += hop) levels.push(rmsOf(data, i, i + hop));
      const peak = Math.max(...levels);
      return levels.findIndex((l) => l >= 0.5 * peak);
    };
    expect(rise(render(0.5, 0.0005))).toBeLessThanOrEqual(2);
    expect(rise(render(0.5, 0.012))).toBeGreaterThanOrEqual(5);
  });

  it('keeps the same loudness whatever the attack', () => {
    const level = (attack: number): number =>
      rmsOf(
        run(Pluck, {
          frames: at(0.4),
          params: plucks([{ at: 0.01, freq: 330, attack, decay: 2 }]),
        })[0] ?? new Float32Array(),
        at(0.1),
        at(0.3),
      );
    expect(Math.abs(db(level(0.012) / level(0.0005)))).toBeLessThan(4);
  });

  it('twangs: a bend starts the pluck sharp and settles to the note', () => {
    const [left = new Float32Array()] = run(Pluck, {
      frames: at(0.8),
      params: plucks([{ at: 0.01, freq: 330, bend: 2, bendHz: 0, bendDecay: 0.15, decay: 3 }]),
    });
    expect(cents(pitchOf(left, SR, at(0.02), at(0.06), 60, 2000), 330)).toBeGreaterThan(120);
    expect(Math.abs(cents(pitchOf(left, SR, at(0.6), at(0.78), 60, 2000), 330))).toBeLessThan(6);
  });

  it('pans each pluck (equal power)', () => {
    const [left = new Float32Array(), right = new Float32Array()] = run(Pluck, {
      frames: at(0.3),
      params: plucks([{ at: 0.01, pan: -0.8 }]),
    });
    expect(db(rmsOf(left) / rmsOf(right))).toBeGreaterThan(15);
  });

  it('is deterministic for a noise seed, and the seed changes the pluck', () => {
    const render = (seed: number) =>
      run(Pluck, { frames: at(0.2), params: plucks([{ at: 0.01, seed }]) });
    expect(render(7)).toEqual(render(7));
    expect(render(7)).not.toEqual(render(8));
  });

  it('a reset fades every string out within a few milliseconds', () => {
    const [left = new Float32Array()] = run(Pluck, {
      frames: at(0.5),
      params: plucks(
        [
          { at: 0.01, decay: 5 },
          { at: 0.05, freq: 660, decay: 5 },
        ],
        {
          reset: [[at(0.3), 1]],
        },
      ),
    });
    const before = peakOf(left, at(0.28), at(0.3));
    expect(before).toBeGreaterThan(0.05);
    // After 5 ms nothing rings: all that is left is the DC blocker settling, far below the
    // strings and smooth (no sample-to-sample steps).
    expect(peakOf(left, at(0.305), at(0.5))).toBeLessThan(0.02 * before);
    let step = 0;
    for (let i = at(0.305) + 1; i < at(0.5); i++) {
      step = Math.max(step, Math.abs((left[i] ?? 0) - (left[i - 1] ?? 0)));
    }
    expect(step).toBeLessThan(1e-4);
  });

  it('survives many overlapping plucks: bounded, finite, no dead-stop clicks', () => {
    const list: PluckSpec[] = [];
    for (let i = 0; i < 60; i++) {
      list.push({ at: 0.01 + i * 0.05, freq: 150 + ((i * 97) % 700), decay: 4, velocity: 1 });
    }
    const [left = new Float32Array(), right = new Float32Array()] = run(Pluck, {
      frames: at(3.5),
      params: plucks(list),
    });
    for (const data of [left, right]) {
      expect(data.every(Number.isFinite)).toBe(true);
      expect(peakOf(data)).toBeLessThan(6);
    }
    // The largest sample-to-sample step stays in the range of a single pluck's attack.
    const single = run(Pluck, { frames: at(0.3), params: plucks([{ at: 0.01, decay: 4 }]) })[0];
    const maxStep = (data: Float32Array): number => {
      let m = 0;
      for (let i = 1; i < data.length; i++)
        m = Math.max(m, Math.abs((data[i] ?? 0) - (data[i - 1] ?? 0)));
      return m;
    };
    expect(maxStep(left)).toBeLessThan(4 * maxStep(single ?? new Float32Array()));
  }, 30_000);

  it('stays stable at the brightest, longest settings', () => {
    const [left = new Float32Array()] = run(Pluck, {
      frames: at(4),
      params: plucks([{ at: 0.01, freq: 60, tone: 1, decay: 30, attack: 0.0003 }]),
    });
    expect(left.every(Number.isFinite)).toBe(true);
    expect(peakOf(left, at(3), at(4))).toBeLessThan(peakOf(left, 0, at(0.5)) * 1.05);
  }, 30_000);

  it('keeps running while alive, and stops once the material sets alive to 0', () => {
    const strings = new Pluck();
    const outputs = [[new Float32Array(128), new Float32Array(128)]];
    const parameters: Record<string, Float32Array> = {};
    for (const d of Pluck.parameterDescriptors)
      parameters[d.name] = Float32Array.of(d.defaultValue);
    expect(strings.process([], outputs, parameters)).toBe(true);
    parameters.alive = Float32Array.of(0);
    expect(strings.process([], outputs, parameters)).toBe(false);
  });
});
