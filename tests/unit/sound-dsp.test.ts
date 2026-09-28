import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/chance/prng';
import { normalizePeakInPlace, peakOf } from '../../src/engine/audio/normalize';
import { windowEdges } from '../../src/engine/audio/offline';
import { PlaybackMap } from '../../src/engine/audio/playbackMap';
import { generateImpulseResponse, impulseLength } from '../../src/materials/sound/shared/impulse';
import {
  brightnessCutoffHz,
  dispersionDetuneCents,
  expLerp,
  intensityGain,
  panFromCentroid,
  rangeSemitones,
  releaseSeconds,
  reverbDecaySeconds,
  reverbSendLevel,
  upwardFlow,
  viscosityGlideSeconds,
} from '../../src/materials/sound/shared/mapping';
import { softClip, softClipCurve } from '../../src/materials/sound/shared/masterChain';
import {
  fillPinkNoise,
  fillWhiteNoise,
  noiseChannel,
} from '../../src/materials/sound/shared/noise';
import type { SignatureFrame } from '../../src/signature/types';

function energy(data: Float32Array, from = 0, to = data.length): number {
  let e = 0;
  for (let i = from; i < to; i++) e += (data[i] ?? 0) ** 2;
  return e;
}

function correlation(a: Float32Array, b: Float32Array): number {
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    ab += (a[i] ?? 0) * (b[i] ?? 0);
    aa += (a[i] ?? 0) ** 2;
    bb += (b[i] ?? 0) ** 2;
  }
  return ab / Math.sqrt(aa * bb);
}

/** Share of sign changes: a rough brightness measure. */
function zeroCrossingRate(data: Float32Array, from: number, to: number): number {
  let z = 0;
  for (let i = from + 1; i < to; i++) if ((data[i] ?? 0) * (data[i - 1] ?? 0) < 0) z++;
  return z / (to - from);
}

describe('procedural impulse response', () => {
  const opts = { sampleRate: 48000, decaySec: 1.5, seed: 42 };

  it('is deterministic for a seed and changes with the seed', () => {
    const a = generateImpulseResponse(opts);
    const b = generateImpulseResponse(opts);
    const c = generateImpulseResponse({ ...opts, seed: 43 });
    expect(a[0]).toEqual(b[0]);
    expect(a[1]).toEqual(b[1]);
    expect(a[0]).not.toEqual(c[0]);
  });

  it('has the expected shape: stereo, unit energy, pre-delay, exponential decay', () => {
    const ir = generateImpulseResponse(opts);
    expect(ir).toHaveLength(2);
    const [left = new Float32Array(), right = new Float32Array()] = ir;
    expect(left.length).toBe(impulseLength(opts));
    expect(energy(left)).toBeCloseTo(1, 4);
    expect(energy(right)).toBeCloseTo(1, 4);
    const pre = Math.round(0.012 * 48000);
    expect(energy(left, 0, pre)).toBe(0);
    // −60 dB over the decay: the first 10% holds far more energy than the last 10%.
    const n = left.length;
    const early = energy(left, pre, pre + Math.round(0.1 * (n - pre)));
    const late = energy(left, n - Math.round(0.1 * (n - pre)), n);
    expect(10 * Math.log10(early / late)).toBeGreaterThan(40);
  });

  it('decorrelates the channels and darkens the tail', () => {
    const [left = new Float32Array(), right = new Float32Array()] = generateImpulseResponse({
      ...opts,
      damping: 0.8,
    });
    expect(Math.abs(correlation(left, right))).toBeLessThan(0.1);
    const n = left.length;
    const early = zeroCrossingRate(left, 1000, 7000);
    const late = zeroCrossingRate(left, n - 12000, n - 6000);
    expect(late).toBeLessThan(early * 0.7);
  });

  it('gets longer with the decay time', () => {
    const short = impulseLength({ ...opts, decaySec: 0.4 });
    const long = impulseLength({ ...opts, decaySec: 6 });
    expect(long).toBeGreaterThan(short * 10);
  });
});

