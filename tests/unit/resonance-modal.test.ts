/**
 * The A4 Resonance modal bank processor (modal.worklet.js), run sample by sample in Node.
 */
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/chance/prng';
import { MODE_COUNT } from '../../src/materials/sound/resonance/params';
import { loadProcessor, peakOf, pitchOf, rmsOf, run, type Steps } from './helpers/worklet';

const SR = 48000;
const FILE = resolve(import.meta.dirname, '../../src/materials/sound/resonance/modal.worklet.js');
const Bank = loadProcessor(FILE, 'sp-modal-bank', SR);

const db = (x: number): number => 20 * Math.log10(x);
const at = (sec: number): number => Math.round(sec * SR);

/** One mode at `freq` Hz ringing for `t60` s, struck once at `strikeAt` s. */
function oneMode(
  freq: number,
  t60: number,
  extra: Record<string, Steps> = {},
  strikeAt = 0.01,
): Record<string, Steps> {
  return {
    freq0: [[0, freq]],
    decay0: [[0, t60]],
    gain0: [[0, 1]],
    strike: [[at(strikeAt), 1]],
    velocity: [[0, 1]],
    mallet: [[0, 0.0001]],
    ...extra,
  };
}

describe('A4 Resonance modal bank: parameters', () => {
  it('declares the parameters the material writes, at the right rates', () => {
    const rates = new Map(Bank.parameterDescriptors.map((d) => [d.name, d.automationRate]));
    for (let m = 0; m < MODE_COUNT; m++) {
      for (const name of [`freq${m}`, `decay${m}`, `gain${m}`])
        expect(rates.get(name)).toBe('k-rate');
    }
    for (const name of ['damp', 'width', 'detune', 'alive']) {
      expect(rates.get(name)).toBe('k-rate');
    }
    for (const name of ['strike', 'velocity', 'mallet', 'bounce', 'bounceHz', 'bounceDecay']) {
      expect(rates.get(name)).toBe('a-rate');
    }
    expect(rates.get('reset')).toBe('a-rate');
  });
});

