import { describe, expect, it } from 'vitest';
import { createRng, shuffleInPlace } from '../../src/chance/prng';
import { defaultTimeline, timelineDuration } from '../../src/engine/composition';
import {
  createSampler,
  lerpAngle,
  resolveSamplerConfig,
  smoothFrames,
  smoothingHalfWindow,
} from '../../src/signature/sampler';
import {
  DEFAULT_SAMPLER_CONFIG,
  FEATURE_NAMES,
  SIGNED_FEATURES,
  type LoopMode,
  type SignatureFrame,
} from '../../src/signature/types';
import { makeSignature } from './helpers/signatureFactory';

/**
 * Signature A: 10 fps, 5 frames (0.5 s), 2×1 grid.
 * Cell 0 = (f, −f), cell 1 = (f + 1, −f); energy = f; flowX = f − 2; flowY = 0.5;
 * direction = 0.1 f; centroidX = 0.2 + 0.1 f; centroidY = 0.9 − 0.1 f;
 * coherence = 0.7 (constant); continuity = 1 − 0.1 f; jerk = 2 f.
 */
function signatureA() {
  return makeSignature({
    frameRate: 10,
    frameCount: 5,
    cols: 2,
    rows: 1,
    field: (f, _r, c) => [f + c, -f],
    features: {
      energy: (f) => f,
      flowX: (f) => f - 2,
      flowY: () => 0.5,
      direction: (f) => 0.1 * f,
      centroidX: (f) => 0.2 + 0.1 * f,
      centroidY: (f) => 0.9 - 0.1 * f,
      coherence: () => 0.7,
      continuity: (f) => 1 - 0.1 * f,
      jerk: (f) => 2 * f,
    },
  });
}

const NO_SMOOTHING = { smoothing: 0, tailSec: 0 } as const;

function snapshot(frame: SignatureFrame) {
  return {
    t: frame.t,
    inTail: frame.inTail,
    field: Array.from(frame.field),
    features: { ...frame.features },
    normalized: { ...frame.normalized },
  };
}