describe('seeded noise', () => {
  it('white noise is deterministic, bounded and centred', () => {
    const a = fillWhiteNoise(new Float32Array(48000), createRng(3));
    const b = fillWhiteNoise(new Float32Array(48000), createRng(3));
    expect(a).toEqual(b);
    expect(Math.max(...a)).toBeLessThanOrEqual(1);
    expect(Math.min(...a)).toBeGreaterThanOrEqual(-1);
    const mean = a.reduce((s, x) => s + x, 0) / a.length;
    expect(Math.abs(mean)).toBeLessThan(0.02);
  });

  it('pink noise leans to low frequencies', () => {
    const white = fillWhiteNoise(new Float32Array(48000), createRng(4));
    const pink = fillPinkNoise(new Float32Array(48000), createRng(4));
    expect(zeroCrossingRate(pink, 0, pink.length)).toBeLessThan(
      zeroCrossingRate(white, 0, white.length) * 0.5,
    );
    expect(Math.max(...pink.map(Math.abs))).toBeLessThan(1.2);
  });

  it('gives each channel and stream its own sequence', () => {
    const l = noiseChannel(4800, { seed: 9 }, 0);
    const r = noiseChannel(4800, { seed: 9 }, 1);
    const other = noiseChannel(4800, { seed: 9, stream: 1 }, 0);
    expect(l).toEqual(noiseChannel(4800, { seed: 9 }, 0));
    expect(Math.abs(correlation(l, r))).toBeLessThan(0.1);
    expect(Math.abs(correlation(l, other))).toBeLessThan(0.1);
  });
});

describe('common sound mapping (SPEC 9.5)', () => {
  const frame = (flowY: number) =>
    ({ normalized: { flowY } }) as unknown as Pick<SignatureFrame, 'normalized'>;

  it('upward flow is −flowY (image y points down)', () => {
    expect(upwardFlow(frame(-0.8))).toBeCloseTo(0.8);
    expect(upwardFlow(frame(0.5))).toBeCloseTo(-0.5);
    expect(upwardFlow(frame(-3))).toBe(1);
  });

  it('pan follows the centroid, wider with Dispersion', () => {
    expect(panFromCentroid(0.5, 0.5)).toBeCloseTo(0);
    expect(panFromCentroid(0, 0.5)).toBeLessThan(0);
    expect(panFromCentroid(1, 0.5)).toBeGreaterThan(0);
    expect(panFromCentroid(1, 1)).toBeCloseTo(1);
    expect(panFromCentroid(1, 0)).toBeCloseTo(0.25);
    expect(Math.abs(panFromCentroid(0, 1))).toBeGreaterThan(Math.abs(panFromCentroid(0, 0.2)));
  });

  it('Intensity is 0 dB at baseline, −15 dB at 0 and +9 dB at 1', () => {
    expect(20 * Math.log10(intensityGain(0.5))).toBeCloseTo(0, 6);
    expect(20 * Math.log10(intensityGain(0))).toBeCloseTo(-15, 6);
    expect(20 * Math.log10(intensityGain(1))).toBeCloseTo(9, 6);
    for (let i = 0; i < 1; i += 0.05)
      expect(intensityGain(i + 0.05)).toBeGreaterThan(intensityGain(i));
  });

  it('Persistence lengthens release, reverb send and decay (0.4–6 s)', () => {
    expect(releaseSeconds(0.9)).toBeGreaterThan(releaseSeconds(0.1));
    expect(reverbSendLevel(0.9)).toBeGreaterThan(reverbSendLevel(0.1));
    expect(reverbDecaySeconds(0)).toBeCloseTo(0.4);
    expect(reverbDecaySeconds(1)).toBeCloseTo(6);
  });

  it('Brightness opens the low-pass, Viscosity darkens it and lengthens glides', () => {
    expect(brightnessCutoffHz(0.9)).toBeGreaterThan(brightnessCutoffHz(0.1));
    expect(brightnessCutoffHz(0.5, 1)).toBeLessThan(brightnessCutoffHz(0.5, 0));
    expect(viscosityGlideSeconds(0.9, 0.01, 0.2)).toBeGreaterThan(
      viscosityGlideSeconds(0.1, 0.01, 0.2),
    );
  });

  it('Range widens pitch travel; Dispersion widens detune', () => {
    expect(rangeSemitones(1)).toBeGreaterThan(rangeSemitones(0));
    expect(dispersionDetuneCents(0)).toBe(0);
    expect(dispersionDetuneCents(1)).toBeGreaterThan(dispersionDetuneCents(0.5));
    expect(expLerp(1, 100, 0.5)).toBeCloseTo(10);
  });
});