describe('A4 Resonance modal bank: sound', () => {
  it('is silent until struck, then starts at the exact sample in sine phase', () => {
    const [left = new Float32Array()] = run(Bank, { frames: at(0.1), params: oneMode(1000, 1) });
    const strike = at(0.01);
    expect(peakOf(left, 0, strike)).toBe(0);
    expect(Math.abs(left[strike] ?? 1)).toBeLessThan(1e-6); // sine phase: no step
    expect(peakOf(left, strike, strike + 4)).toBeGreaterThan(0);
  });

  it('rings at the mode frequency and decays at its ring time (T60)', () => {
    const [left = new Float32Array()] = run(Bank, { frames: at(1.2), params: oneMode(1000, 1) });
    expect(pitchOf(left, SR, at(0.05), at(0.25))).toBeCloseTo(1000, 0);
    // −60 dB per second: 30 dB between windows half a second apart.
    const drop = db(rmsOf(left, at(0.1), at(0.2)) / rmsOf(left, at(0.6), at(0.7)));
    expect(drop).toBeGreaterThan(28.5);
    expect(drop).toBeLessThan(31.5);
    // A hard strike of velocity 1 rings at about the mode gain (split over two channels).
    expect(peakOf(left, at(0.01), at(0.02))).toBeGreaterThan(0.6);
    expect(peakOf(left, at(0.01), at(0.02))).toBeLessThan(0.75);
  });

  it('a soft (long) mallet mutes high modes but not low ones', () => {
    const level = (freq: number, mallet: number): number => {
      const [left = new Float32Array()] = run(Bank, {
        frames: at(0.2),
        params: oneMode(freq, 2, { mallet: [[0, mallet]] }),
      });
      return rmsOf(left, at(0.05), at(0.15));
    };
    expect(Math.abs(db(level(400, 0.0015) / level(400, 0.0001)))).toBeLessThan(2.5);
    expect(db(level(6000, 0.0001) / level(6000, 0.0015))).toBeGreaterThan(20);
  });

  it('the damper shortens the ring', () => {
    const ring = (damp: number): number => {
      const [left = new Float32Array()] = run(Bank, {
        frames: at(0.8),
        params: oneMode(700, 3, { damp: [[0, damp]] }),
      });
      return db(rmsOf(left, at(0.05), at(0.1)) / rmsOf(left, at(0.5), at(0.55)));
    };
    const free = ring(0);
    const damped = ring(Math.log(1000)); // an extra −60 dB per second
    expect(free).toBeCloseTo(9, 0); // 60 dB × 0.45 s / 3 s
    expect(damped - free).toBeGreaterThan(24); // ≈ 27 dB more over 0.45 s
  });

  it('detuned twins beat in mono, and width spreads them across the stereo field', () => {
    const render = (detune: number, width: number) =>
      run(Bank, {
        frames: at(0.8),
        // A very long ring, so the envelope's swing is the beating, not the decay.
        params: oneMode(1000, 600, { detune: [[0, detune]], width: [[0, width]] }),
      });
    const envelopeSwing = (left: Float32Array, right: Float32Array): number => {
      const hop = at(0.01);
      const levels: number[] = [];
      for (let i = at(0.05); i + hop < at(0.75); i += hop) {
        let acc = 0;
        for (let j = i; j < i + hop; j++) acc += ((left[j] ?? 0) + (right[j] ?? 0)) ** 2;
        levels.push(Math.sqrt(acc / hop));
      }
      return Math.max(...levels) / Math.max(1e-9, Math.min(...levels));
    };
    const [l0 = new Float32Array(), r0 = new Float32Array()] = render(0, 0);
    const [l1 = new Float32Array(), r1 = new Float32Array()] = render(20, 0);
    expect(envelopeSwing(l0, r0)).toBeLessThan(1.1);
    expect(envelopeSwing(l1, r1)).toBeGreaterThan(3);
    // Width: the channels differ (mode 4 spreads the furthest; the fundamental stays nearer
    // the centre).
    const [lw = new Float32Array(), rw = new Float32Array()] = run(Bank, {
      frames: at(0.8),
      params: {
        freq4: [[0, 1000]],
        decay4: [[0, 600]],
        gain4: [[0, 1]],
        strike: [[at(0.01), 1]],
        velocity: [[0, 1]],
        mallet: [[0, 0.0001]],
        detune: [[0, 20]],
        width: [[0, 1]],
      },
    });
    let ab = 0;
    let aa = 0;
    let bb = 0;
    for (let i = at(0.05); i < at(0.75); i++) {
      ab += (lw[i] ?? 0) * (rw[i] ?? 0);
      aa += (lw[i] ?? 0) ** 2;
      bb += (rw[i] ?? 0) ** 2;
    }
    expect(ab / Math.sqrt(aa * bb)).toBeLessThan(0.8);
    // Symmetric: wider, not leaning to one side.
    expect(
      Math.abs(db(rmsOf(lw, at(0.05), at(0.75)) / rmsOf(rw, at(0.05), at(0.75)))),
    ).toBeLessThan(0.5);
  });

  it('a reset silences the body within 2 ms', () => {
    const [left = new Float32Array()] = run(Bank, {
      frames: at(0.5),
      params: oneMode(800, 5, { reset: [[at(0.3), 1]] }),
    });
    const before = peakOf(left, at(0.28), at(0.3));
    expect(before).toBeGreaterThan(0.1);
    expect(peakOf(left, at(0.3) + 100, at(0.5))).toBe(0);
  });

  it('a strike can bounce the pitch, which then settles back', () => {
    const [left = new Float32Array()] = run(Bank, {
      frames: at(1.2),
      params: oneMode(1000, 4, {
        bounce: [[0, 100]],
        bounceHz: [[0, 5]],
        bounceDecay: [[0, 0.2]],
      }),
    });
    const cents = (a: number, b: number) =>
      1200 * Math.log2(pitchOf(left, SR, at(a), at(b)) / 1000);
    expect(cents(0.04, 0.08)).toBeGreaterThan(40);
    expect(Math.abs(cents(0.9, 1.1))).toBeLessThan(2);
  });

  it('the bowed level follows the input, whatever the ring time', () => {
    const rng = createRng(3);
    const noise = new Float32Array(at(4));
    for (let i = 0; i < noise.length; i++) noise[i] = (rng() * 2 - 1) * 0.1;
    const sigma = rmsOf(noise);
    const sung = (t60: number): number => {
      const [left = new Float32Array()] = run(Bank, {
        frames: noise.length,
        input: noise,
        params: { freq0: [[0, 600]], decay0: [[0, t60]], gain0: [[0, 1]] },
      });
      return rmsOf(left, at(3), at(4));
    };
    const short = sung(0.3);
    const long = sung(3);
    // Steady state: RMS = gain · σ / 2 per channel at the centre, independent of T60.
    expect(short / sigma).toBeCloseTo(0.5, 1);
    expect(Math.abs(db(long / short))).toBeLessThan(2);
  });

  it('is deterministic and stays bounded under extreme settings', () => {
    const rng = createRng(9);
    const params: Record<string, Steps> = {};
    for (let m = 0; m < MODE_COUNT; m++) {
      params[`freq${m}`] = [[0, 50 + rng() * 22000]];
      params[`decay${m}`] = [[0, 0.01 + rng() * 60]];
      params[`gain${m}`] = [[0, rng() * 3]];
    }
    const strikes: [number, number][] = [];
    const bounces: [number, number][] = [];
    for (let i = 0; i < 40; i++) {
      const frame = at(0.01 + i * 0.07);
      strikes.push([frame, i + 1]);
      bounces.push([frame, (rng() * 2 - 1) * 300]);
    }
    Object.assign(params, {
      strike: strikes,
      bounce: bounces,
      velocity: [[0, 1]],
      mallet: [[0, 0.00005]],
      detune: [[0, 40]],
      width: [[0, 1]],
      damp: [
        [0, 0],
        [at(1), 20],
        [at(2), 0],
      ],
    });
    const input = new Float32Array(at(3));
    for (let i = 0; i < input.length; i++) input[i] = rng() * 2 - 1;
    const a = run(Bank, { frames: at(3), params, input });
    const b = run(Bank, { frames: at(3), params, input });
    expect(a).toEqual(b);
    for (const channel of a) {
      expect(channel.every(Number.isFinite)).toBe(true);
      expect(peakOf(channel)).toBeLessThan(60);
    }
  }, 30_000);

  it('keeps running while alive, and stops once the material sets alive to 0', () => {
    const bank = new Bank();
    const outputs = [[new Float32Array(128), new Float32Array(128)]];
    const parameters: Record<string, Float32Array> = {};
    for (const d of Bank.parameterDescriptors) parameters[d.name] = Float32Array.of(d.defaultValue);
    expect(bank.process([[]], outputs, parameters)).toBe(true);
    parameters.alive = Float32Array.of(0);
    expect(bank.process([[]], outputs, parameters)).toBe(false);
  });
});
