import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/chance/prng';
import type { PropertyValues, ScheduleWindow } from '../../src/materials/types';
import {
  eventBoundary,
  gridIndexAtOrAfter,
  gridIndexAtOrBefore,
  gridRange,
  onePoleCoefficient,
  timeConstantFor,
  windowOffset,
} from '../../src/materials/sound/shared/automation';
import {
  ControlTimeline,
  type ContinuityMode,
  type ControlProgram,
} from '../../src/materials/sound/shared/controlTimeline';
import { createSyntheticSampler } from '../../src/signature/synthetic';
import type { SignatureFrame, SignatureSampler } from '../../src/signature/types';

const RATE = 200;

describe('control grid', () => {
  it('assigns every grid point to exactly one of any contiguous windows', () => {
    const rng = createRng(11);
    for (let trial = 0; trial < 50; trial++) {
      const edges = [0];
      while ((edges[edges.length - 1] ?? 0) < 3)
        edges.push((edges[edges.length - 1] ?? 0) + 0.001 + rng() * 0.2);
      const seen: number[] = [];
      for (let i = 0; i + 1 < edges.length; i++) {
        const [first, end] = gridRange(edges[i] ?? 0, edges[i + 1] ?? 0, RATE);
        for (let k = first; k < end; k++) seen.push(k);
      }
      const [first, end] = gridRange(0, edges[edges.length - 1] ?? 0, RATE);
      expect(seen).toEqual(Array.from({ length: end - first }, (_, i) => first + i));
    }
  });

  it('treats times a hair off the grid as on it (floating-point tolerance)', () => {
    expect(gridIndexAtOrAfter(0.7000000000000001, RATE)).toBe(140);
    expect(gridIndexAtOrBefore(0.7, RATE)).toBe(140);
    expect(gridIndexAtOrAfter(0.05, RATE)).toBe(10);
    expect(gridIndexAtOrBefore(0.0049999, RATE)).toBe(0);
    // Event boundaries sit just before each grid point.
    expect(gridIndexAtOrBefore(eventBoundary(140, RATE), RATE)).toBe(140);
    expect(gridIndexAtOrBefore(eventBoundary(140, RATE) - 1e-7, RATE)).toBe(139);
  });

  it('maps composition time to context time with an exact zero offset offline', () => {
    expect(windowOffset({ t0: 1.25, ctxTimeAtT0: 1.25 })).toBe(0);
    expect(windowOffset({ t0: 0.5, ctxTimeAtT0: 3.5 })).toBeCloseTo(3, 12);
  });

  it('one-pole coefficients and glide time constants are sane', () => {
    expect(onePoleCoefficient(0, 0.005)).toBe(1);
    expect(onePoleCoefficient(0.005, 0.005)).toBeCloseTo(1 - Math.exp(-1), 12);
    expect(timeConstantFor(0.3)).toBeCloseTo(0.1, 12);
  });
});

/** A small program: a slow follower of energy, a counter, and a props-dependent gain. */
interface TestState {
  follow: number;
  steps: number;
  out: number;
}

const testProgram: ControlProgram<TestState> = {
  createState: () => ({ follow: 0, steps: 0, out: 0 }),
  reset: (s) => {
    s.follow = 0;
    s.steps = 0;
    s.out = 0;
  },
  copy: (from, to) => {
    Object.assign(to, from);
  },
  step: (s, frame: SignatureFrame, props: PropertyValues, dt: number) => {
    s.follow += (frame.normalized.energy - s.follow) * onePoleCoefficient(0.08, dt);
    s.steps++;
    s.out = s.follow * (props.gain ?? 1) + s.steps * 1e-6;
  },
};

interface Record {
  ctx: number;
  t: number;
  out: number;
  jump: boolean;
}

function runner(sampler: SignatureSampler) {
  const timeline = new ControlTimeline(testProgram, { historySec: 1 });
  const points: Record[] = [];
  const events: { t: number; ctx: number; out: number }[] = [];
  const modes: ContinuityMode[] = [];
  const schedule = (t0: number, t1: number, ctxTimeAtT0: number, props: PropertyValues = {}) => {
    const win: ScheduleWindow = { sampler, props, t0, t1, ctxTimeAtT0, controlRate: RATE };
    modes.push(
      timeline.schedule(win, {
        point: (ctx, s, t, jump) => points.push({ ctx, t, out: s.out, jump }),
        events: (from, to) => sampler.onsetsBetween(from, to),
        event: (t, ctx, s) => events.push({ t, ctx, out: s.out }),
      }),
    );
  };
  return { timeline, points, events, modes, schedule };
}