describe('sampler timing and interpolation', () => {
  it('interpolates field and features linearly between frames', () => {
    const s = createSampler(signatureA(), NO_SMOOTHING);
    expect(s.signatureDuration).toBeCloseTo(0.5, 12);
    expect(s.duration).toBeCloseTo(0.5, 12);
    const f = s.sample(0.15); // frame position 1.5
    expect(f.inTail).toBe(false);
    expect(f.cols).toBe(2);
    expect(f.rows).toBe(1);
    expect(f.field[0]).toBeCloseTo(1.5, 6);
    expect(f.field[1]).toBeCloseTo(-1.5, 6);
    expect(f.field[2]).toBeCloseTo(2.5, 6);
    expect(f.field[3]).toBeCloseTo(-1.5, 6);
    expect(f.features.energy).toBeCloseTo(1.5, 9);
    expect(f.features.flowX).toBeCloseTo(-0.5, 9);
    expect(f.features.direction).toBeCloseTo(0.15, 9);
    expect(f.features.centroidX).toBeCloseTo(0.35, 9);
    expect(f.features.continuity).toBeCloseTo(0.85, 9);
  });

  it('returns stored values exactly at frame times', () => {
    const sig = signatureA();
    const s = createSampler(sig, NO_SMOOTHING);
    for (let i = 0; i < sig.frameCount; i++) {
      const f = s.sample(i / sig.frameRate);
      for (const name of FEATURE_NAMES) {
        expect(f.features[name], name).toBeCloseTo(sig.features[name][i], 9);
      }
    }
  });

  it('holds the last frame for the final frame interval of a pass', () => {
    const s = createSampler(signatureA(), NO_SMOOTHING);
    expect(s.sample(0.4).features.energy).toBeCloseTo(4, 9);
    expect(s.sample(0.45).features.energy).toBeCloseTo(4, 9);
    expect(s.sample(0.4999).features.energy).toBeCloseTo(4, 9);
  });

  it('interpolates direction along the shorter arc across ±π', () => {
    const sig = makeSignature({
      frameRate: 10,
      frameCount: 4,
      features: { direction: (f) => (f % 2 === 0 ? 3 : -3) },
    });
    const s = createSampler(sig, NO_SMOOTHING);
    const mid = s.sample(0.05).features.direction; // halfway between 3 and −3
    expect(Math.abs(Math.abs(mid) - Math.PI)).toBeLessThan(1e-9);
    const quarter = s.sample(0.025).features.direction;
    expect(quarter).toBeCloseTo(3 + (2 * Math.PI - 6) / 4, 9);
  });

  it('loops the whole pass', () => {
    const s = createSampler(signatureA(), { ...NO_SMOOTHING, loops: 2 });
    expect(s.duration).toBeCloseTo(1, 12);
    const first = snapshot(s.sample(0.15));
    const second = snapshot(s.sample(0.65));
    for (const name of FEATURE_NAMES) {
      expect(second.features[name], name).toBeCloseTo(first.features[name], 9);
    }
    second.field.forEach((v, i) => expect(v).toBeCloseTo(first.field[i], 6));
    expect(s.sample(0.5).features.energy).toBeCloseTo(0, 9); // second pass starts at frame 0
  });

  it('pingpong plays odd passes backwards, negating signed velocity', () => {
    const s = createSampler(signatureA(), { ...NO_SMOOTHING, loops: 2, loopMode: 'pingpong' });
    const back = snapshot(s.sample(0.65)); // reversed pass, 0.15 s in → frame position 3.5
    const fwd = snapshot(s.sample(0.35)); // forward pass at frame position 3.5
    expect(back.features.energy).toBeCloseTo(fwd.features.energy, 9);
    expect(back.features.energy).toBeCloseTo(3.5, 9);
    expect(back.features.jerk).toBeCloseTo(fwd.features.jerk, 9);
    expect(back.features.continuity).toBeCloseTo(fwd.features.continuity, 9);
    expect(back.features.centroidX).toBeCloseTo(fwd.features.centroidX, 9);
    expect(back.features.flowX).toBeCloseTo(-fwd.features.flowX, 9);
    expect(back.features.flowY).toBeCloseTo(-fwd.features.flowY, 9);
    expect(back.features.direction).toBeCloseTo(0.35 - Math.PI, 9);
    back.field.forEach((v, i) => expect(v).toBeCloseTo(-fwd.field[i], 6));
    // The turnaround holds the last frame on both sides; the reversed pass ends at frame 0.
    expect(s.sample(0.499).features.energy).toBeCloseTo(4, 9);
    expect(s.sample(0.501).features.energy).toBeCloseTo(4, 9);
    expect(s.sample(0.999).features.energy).toBeCloseTo(0.01, 6);
  });

  it('negates every signed feature in reversed passes', () => {
    const sig = makeSignature({
      frameRate: 10,
      frameCount: 5,
      features: Object.fromEntries(FEATURE_NAMES.map((n) => [n, (f: number) => 0.1 + f * 0.2])),
    });
    const s = createSampler(sig, { ...NO_SMOOTHING, loops: 2, loopMode: 'pingpong' });
    const fwd = snapshot(s.sample(0.2));
    const back = snapshot(s.sample(0.8)); // mirrors t = 0.2
    for (const name of FEATURE_NAMES) {
      if (name === 'direction') continue;
      const expected = SIGNED_FEATURES.has(name) ? -fwd.features[name] : fwd.features[name];
      expect(back.features[name], name).toBeCloseTo(expected, 9);
    }
  });

  it('speed stretches and compresses the timeline', () => {
    const fast = createSampler(signatureA(), { ...NO_SMOOTHING, speed: 2 });
    expect(fast.duration).toBeCloseTo(0.25, 12);
    expect(fast.sample(0.075).features.energy).toBeCloseTo(1.5, 9);
    const slow = createSampler(signatureA(), { ...NO_SMOOTHING, speed: 0.5 });
    expect(slow.duration).toBeCloseTo(1, 12);
    expect(slow.sample(0.3).features.energy).toBeCloseTo(1.5, 9);
  });

  it('matches timelineDuration() for the same settings', () => {
    const sig = signatureA();
    const s = createSampler(sig);
    for (const [speed, loops, tailSec] of [
      [1, 1, 3],
      [0.25, 8, 10],
      [2, 3, 0],
      [0.1, 2, 1],
    ]) {
      s.configure({ speed, loops, tailSec });
      const timeline = { ...defaultTimeline(), speed, loops, tailSec };
      expect(s.duration).toBeCloseTo(timelineDuration(s.signatureDuration, timeline), 12);
    }
  });
});

