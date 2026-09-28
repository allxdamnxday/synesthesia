import { describe, expect, it } from 'vitest';
import { createSampler } from '../../src/signature/sampler';
import {
  createSyntheticSampler,
  createSyntheticSignature,
  SYNTHETIC_NOISE_FLOOR,
} from '../../src/signature/synthetic';
import { FEATURE_NAMES } from '../../src/signature/types';

describe('synthetic sampler', () => {
  it('plays a wink: down while closing, up while opening, with onsets', () => {
    const s = createSyntheticSampler('wink');
    expect(s.signatureDuration).toBeCloseTo(2.2, 1);
    expect(s.sample(0.75).features.flowY).toBeGreaterThan(0); // closing: moving down (y down)
    expect(s.sample(1.35).features.flowY).toBeLessThan(0); // opening: moving up
    const onsets = s.onsetsBetween(0, s.duration);
    expect(onsets.length).toBeGreaterThanOrEqual(2);
    // One as the lid starts to close (0.6–0.9 s), one as it starts to open (1.15–1.45 s).
    expect(onsets[0]).toBeGreaterThan(0.6);
    expect(onsets[0]).toBeLessThan(0.9);
    expect(onsets.some((t) => t > 1.15 && t < 1.45)).toBe(true);
  });

  it('returns a zero field in the tail', () => {
    const s = createSyntheticSampler('wink');
    s.configure({ tailSec: 2 });
    const f = s.sample(s.signatureDuration + 1);
    expect(f.inTail).toBe(true);
    expect(f.field.every((x) => x === 0)).toBe(true);
    expect(f.features.energy).toBe(0);
  });

  it('pingpong reverses the second pass', () => {
    const s = createSyntheticSampler('wink');
    s.configure({ loops: 2, loopMode: 'pingpong', tailSec: 0 });
    const forward = s.sample(0.75).features.flowY;
    const mirrored = s.sample(2 * s.signatureDuration - 0.75).features.flowY;
    expect(mirrored).toBeCloseTo(-forward, 5);
    expect(s.duration).toBeCloseTo(2 * s.signatureDuration, 5);
  });

  it('strength scales the field and velocity features only', () => {
    const s = createSyntheticSampler('sweep');
    const a = s.sample(1).features.energy;
    const cx = s.sample(1).features.centroidX;
    s.configure({ strength: 2 });
    expect(s.sample(1).features.energy).toBeCloseTo(2 * a, 6);
    expect(s.sample(1).features.centroidX).toBeCloseTo(cx, 6);
  });

  it('speed stretches the timeline', () => {
    const s = createSyntheticSampler('wink');
    s.configure({ speed: 0.5, tailSec: 0 });
    expect(s.duration).toBeCloseTo(2 * s.signatureDuration, 5);
  });
});

describe('synthetic signatures (built by the real pipeline)', () => {
  it('are complete signatures with a fixed label for a hash', () => {
    const sig = createSyntheticSignature('wink');
    expect(sig.format).toBe('sp-signature');
    expect(sig.version).toBe(1);
    expect(sig.id).toBe('synthetic-wink');
    expect(sig.contentHash).toBe('synthetic-wink');
    expect(sig.frameRate).toBe(30);
    expect(sig.frameCount).toBe(66);
    expect(sig.grid).toEqual({ cols: 32, rows: 18 });
    expect(sig.extraction.noiseFloorMode).toBe('manual');
    expect(sig.extraction.noiseFloor).toBe(SYNTHETIC_NOISE_FLOOR);
    for (const name of FEATURE_NAMES) {
      expect(sig.features[name]).toHaveLength(66);
      expect(sig.features[name].every(Number.isFinite), name).toBe(true);
      expect(sig.stats[name]).toBeDefined();
    }
    // The sampler accepts it as it is.
    expect(createSampler(sig).signatureDuration).toBeCloseTo(2.2, 5);
  });

  it('are identical on every call', () => {
    expect(JSON.stringify(createSyntheticSignature('swirl'))).toBe(
      JSON.stringify(createSyntheticSignature('swirl')),
    );
  });

  it('honour fps and grid options', () => {
    const sig = createSyntheticSignature('sweep', { fps: 60, cols: 16, rows: 9 });
    expect(sig.frameRate).toBe(60);
    expect(sig.frameCount).toBe(168);
    expect(sig.grid).toEqual({ cols: 16, rows: 9 });
  });

  it('read like their movements: the swirl turns clockwise, the wink closes toward the cheek', () => {
    const swirl = createSyntheticSignature('swirl');
    expect(swirl.stats.curl?.mean).toBeGreaterThan(0);
    expect(Math.abs(swirl.stats.divergence?.mean ?? 1)).toBeLessThan(1e-9);
    const wink = createSyntheticSignature('wink');
    // Lid down and cheek up at once: the moving parts gather.
    expect(Math.min(...wink.features.divergence.slice(18, 30))).toBeLessThan(0);
    const still = createSyntheticSignature('still');
    expect(still.features.energy.every((e) => e === 0)).toBe(true);
    expect(still.features.onsets).toEqual([]);
  });
});
