/**
 * Reverb rebuilds during playback (Persistence drags) and the impulse-response cache.
 *
 * The Web Audio pieces are small fakes that record what the reverb does: which convolvers it
 * builds and when, and the automation of each side's send and return. The audio clock is
 * moved by hand.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  cachedImpulseResponse,
  clearImpulseCache,
  generateImpulseResponse,
  hasCachedImpulseResponse,
  IMPULSE_CACHE_MAX_SAMPLES,
  impulseCacheInfo,
  impulseLength,
} from '../../src/materials/sound/shared/impulse';
import {
  CROSSFADE_SEC,
  DECAY_TOLERANCE,
  REBUILD_INTERVAL_SEC,
  Reverb,
  SETTLE_SEC,
} from '../../src/materials/sound/shared/reverb';

const SR = 8000;

/** An AudioParam that follows setValueAtTime / linearRamp / cancelAndHold closely enough. */
class FakeParam {
  value: number;
  private events: { type: 'set' | 'ramp'; value: number; time: number }[] = [];

  constructor(value: number) {
    this.value = value;
  }

  setValueAtTime(value: number, time: number): void {
    this.insert({ type: 'set', value, time });
  }

  linearRampToValueAtTime(value: number, time: number): void {
    this.insert({ type: 'ramp', value, time });
  }

  cancelAndHoldAtTime(time: number): void {
    // The reverb (through RampedParam) always sets the held value at `time` right after.
    this.events = this.events.filter((e) => e.time <= time);
  }

  valueAt(time: number): number {
    let v = this.value;
    let t = 0;
    for (const e of this.events) {
      if (e.time > time) {
        return e.type === 'ramp' && e.time > t
          ? v + ((e.value - v) * (time - t)) / (e.time - t)
          : v;
      }
      v = e.value;
      t = e.time;
    }
    return v;
  }

  private insert(e: { type: 'set' | 'ramp'; value: number; time: number }): void {
    let i = this.events.length;
    while (i > 0 && (this.events[i - 1]?.time ?? 0) > e.time) i--;
    this.events.splice(i, 0, e);
  }
}

class FakeNode {
  readonly outputs = new Set<FakeNode>();
  constructor(readonly ctx: FakeContext) {}
  connect(target: FakeNode): void {
    this.outputs.add(target);
  }
  disconnect(target?: FakeNode): void {
    if (target) this.outputs.delete(target);
    else this.outputs.clear();
  }
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam(1);
  channelCount = 2;
  channelCountMode = 'max';
  channelInterpretation = 'speakers';
}

class FakeConvolver extends FakeNode {
  normalize = true;
  /** Context time the buffer was set, and whether anything fed it then. */
  setAt: number[] = [];
  connectedWhenSet = false;
  private current: unknown = null;
  get buffer(): unknown {
    return this.current;
  }
  set buffer(b: unknown) {
    this.setAt.push(this.ctx.currentTime);
    this.connectedWhenSet ||= this.ctx.feeds(this);
    this.current = b;
  }
}

class FakeContext {
  currentTime = 0;
  readonly sampleRate = SR;
  readonly gains: FakeGain[] = [];
  readonly convolvers: FakeConvolver[] = [];
  createGain(): FakeGain {
    const g = new FakeGain(this);
    this.gains.push(g);
    return g;
  }
  createConvolver(): FakeConvolver {
    const c = new FakeConvolver(this);
    this.convolvers.push(c);
    return c;
  }
  createBuffer(channels: number, length: number, sampleRate: number) {
    return { numberOfChannels: channels, length, sampleRate, copyToChannel() {} };
  }
  feeds(node: FakeNode): boolean {
    return [...this.gains, ...this.convolvers].some((n) => n.outputs.has(node));
  }
  /** The two sides: send → convolver → return, in the order the reverb made them. */
  sides(): { send: FakeGain; ret: FakeGain }[] {
    // Made in the constructor: input, output, then send and return per side.
    const [, , send0, ret0, send1, ret1] = this.gains;
    if (!send0 || !ret0 || !send1 || !ret1) throw new Error('no sides');
    return [
      { send: send0, ret: ret0 },
      { send: send1, ret: ret1 },
    ];
  }
  /** The convolver currently between a side's send and return. */
  convolverOf(side: { send: FakeGain }): FakeConvolver | undefined {
    return this.convolvers.find((c) => side.send.outputs.has(c));
  }
}

function setup(): { ctx: FakeContext; reverb: Reverb } {
  const ctx = new FakeContext();
  const reverb = new Reverb(ctx as unknown as BaseAudioContext, { seed: 7 });
  return { ctx, reverb };
}