describe('sampler tail', () => {
  it('rests after the movement: zero field, held position and direction', () => {
    const s = createSampler(signatureA(), { smoothing: 0, tailSec: 1 });
    expect(s.duration).toBeCloseTo(1.5, 12);
    const f = s.sample(0.7);
    expect(f.inTail).toBe(true);
    expect(Array.from(f.field).every((v) => v === 0)).toBe(true);
    expect(f.features.energy).toBe(0);
    expect(f.features.flowX).toBe(0);
    expect(f.features.jerk).toBe(0);
    expect(f.features.coherence).toBe(0);
    expect(f.features.continuity).toBe(1);
    expect(f.features.centroidX).toBeCloseTo(0.6, 9);
    expect(f.features.centroidY).toBeCloseTo(0.5, 9);
    expect(f.features.direction).toBeCloseTo(0.4, 9);
    expect(s.sample(0.5).inTail).toBe(true);
    expect(s.sample(0.4999).inTail).toBe(false);
    expect(s.sample(100).inTail).toBe(true);
  });

  it('holds the last frame played when the final pass runs backwards', () => {
    const s = createSampler(signatureA(), {
      smoothing: 0,
      tailSec: 1,
      loops: 2,
      loopMode: 'pingpong',
    });
    const f = s.sample(1.2);
    expect(f.inTail).toBe(true);
    expect(f.features.centroidX).toBeCloseTo(0.2, 9); // frame 0
    expect(f.features.centroidY).toBeCloseTo(0.9, 9);
    expect(Math.abs(f.features.direction)).toBeCloseTo(Math.PI, 9); // frame 0 reversed
  });

  it('cuts a fractional last pass short and holds where it stopped', () => {
    const s = createSampler(signatureA(), { smoothing: 0, tailSec: 1, loops: 1.5 });
    expect(s.duration).toBeCloseTo(1.75, 12);
    expect(s.sample(0.74).inTail).toBe(false);
    const f = s.sample(0.76);
    expect(f.inTail).toBe(true);
    expect(f.features.centroidX).toBeCloseTo(0.2 + 0.1 * 2.5, 9); // frame position 2.5
  });

  it('rests before time zero without entering the tail', () => {
    const s = createSampler(signatureA(), NO_SMOOTHING);
    for (const t of [-0.1, Number.NaN, Number.NEGATIVE_INFINITY]) {
      const f = s.sample(t);
      expect(f.inTail).toBe(false);
      expect(f.features.energy).toBe(0);
      expect(f.features.continuity).toBe(1);
      expect(f.features.centroidX).toBeCloseTo(0.2, 9);
      expect(Array.from(f.field).every((v) => v === 0)).toBe(true);
    }
  });
});