describe('master soft clip', () => {
  it('is exactly linear below the threshold and never exceeds full scale', () => {
    for (const x of [-0.8, -0.3, 0, 0.25, 0.8]) expect(softClip(x)).toBe(x);
    for (const x of [0.9, 1, 2, 4, 100]) {
      expect(softClip(x)).toBeLessThanOrEqual(1);
      expect(softClip(-x)).toBeCloseTo(-softClip(x));
    }
    expect(softClip(0.9)).toBeGreaterThan(softClip(0.85));
  });

  it('builds an odd-length curve that maps zero to zero', () => {
    const curve = softClipCurve({ size: 4096 });
    expect(curve.length % 2).toBe(1);
    expect(curve[(curve.length - 1) / 2]).toBe(0);
    expect(curve[curve.length - 1]).toBeLessThanOrEqual(1);
    expect(curve[0]).toBeGreaterThanOrEqual(-1);
    // Slope 1 around zero: the soft clip is transparent at normal levels.
    const mid = (curve.length - 1) / 2;
    expect((curve[mid + 1] ?? 0) / (4 / mid)).toBeCloseTo(1, 5);
  });
});

describe('offline render helpers', () => {
  it('peak-normalizes to −1 dBFS and leaves silence alone', () => {
    const a = new Float32Array([0, 0.25, -0.5, 0.1]);
    const b = new Float32Array([0.05, -0.2, 0.3, 0]);
    const gain = normalizePeakInPlace([a, b], -1);
    expect(gain).toBeGreaterThan(1);
    const target = Math.pow(10, -1 / 20);
    expect(peakOf([a, b])).toBeLessThanOrEqual(target);
    expect(peakOf([a, b])).toBeGreaterThan(target - 1e-6);
    const silent = new Float32Array(8);
    expect(normalizePeakInPlace([silent])).toBe(1);
    expect(peakOf([silent])).toBe(0);
  });

  it('splits long timelines into windows that cover them exactly', () => {
    expect(windowEdges(10, 0)).toEqual([0, 10]);
    expect(windowEdges(3, 5)).toEqual([0, 3]);
    const edges = windowEdges(12.5, 5);
    expect(edges).toEqual([0, 5, 10, 12.5]);
  });
});

describe('playback map (context time ↔ composition time)', () => {
  it('follows segments across a seek and a loop wrap', () => {
    const map = new PlaybackMap();
    map.reset(10, 0.5);
    expect(map.timeAt(10.25)).toBeCloseTo(0.75);
    expect(map.timeAt(9)).toBeCloseTo(0.5); // before the start: the start time
    map.push(12, 0); // wrap
    expect(map.timeAt(11.99)).toBeCloseTo(2.49);
    expect(map.timeAt(12.1)).toBeCloseTo(0.1);
    map.push(12.5, 3); // seek
    expect(map.timeAt(13)).toBeCloseTo(3.5);
    map.truncateAfter(12.2); // a live edit cancels everything after 12.2
    expect(map.segments()).toHaveLength(2);
    expect(map.timeAt(13)).toBeCloseTo(1);
    map.prune(12.1);
    expect(map.segments()).toHaveLength(1);
    expect(map.firstCtx).toBe(12);
  });
});
