import { describe, expect, it } from 'vitest';
import { percentile, smoothstep } from '../../src/lib/math';
import {
  applySoftThreshold,
  autoNoiseFloor,
  frameEnergies,
  noiseFloorLooksHigh,
  quietestFrames,
  resolveNoiseFloor,
} from '../../src/signature/noiseFloor';
import {
  MIN_NOISE_FLOOR,
  type FeatureStats,
  type KineticSignature,
} from '../../src/signature/types';

/** A field whose frame f has every cell moving right at speeds[f][c]. */
function fieldFromSpeeds(speeds: number[][]): Float32Array {
  const cells = speeds[0]?.length ?? 0;
  const out = new Float32Array(speeds.length * cells * 2);
  speeds.forEach((frame, f) => frame.forEach((s, c) => (out[(f * cells + c) * 2] = s)));
  return out;
}

describe('frame energies and quiet frames', () => {
  it('energy is the mean cell magnitude', () => {
    const field = new Float32Array([3, 4, 0, 0, 0, 0, 0, 0]); // frame 0: |(3,4)| = 5 and 0
    expect(Array.from(frameEnergies(field, 2, 2))).toEqual([2.5, 0]);
  });

  it('picks the quietest 10% (at least one), ties by frame index', () => {
    const energies = [5, 1, 3, 1, 9, 7, 2, 8, 6, 4, 0.5, 10];
    expect(quietestFrames(energies, 0.1)).toEqual([10, 1]); // ceil(1.2) = 2
    expect(quietestFrames([2, 2, 2], 0.1)).toEqual([0]);
    expect(quietestFrames([], 0.1)).toEqual([]);
  });
});

describe('auto noise floor', () => {
  it('is 1.5 × the 60th percentile of cell magnitudes in the quietest 10% of frames', () => {
    const cells = 10;
    const quiet = Array.from({ length: cells }, (_, c) => 0.001 * (c + 1)); // 0.001..0.01
    const loud = Array.from({ length: cells }, () => 0.5);
    // 20 frames: two quiet ones (10%), the rest loud.
    const speeds = Array.from({ length: 20 }, (_, f) => (f === 4 || f === 13 ? quiet : loud));
    const expected = 1.5 * percentile([...quiet, ...quiet], 60);
    expect(autoNoiseFloor(fieldFromSpeeds(speeds), 20, cells)).toBeCloseTo(expected, 7);
  });

  it('never goes below MIN_NOISE_FLOOR', () => {
    expect(autoNoiseFloor(new Float32Array(10 * 4 * 2), 10, 4)).toBe(MIN_NOISE_FLOOR);
    expect(autoNoiseFloor(new Float32Array(0), 0, 4)).toBe(MIN_NOISE_FLOOR);
  });

  it('manual mode uses the given value (finite, not negative)', () => {
    const field = new Float32Array(8);
    expect(resolveNoiseFloor(field, 1, 4, 'manual', 0.05)).toBe(0.05);
    expect(resolveNoiseFloor(field, 1, 4, 'manual', -1)).toBe(0);
    expect(resolveNoiseFloor(field, 1, 4, 'manual', NaN)).toBe(MIN_NOISE_FLOOR);
    expect(resolveNoiseFloor(field, 1, 4, 'auto', 0.05)).toBe(MIN_NOISE_FLOOR);
  });
});

describe('soft threshold', () => {
  it('silences cells below the floor, keeps cells above 2·floor, fades in between', () => {
    const floor = 0.1;
    const field = new Float32Array([0.05, 0, 0.3, 0, 0.09, 0.12, -0.06, -0.08]);
    applySoftThreshold(field, floor);
    expect(field[0]).toBe(0);
    expect(field[1]).toBe(0);
    expect(field[2]).toBeCloseTo(0.3, 7);
    // |(0.09, 0.12)| = 0.15: halfway between floor and 2·floor → smoothstep = 0.5.
    const k = smoothstep(0.1, 0.2, 0.15);
    expect(k).toBeCloseTo(0.5, 10);
    expect(field[4]).toBeCloseTo(0.09 * k, 6);
    expect(field[5]).toBeCloseTo(0.12 * k, 6);
    // |(-0.06, -0.08)| = 0.1: at the floor → (almost exactly) 0.
    expect(field[6]).toBeCloseTo(0, 10);
    expect(field[7]).toBeCloseTo(0, 10);
  });

  it('with a zero floor keeps any movement and zeroes only still cells', () => {
    const field = new Float32Array([0, 0, 1e-6, 0]);
    applySoftThreshold(field, 0);
    expect(Array.from(field)).toEqual([0, 0, Math.fround(1e-6), 0]);
  });
});

describe('noiseFloorLooksHigh (the Prepare hint)', () => {
  const stat = (p95: number): FeatureStats => ({ min: 0, max: p95, mean: p95 / 2, p05: 0, p95 });
  const sig = (
    noiseFloor: number,
    peakP95: number,
    energyP95: number,
    noiseFloorMode: 'auto' | 'manual' = 'auto',
  ): Pick<KineticSignature, 'extraction' | 'stats'> => ({
    extraction: {
      method: 'farneback',
      params: { pyrScale: 0.5, levels: 3, winsize: 15, iterations: 3, polyN: 5, polySigma: 1.2 },
      analysisWidth: 320,
      noiseFloor,
      noiseFloorMode,
      temporalSmoothingFrames: 3,
    },
    stats: { peak: stat(peakP95), energy: stat(energyP95) },
  });

  it('is false for ordinary clips', () => {
    // A still clip: the floor stays at its minimum and nothing moves.
    expect(noiseFloorLooksHigh(sig(MIN_NOISE_FLOOR, 0, 0))).toBe(false);
    // A dot crossing a clean frame (numbers from the dot fixture).
    expect(noiseFloorLooksHigh(sig(MIN_NOISE_FLOOR, 0.25, 0.014))).toBe(false);
    // A still clip with camera noise: the floor rose to meet the noise, and that's right.
    expect(noiseFloorLooksHigh(sig(0.0071, 0, 0.0014))).toBe(false);
    // Camera shake raised the floor, but the real movement is far above it.
    expect(noiseFloorLooksHigh(sig(0.05, 0.5, 0.2))).toBe(false);
  });

  it('is true when the automatic floor rose to meet movement that never stops', () => {
    // Movement filling the frame the whole time: the floor swallowed it.
    expect(noiseFloorLooksHigh(sig(0.24, 0.001, 0.003))).toBe(true);
    // Floor above half of the strong cell speeds.
    expect(noiseFloorLooksHigh(sig(0.1, 0.15, 0.08))).toBe(true);
    // Little got through, even though the strongest cells did.
    expect(noiseFloorLooksHigh(sig(0.1, 0.5, 0.02))).toBe(true);
  });

  it('is false for a manual floor, whatever its value', () => {
    expect(noiseFloorLooksHigh(sig(0.24, 0.001, 0.003, 'manual'))).toBe(false);
  });

  it('copes with missing stats', () => {
    expect(noiseFloorLooksHigh({ ...sig(0.24, 0, 0), stats: {} })).toBe(true);
    expect(noiseFloorLooksHigh({ ...sig(MIN_NOISE_FLOOR, 0, 0), stats: {} })).toBe(false);
  });
});