describe('sampler strength', () => {
  it('scales the field and velocity features only', () => {
    const s = createSampler(signatureA(), NO_SMOOTHING);
    const base = snapshot(s.sample(0.15));
    s.configure({ strength: 2 });
    const strong = snapshot(s.sample(0.15));
    strong.field.forEach((v, i) => expect(v).toBeCloseTo(2 * base.field[i], 6));
    expect(strong.features.energy).toBeCloseTo(2 * base.features.energy, 9);
    expect(strong.features.flowX).toBeCloseTo(2 * base.features.flowX, 9);
    expect(strong.features.jerk).toBeCloseTo(2 * base.features.jerk, 9);
    for (const name of [
      'continuity',
      'centroidX',
      'centroidY',
      'direction',
      'coherence',
    ] as const) {
      expect(strong.features[name], name).toBeCloseTo(base.features[name], 9);
    }
    s.configure({ strength: 0 });
    expect(Array.from(s.sample(0.15).field).every((v) => v === 0)).toBe(true);
    expect(s.sample(0.15).features.direction).toBeCloseTo(0.15, 9);
  });
});

describe('sampler normalization', () => {
  it('maps unsigned features with p05/p95 and signed features by p95(|x|)', () => {
    const s = createSampler(signatureA(), NO_SMOOTHING);
    const f = s.sample(0.15);
    // energy 0..4: p05 = 0.2, p95 = 3.8
    expect(f.normalized.energy).toBeCloseTo((1.5 - 0.2) / 3.6, 9);
    // flowX −2..2: p95(|x|) = 2
    expect(f.normalized.flowX).toBeCloseTo(-0.25, 9);
    // a constant feature has no range
    expect(f.normalized.coherence).toBe(0);
    expect(s.sample(0).normalized.energy).toBe(0); // below p05 clamps
    expect(s.sample(0.4).normalized.energy).toBe(1); // above p95 clamps
  });

  it('stays within range for every feature, strength and time', () => {
    const sig = makeSignature({
      frameRate: 24,
      frameCount: 48,
      cols: 3,
      rows: 2,
      field: (f, r, c) => [Math.sin(f * 0.3 + c), Math.cos(f * 0.2 + r)],
      features: Object.fromEntries(
        FEATURE_NAMES.map((n, q) => [n, (f: number) => Math.sin(f * 0.37 + q) * (q + 1)]),
      ),
    });
    const s = createSampler(sig);
    for (const strength of [0, 1, 3]) {
      for (const loopMode of ['loop', 'pingpong'] as LoopMode[]) {
        s.configure({ strength, loopMode, loops: 3, smoothing: 0.5, tailSec: 1 });
        for (let t = -0.5; t < s.duration + 0.5; t += 0.013) {
          const f = s.sample(t);
          for (const name of FEATURE_NAMES) {
            const v = f.normalized[name];
            expect(Number.isFinite(v), name).toBe(true);
            if (SIGNED_FEATURES.has(name)) {
              expect(v).toBeGreaterThanOrEqual(-1);
              expect(v).toBeLessThanOrEqual(1);
            } else {
              expect(v).toBeGreaterThanOrEqual(0);
              expect(v).toBeLessThanOrEqual(1);
            }
          }
        }
      }
    }
  });

  it('saturates when strength pushes past the signature range', () => {
    const s = createSampler(signatureA(), { ...NO_SMOOTHING, strength: 3 });
    const f = s.sample(0.4);
    expect(f.normalized.energy).toBe(1);
    expect(f.normalized.flowX).toBe(1);
  });
});