describe('control timeline', () => {
  it('writes identical points and events for one window or many (preview = offline)', () => {
    const sampler = createSyntheticSampler('wink');
    const single = runner(sampler);
    single.schedule(0, 2.2, 0);
    const rng = createRng(5);
    for (const split of [0.05, 0.037, 0.2, -1]) {
      const many = runner(sampler);
      let t = 0;
      while (t < 2.2) {
        const next = Math.min(2.2, t + (split > 0 ? split : 0.001 + rng() * 0.15));
        many.schedule(t, next, t);
        t = next;
      }
      expect(many.points).toEqual(single.points);
      expect(many.events).toEqual(single.events);
      expect(many.modes.slice(1).every((m) => m === 'continue')).toBe(true);
    }
    expect(single.events.length).toBeGreaterThanOrEqual(2);
  });

  it('handles an event exactly on a grid point at a window edge once, with the same state', () => {
    // A sampler whose only onset sits at 0.7 s, a grid point and (almost) a window edge.
    const base = createSyntheticSampler('wink');
    const sampler: SignatureSampler = {
      ...base,
      get duration() {
        return base.duration;
      },
      get config() {
        return base.config;
      },
      sample: (t) => base.sample(t),
      configure: (o) => base.configure(o),
      onsetsBetween: (t0, t1) => (0.7 >= t0 && 0.7 < t1 ? [0.7] : []),
    };
    const single = runner(sampler);
    single.schedule(0, 1, 0);
    const split = runner(sampler);
    for (let w = 0; w < 20; w++) split.schedule(w * 0.05, (w + 1) * 0.05, w * 0.05);
    expect(split.events).toEqual(single.events);
    expect(single.events).toHaveLength(1);
  });

  it('continues state across a loop wrap that is contiguous in context time', () => {
    const sampler = createSyntheticSampler('wink');
    const r = runner(sampler);
    r.schedule(0, 1.0, 10);
    r.schedule(1.0, 1.3, 11.0);
    // Wrap: composition time restarts at 0, context time carries on.
    r.schedule(0, 0.2, 11.3);
    expect(r.modes).toEqual(['start', 'continue', 'continue']);
    const afterWrap = r.points.filter((p) => p.ctx >= 11.3);
    // A reset would give ~1e-6 at t = 0 (silence, first step); continued state still carries
    // the follower's memory of the movement before the wrap.
    const fresh = runner(sampler);
    fresh.schedule(0, 0.2, 0);
    expect(fresh.points[0]?.out).toBeLessThan(1e-5);
    expect(afterWrap[0]?.out).toBeGreaterThan(0.01);
    expect(afterWrap[0]?.jump).toBe(false);
  });

  it('rewinds to the last kept point after a live edit, continuing with the new values', () => {
    const sampler = createSyntheticSampler('wink');
    const r = runner(sampler);
    const offset = 5;
    r.schedule(0, 1.0, offset, { gain: 1 });
    const cancelAt = 0.7234 + offset;
    r.timeline.cancelFrom(cancelAt);
    const kept = r.points.filter((p) => p.ctx < cancelAt).length;
    r.schedule(0.7234, 1.2, cancelAt, { gain: 2 });
    expect(r.modes[1]).toBe('rewind');

    // Reference: one pass with the gain switching at the first grid point after the edit.
    const ref = new ControlTimeline(testProgram);
    const refOut: number[] = [];
    const first = gridIndexAtOrAfter(0.7234, RATE);
    ref.schedule(
      {
        sampler,
        props: { gain: 1 },
        t0: 0,
        t1: first / RATE,
        ctxTimeAtT0: offset,
        controlRate: RATE,
      },
      { point: (_c, s) => refOut.push(s.out) },
    );
    ref.schedule(
      {
        sampler,
        props: { gain: 2 },
        t0: first / RATE,
        t1: 1.2,
        ctxTimeAtT0: offset + first / RATE,
        controlRate: RATE,
      },
      { point: (_c, s) => refOut.push(s.out) },
    );
    const after = r.points.slice(r.points.length - (refOut.length - kept));
    expect(after.map((p) => p.out)).toEqual(refOut.slice(kept));
    expect(after[0]?.jump).toBe(false);
  });

  it('resets and fast-forwards on a seek, matching playback from the start', () => {
    const sampler = createSyntheticSampler('wink');
    const r = runner(sampler);
    r.schedule(0, 0.5, 2);
    r.timeline.cancelFrom(2.3);
    r.schedule(1.1, 1.4, 2.3);
    expect(r.modes[1]).toBe('seek');
    const seekPoints = r.points.filter((p) => p.t >= 1.1 && p.ctx >= 2.3);
    expect(seekPoints[0]?.jump).toBe(true);

    const fresh = runner(sampler);
    fresh.schedule(0, 1.4, 0);
    const reference = fresh.points.filter((p) => p.t >= 1.1 - 1e-9).map((p) => p.out);
    expect(seekPoints.map((p) => p.out)).toEqual(reference);
  });

  it('treats a first window that starts later as a start with fast-forward', () => {
    const sampler = createSyntheticSampler('wink');
    const late = runner(sampler);
    late.schedule(0.8, 1.0, 40);
    const fresh = runner(sampler);
    fresh.schedule(0, 1.0, 0);
    expect(late.modes).toEqual(['start']);
    expect(late.points.map((p) => p.out)).toEqual(
      fresh.points.filter((p) => p.t >= 0.8 - 1e-9).map((p) => p.out),
    );
  });
});
