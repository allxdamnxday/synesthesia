import { describe, expect, it } from 'vitest';
import { createSyntheticSampler } from '../../src/signature/synthetic';

describe('synthetic sampler', () => {
  it('plays a wink: down while closing, up while opening, with onsets', () => {
    const s = createSyntheticSampler('wink');
    expect(s.signatureDuration).toBeCloseTo(2.2, 1);
    expect(s.sample(0.75).features.flowY).toBeGreaterThan(0); // closing: moving down (y down)
    expect(s.sample(1.35).features.flowY).toBeLessThan(0); // opening: moving up
    expect(s.onsetsBetween(0, s.duration).length).toBeGreaterThanOrEqual(2);
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