describe('sampler smoothing', () => {
  const impulse = () =>
    makeSignature({
      frameRate: 30,
      frameCount: 41,
      field: (f) => (f === 20 ? [1, -1] : [0, 0]),
      features: {
        energy: (f) => (f === 20 ? 1 : 0),
        direction: (f) => (f === 20 ? 1 : 0.5),
      },
    });

  it('computes the half-window from smoothing and frame rate', () => {
    expect(smoothingHalfWindow(0, 30)).toBe(0);
    expect(smoothingHalfWindow(0.4, 30)).toBe(3);
    expect(smoothingHalfWindow(1, 30)).toBe(8); // 17-frame window ≈ 0.57 s
    expect(smoothingHalfWindow(1, 60)).toBe(15);
    expect(smoothingHalfWindow(5, 30)).toBe(8); // clamped to 1
    expect(smoothingHalfWindow(Number.NaN, 30)).toBe(0);
  });

  it('is zero-phase: a centred impulse stays centred', () => {
    const s = createSampler(impulse(), { smoothing: 0.4, tailSec: 0 }); // half-window 3
    const energy: number[] = [];
    const u: number[] = [];
    for (let i = 0; i < 41; i++) {
      const f = s.sample(i / 30);
      energy.push(f.features.energy);
      u.push(f.field[0]);
    }
    for (let k = 0; k <= 10; k++) {
      expect(energy[20 - k]).toBeCloseTo(energy[20 + k], 9);
      expect(u[20 - k]).toBeCloseTo(u[20 + k], 6);
    }
    expect(energy[20]).toBeCloseTo(1 / 7, 9);
    expect(energy[17]).toBeCloseTo(1 / 7, 9);
    expect(energy[16]).toBeCloseTo(0, 9);
    const mass = energy.reduce((a, b) => a + b, 0);
    const centre = energy.reduce((a, b, i) => a + b * i, 0) / mass;
    expect(mass).toBeCloseTo(1, 9);
    expect(centre).toBeCloseTo(20, 9);
    // Direction is smoothed on the circle and stays symmetric too.
    const dir = Array.from({ length: 41 }, (_, i) => s.sample(i / 30).features.direction);
    for (let k = 0; k <= 5; k++) expect(dir[20 - k]).toBeCloseTo(dir[20 + k], 9);
    expect(dir[20]).toBeGreaterThan(0.5);
  });

  it('smoothing zero leaves the data untouched', () => {
    const s = createSampler(impulse(), { smoothing: 0, tailSec: 0 });
    expect(s.sample(20 / 30).features.energy).toBeCloseTo(1, 9);
    expect(s.sample(19 / 30).features.energy).toBeCloseTo(0, 9);
  });
});

describe('sampler purity', () => {
  const busy = () =>
    makeSignature({
      frameRate: 24,
      frameCount: 36,
      cols: 4,
      rows: 3,
      field: (f, r, c) => [Math.sin(f * 0.21 + c), Math.cos(f * 0.17 - r)],
      features: Object.fromEntries(
        FEATURE_NAMES.map((n, q) => [n, (f: number) => Math.sin(f * 0.29 + q * 1.3)]),
      ),
      onsets: [3, 17, 30],
    });

  it('random access equals sequential access', () => {
    const s = createSampler(busy(), {
      smoothing: 0.3,
      loops: 3,
      loopMode: 'pingpong',
      strength: 1.5,
      tailSec: 0.5,
    });
    const times = Array.from({ length: 200 }, (_, i) => (i * s.duration) / 199);
    const sequential = times.map((t) => snapshot(s.sample(t)));
    const order = shuffleInPlace(
      createRng(7),
      times.map((_, i) => i),
    );
    for (const i of order) expect(snapshot(s.sample(times[i]))).toEqual(sequential[i]);
  });

  it('gives identical results after smoothing changes and cache eviction', () => {
    const s = createSampler(busy(), { smoothing: 0.3 });
    const before = snapshot(s.sample(0.77));
    for (const smoothing of [0.9, 0, 0.5, 0.7, 1, 0.1]) {
      s.configure({ smoothing });
      s.sample(0.5);
    }
    s.configure({ smoothing: 0.3 });
    expect(snapshot(s.sample(0.77))).toEqual(before);
  });

  it('reuses one frame object and its arrays', () => {
    const s = createSampler(busy());
    const a = s.sample(0.1);
    const field = a.field;
    const b = s.sample(0.9);
    expect(b).toBe(a);
    expect(b.field).toBe(field);
    expect(b.t).toBe(0.9);
  });
});