/** Let queued microtasks and tasks run (the reverb works right after the current task). */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** One schedule window every `stepSec` for `seconds`, asking for `decay(t)`. */
async function play(
  ctx: FakeContext,
  reverb: Reverb,
  seconds: number,
  decay: (t: number) => number,
  stepSec = 0.025,
): Promise<void> {
  const end = ctx.currentTime + seconds;
  while (ctx.currentTime < end - 1e-9) {
    ctx.currentTime += stepSec;
    reverb.setDecay(decay(ctx.currentTime), ctx.currentTime + 0.03);
    await settle();
  }
}

beforeEach(() => {
  clearImpulseCache();
});

describe('reverb: first load', () => {
  it('loads nothing until the first decay, then loads it at once', () => {
    const { ctx, reverb } = setup();
    expect(ctx.convolvers).toHaveLength(0);
    expect(reverb.decaySec).toBeNaN();
    // The offline render calls this before rendering: it must not wait for anything.
    reverb.setDecayNow(1.5, 0);
    expect(ctx.convolvers).toHaveLength(1);
    expect(reverb.decaySec).toBe(1.5);
    expect(reverb.rebuilds).toBe(1);
    const [first] = ctx.sides();
    expect(first && ctx.convolverOf(first)).toBe(ctx.convolvers[0]);
  });

  it('still loads a decay given to the constructor at once', () => {
    const ctx = new FakeContext();
    const reverb = new Reverb(ctx as unknown as BaseAudioContext, { seed: 7, decaySec: 2 });
    expect(ctx.convolvers).toHaveLength(1);
    expect(reverb.decaySec).toBe(2);
  });
});

describe('reverb: changes during playback', () => {
  it('changes the decay after the current task, preparing the response before the convolver', async () => {
    const { ctx, reverb } = setup();
    reverb.setDecayNow(1, 0);
    ctx.currentTime = 1;
    reverb.setDecay(3, 1.03);
    // Nothing in the middle of scheduling.
    expect(impulseCacheInfo().misses).toBe(1);
    await settle();
    // First the impulse response (generated and cached), no convolver yet.
    expect(impulseCacheInfo().misses).toBe(2);
    expect(ctx.convolvers).toHaveLength(1);
    // A scheduler tick later, the convolver, on the silent side, then a crossfade.
    await play(ctx, reverb, 0.1, () => 3);
    expect(ctx.convolvers).toHaveLength(2);
    expect(reverb.decaySec).toBe(3);
    const [a, b] = ctx.sides();
    if (!a || !b) throw new Error('sides');
    expect(ctx.convolverOf(b)).toBe(ctx.convolvers[1]);
    const later = ctx.currentTime + CROSSFADE_SEC + 0.1;
    expect(b.send.gain.valueAt(later)).toBe(1);
    expect(a.send.gain.valueAt(later)).toBe(0);
    // The outgoing tail rings on.
    expect(a.ret.gain.valueAt(later)).toBe(1);
  });

  it('rebuilds at most once per interval during a drag, and ends on the exact last value', async () => {
    const { ctx, reverb } = setup();
    reverb.setDecayNow(0.5, 0);
    const builtAt: number[] = [];
    const before = ctx.convolvers.length;
    // Drag Persistence from 0.5 s to 6 s decay over a second, a step every 25 ms.
    const drag = (t: number): number => 0.5 * Math.pow(12, Math.min(1, t));
    let seen = before;
    const end = 1.8;
    while (ctx.currentTime < end) {
      ctx.currentTime += 0.025;
      reverb.setDecay(drag(ctx.currentTime), ctx.currentTime + 0.03);
      await settle();
      if (ctx.convolvers.length > seen) {
        seen = ctx.convolvers.length;
        builtAt.push(ctx.currentTime);
      }
    }
    expect(builtAt.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < builtAt.length; i++) {
      expect((builtAt[i] ?? 0) - (builtAt[i - 1] ?? 0)).toBeGreaterThanOrEqual(
        REBUILD_INTERVAL_SEC - 1e-9,
      );
    }
    // After the drag, the last value is applied exactly.
    await play(ctx, reverb, SETTLE_SEC + 1, () => 6);
    expect(reverb.decaySec).toBe(6);
  });

  it('never rebuilds a side that may still be sounding, and never touches a playing convolver', async () => {
    const { ctx, reverb } = setup();
    reverb.setDecayNow(2, 0);
    const sides = ctx.sides();
    // Long decays (their tails outlast the test) moving back and forth, a window every 25 ms.
    let replaced = 0;
    for (let k = 0; k < 120; k++) {
      const before = sides.map((s) => ctx.convolverOf(s));
      ctx.currentTime += 0.025;
      reverb.setDecay(2 + 3 * Math.abs(Math.sin(ctx.currentTime * 2)), ctx.currentTime + 0.03);
      await settle();
      sides.forEach((side, i) => {
        const old = before[i];
        if (old && ctx.convolverOf(side) !== old) {
          // Its old convolver was still ringing: the return must already be silent.
          replaced++;
          expect(side.ret.gain.valueAt(ctx.currentTime)).toBe(0);
          expect(old.outputs.size).toBe(0);
          expect(side.send.outputs.has(old)).toBe(false);
        }
      });
    }
    expect(replaced).toBeGreaterThanOrEqual(3);
    // Every convolver got its buffer exactly once, before anything fed it.
    for (const c of ctx.convolvers) {
      expect(c.setAt).toHaveLength(1);
      expect(c.connectedWhenSet).toBe(false);
    }
  });

  it('crossfades back to the other side without a rebuild when the value returns to it', async () => {
    const { ctx, reverb } = setup();
    reverb.setDecayNow(1.5, 0);
    await play(ctx, reverb, 0.6, () => 3);
    expect(reverb.decaySec).toBe(3);
    const built = reverb.rebuilds;
    await play(ctx, reverb, 0.6, () => 1.5);
    expect(reverb.decaySec).toBe(1.5);
    expect(reverb.rebuilds).toBe(built);
  });

  it('waits on small changes while the value moves, then applies it exactly once settled', async () => {
    const { ctx, reverb } = setup();
    reverb.setDecayNow(2, 0);
    const small = 2 * (1 + DECAY_TOLERANCE / 2);
    await play(ctx, reverb, SETTLE_SEC / 2, () => small);
    expect(reverb.decaySec).toBe(2);
    await play(ctx, reverb, SETTLE_SEC + 0.3, () => small);
    expect(reverb.decaySec).toBe(small);
  });

  it('finishes a crossfade in progress at a seek (in the engine’s silence)', async () => {
    const { ctx, reverb } = setup();
    reverb.setDecayNow(1, 0);
    await play(ctx, reverb, 0.2, () => 2.5);
    const [a, b] = ctx.sides();
    if (!a || !b) throw new Error('sides');
    // Mid-crossfade (it takes CROSSFADE_SEC), a seek lands at `at`.
    const at = ctx.currentTime + 0.001;
    reverb.setDecayNow(2.5, at);
    expect(b.send.gain.valueAt(at)).toBe(1);
    expect(a.send.gain.valueAt(at + 0.001)).toBe(0);
  });

  it('does nothing after it is disposed', async () => {
    const { ctx, reverb } = setup();
    reverb.setDecayNow(1, 0);
    ctx.currentTime = 1;
    reverb.setDecay(4, 1.03);
    reverb.dispose();
    await settle();
    expect(impulseCacheInfo().misses).toBe(1);
  });
});