describe('sampler onsets', () => {
  const withOnsets = (onsets: number[]) => makeSignature({ frameRate: 30, frameCount: 30, onsets }); // one pass = 1 s

  it('maps onsets across loops, pingpong and speed, in order', () => {
    const s = createSampler(withOnsets([6]), {
      loops: 3,
      loopMode: 'pingpong',
      speed: 2,
      tailSec: 1,
    });
    const all = s.onsetsBetween(0, s.duration);
    expect(all).toHaveLength(3);
    expect(all[0]).toBeCloseTo(0.1, 12);
    expect(all[1]).toBeCloseTo(0.9, 12);
    expect(all[2]).toBeCloseTo(1.1, 12);
    expect(s.onsetsBetween(0.5, 1)).toHaveLength(1);
    expect(s.onsetsBetween(0.2, 0.2)).toEqual([]);
    expect(s.onsetsBetween(1, 0)).toEqual([]);
  });

  it('uses half-open windows and excludes the tail', () => {
    const s = createSampler(withOnsets([0, 6]), { loops: 2, tailSec: 2 });
    const all = s.onsetsBetween(0, 10);
    expect(all).toHaveLength(4);
    [0, 0.2, 1, 1.2].forEach((x, i) => expect(all[i]).toBeCloseTo(x, 12));
    expect(s.onsetsBetween(0, 0.2)).toEqual([0]);
    s.configure({ loops: 1.1 });
    expect(s.onsetsBetween(0, 10)).toHaveLength(3); // 1.2 falls after the cut-short pass
  });
});

describe('sampler configuration', () => {
  it('keeps settings safe', () => {
    const s = createSampler(signatureA());
    expect(s.config).toEqual(DEFAULT_SAMPLER_CONFIG);
    s.configure({ speed: 0 });
    expect(s.config.speed).toBe(0.25);
    s.configure({ loops: 3 });
    s.configure({ loops: Number.NaN });
    expect(s.config.loops).toBe(3);
    s.configure({ smoothing: 2, strength: -1, tailSec: -5 });
    expect(s.config.smoothing).toBe(1);
    expect(s.config.strength).toBe(0);
    expect(s.config.tailSec).toBe(0);
    s.configure({ loopMode: 'sideways' as LoopMode });
    expect(s.config.loopMode).toBe('loop');
    expect(resolveSamplerConfig(DEFAULT_SAMPLER_CONFIG, { speed: undefined }).speed).toBe(1);
  });

  it('refuses a signature whose data is inconsistent', () => {
    const sig = signatureA();
    expect(() => createSampler({ ...sig, frameCount: 6 })).toThrow();
    expect(() => createSampler({ ...sig, frameCount: 0 })).toThrow();
  });
});

describe('smoothing helpers', () => {
  it('keeps constants and interior ramps unchanged', () => {
    const n = 20;
    const constant = new Float64Array(n).fill(3);
    const out = new Float64Array(n);
    smoothFrames(constant, n, 1, 4, out);
    out.forEach((v) => expect(v).toBeCloseTo(3, 12));
    const ramp = Float64Array.from({ length: n }, (_, i) => i * 0.5);
    smoothFrames(ramp, n, 1, 3, out);
    for (let i = 3; i < n - 3; i++) expect(out[i]).toBeCloseTo(ramp[i], 12);
  });

  it('smooths each channel independently', () => {
    const n = 9;
    const src = new Float64Array(n * 2);
    src[4 * 2] = 1; // impulse in channel 0 only
    const out = new Float64Array(n * 2);
    smoothFrames(src, n, 2, 1, out);
    expect(out[3 * 2]).toBeCloseTo(1 / 3, 12);
    expect(out[5 * 2]).toBeCloseTo(1 / 3, 12);
    for (let f = 0; f < n; f++) expect(out[f * 2 + 1]).toBe(0);
  });

  it('interpolates angles along the shorter arc', () => {
    expect(lerpAngle(0.2, 0.6, 0.5)).toBeCloseTo(0.4, 12);
    expect(lerpAngle(3, -3, 0)).toBe(3);
    expect(lerpAngle(-3, 3, 0.5)).toBeCloseTo(-Math.PI, 9);
    expect(lerpAngle(-Math.PI, -Math.PI, 0.5)).toBe(-Math.PI);
  });
});