describe('impulse response cache', () => {
  const opts = { sampleRate: SR, decaySec: 1.5, seed: 42 };

  it('gives exactly what generation gives, and generates each response once', () => {
    const fresh = generateImpulseResponse(opts);
    expect(hasCachedImpulseResponse(opts)).toBe(false);
    const first = cachedImpulseResponse(opts);
    expect(hasCachedImpulseResponse(opts)).toBe(true);
    const again = cachedImpulseResponse(opts);
    expect(again).toBe(first);
    expect(first[0]).toEqual(fresh[0]);
    expect(first[1]).toEqual(fresh[1]);
    expect(impulseCacheInfo()).toMatchObject({ hits: 1, misses: 1, entries: 1 });
    // Any option changes the key.
    expect(cachedImpulseResponse({ ...opts, damping: 0.6 })).not.toBe(first);
    expect(cachedImpulseResponse({ ...opts, seed: 43 })).not.toBe(first);
    expect(cachedImpulseResponse({ ...opts, decaySec: 1.6 })).not.toBe(first);
  });

  it('forgets the least recently used responses beyond its budget', () => {
    // 48 kHz, 6 s: ~0.46 M samples each, so the budget holds about eight.
    const big = (seed: number) => ({ sampleRate: 48000, decaySec: 6, seed });
    const each = 2 * impulseLength(big(0));
    const fits = Math.floor(IMPULSE_CACHE_MAX_SAMPLES / each);
    for (let s = 0; s < fits; s++) cachedImpulseResponse(big(s));
    cachedImpulseResponse(big(0)); // touch the oldest: now the most recent
    cachedImpulseResponse(big(100)); // one too many: evicts the least recent (seed 1)
    expect(hasCachedImpulseResponse(big(0))).toBe(true);
    expect(hasCachedImpulseResponse(big(1))).toBe(false);
    expect(hasCachedImpulseResponse(big(100))).toBe(true);
    expect(impulseCacheInfo().samples).toBeLessThanOrEqual(IMPULSE_CACHE_MAX_SAMPLES);
  });
});
