/**
 * Shared sound helpers: the resonant glide, pairwise and one-shot mixing, the drive stage,
 * control buses held across cancels, the seek dip, and noise kept in step with composition
 * time.
 */
import { describe, expect, it } from 'vitest';
import { ControlBus } from '../../src/materials/sound/shared/automation';
import type { ContinuityMode } from '../../src/materials/sound/shared/controlTimeline';
import {
  glideCoefficients,
  glideRestAt,
  glideStep,
  IDENTITY_GLIDE,
  type GlideMemory,
} from '../../src/materials/sound/shared/glide';
import {
  driveCurve,
  driveStageGains,
  mixPairwise,
  ONE_SHOT_SLOTS,
  OneShotMix,
} from '../../src/materials/sound/shared/graph';
import { HoldingControlBus } from '../../src/materials/sound/shared/holdingBus';
import {
  SEEK_DIP_IN_SEC,
  SEEK_DIP_SILENT_UNTIL_SEC,
  seekDipGain,
  seekGlideHolds,
  SEEK_GLIDE_SEC,
} from '../../src/materials/sound/shared/seekDip';
import {
  noiseOffset,
  noiseRestarts,
  TimelineNoise,
} from '../../src/materials/sound/shared/timelineNoise';

const DT = 1 / 200;

function memory(): GlideMemory {
  return { gx1: 0, gx2: 0, gy1: 0, gy2: 0 };
}

/** Step response of a glide towards 1 for `seconds`. */
function stepResponse(glideSec: number, q: number, seconds: number): number[] {
  const c = glideCoefficients(glideSec, q, DT);
  const m = memory();
  const out: number[] = [];
  for (let k = 0; k < seconds / DT; k++) out.push(glideStep(c, m, 1));
  return out;
}

describe('resonant glide', () => {
  it('passes values straight through with identity coefficients', () => {
    const m = memory();
    expect(glideStep(IDENTITY_GLIDE, m, 3)).toBe(3);
    expect(glideStep(IDENTITY_GLIDE, m, -2)).toBe(-2);
  });

  it('reaches ~90% in about glideSec without overshoot at Q 0.5', () => {
    const r = stepResponse(0.4, 0.5, 3);
    const at = (t: number) => r[Math.round(t / DT) - 1] ?? 0;
    expect(at(0.4)).toBeGreaterThan(0.75);
    expect(at(0.4)).toBeLessThan(0.97);
    expect(Math.max(...r)).toBeLessThanOrEqual(1 + 1e-9);
    expect(at(3)).toBeCloseTo(1, 4);
  });

  it('overshoots with a higher Q (Elasticity) and is slower with a longer glide (Viscosity)', () => {
    expect(Math.max(...stepResponse(0.4, 2, 3))).toBeGreaterThan(1.2);
    const fast = stepResponse(0.1, 0.5, 1);
    const slow = stepResponse(1, 0.5, 1);
    expect(slow[40]).toBeLessThan(fast[40] ?? 0);
  });

  it('rests on a value', () => {
    const m = memory();
    glideRestAt(m, 5);
    expect(glideStep(glideCoefficients(0.3, 1, DT), m, 5)).toBeCloseTo(5, 12);
  });
});

describe('seek dip', () => {
  it('silences the first control point after the jump (the engine is still silent there)', () => {
    // Wherever the jump falls between two 5 ms control points, the first point is written,
    // and silent: the engine keeps the output at zero for one control step after a jump.
    for (let offset = 0; offset < 0.005; offset += 0.0001) {
      expect(seekDipGain(offset)).toBe(0);
    }
    expect(seekDipGain(Number.NaN)).toBeNull();
    expect(seekDipGain(-0.001)).toBeNull();
  });

  it('stays silent while the other buses glide, then fades smoothly back in', () => {
    expect(SEEK_GLIDE_SEC).toBeLessThanOrEqual(SEEK_DIP_SILENT_UNTIL_SEC);
    expect(seekGlideHolds(0)).toBe(true);
    expect(seekGlideHolds(SEEK_GLIDE_SEC)).toBe(false);
    expect(seekDipGain(SEEK_DIP_SILENT_UNTIL_SEC)).toBe(0);
    expect(seekDipGain(SEEK_DIP_SILENT_UNTIL_SEC + SEEK_DIP_IN_SEC)).toBe(1);
    expect(seekDipGain(1)).toBe(1);
    let last = 0;
    for (let t = 0; t <= 0.045; t += 0.001) {
      const g = seekDipGain(t) ?? 0;
      expect(g).toBeGreaterThanOrEqual(last);
      expect(g - last).toBeLessThan(0.15); // no step bigger than 15% per millisecond
      last = g;
    }
  });
});

describe('drive stage', () => {
  it('is odd, bounded and near unity for small signals when gentle', () => {
    const curve = driveCurve();
    const n = curve.length;
    expect(curve[(n - 1) / 2]).toBe(0);
    expect(curve[0]).toBeCloseTo(-(curve[n - 1] ?? 0), 6);
    expect(Math.max(...curve)).toBeLessThanOrEqual(1);
    const gentle = driveStageGains(0.01);
    // Small-signal gain: pre × H (the curve's slope at 0) × post.
    expect(gentle.pre * 4 * gentle.post).toBeCloseTo(1, 3);
    const hard = driveStageGains(3);
    expect(hard.pre * 4 * hard.post).toBeGreaterThan(2);
  });
});

// --- Minimal fakes of the Web Audio pieces the helpers touch -------------------------------

class FakeNode {
  readonly inputs: FakeNode[] = [];
  connect(target: FakeNode): void {
    target.inputs.push(this);
  }
  disconnect(): void {}
}

class FakeGain extends FakeNode {
  channelCount = 2;
  channelCountMode = 'max';
  channelInterpretation = 'speakers';
}

class FakeSource extends FakeNode {
  buffer: unknown = null;
  loop = false;
  startedAt = Number.NaN;
  offset = Number.NaN;
  stoppedAt = Number.POSITIVE_INFINITY;
  start(when: number, offset: number): void {
    this.startedAt = when;
    this.offset = offset;
  }
  stop(when = 0): void {
    this.stoppedAt = when;
  }
}

class FakeContext {
  currentTime = 0;
  readonly sources: FakeSource[] = [];
  readonly gains: FakeGain[] = [];
  createGain(): FakeGain {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createBufferSource(): FakeSource {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
}

describe('control bus held across cancels', () => {
  /** An AudioParam that records the automation calls made on it. */
  class FakeParam {
    value = 0;
    readonly calls: [string, number, number][] = [];
    setValueAtTime(v: number, t: number): void {
      this.calls.push(['set', v, t]);
    }
    linearRampToValueAtTime(v: number, t: number): void {
      this.calls.push(['ramp', v, t]);
    }
    cancelAndHoldAtTime(t: number): void {
      this.calls.push(['hold', Number.NaN, t]);
    }
  }
  function busContext(): { ctx: BaseAudioContext; param: FakeParam } {
    const param = new FakeParam();
    const node = { offset: param, start() {}, stop() {}, connect() {}, disconnect() {} };
    return { ctx: { createConstantSource: () => node } as unknown as BaseAudioContext, param };
  }

  it('anchors the held value when cancelled after everything it scheduled (a resync)', () => {
    const { ctx, param } = busContext();
    const bus = new ControlBus(ctx, 0);
    bus.write(0.2, 1.0, true);
    bus.write(0.5, 1.005);
    bus.write(0.8, 1.01);
    // The schedule ran out at 1.01 s; the engine resyncs at 1.4 s.
    bus.cancelFrom(1.4);
    expect(param.calls.slice(-2)).toEqual([
      ['hold', Number.NaN, 1.4],
      ['set', 0.8, 1.4],
    ]);
    // The next ramp now starts from 1.4 s, not from 1.01 s (where it would snap onto the line).
    bus.write(0.3, 1.405);
    expect(param.calls[param.calls.length - 1]).toEqual(['ramp', 0.3, 1.405]);
  });

  it('anchors a cancel exactly at the last point, whose value it knows', () => {
    const { ctx, param } = busContext();
    const bus = new ControlBus(ctx, 0);
    bus.write(0.2, 1.0, true);
    bus.write(0.6, 1.005);
    bus.cancelFrom(1.005);
    expect(param.calls.slice(-2)).toEqual([
      ['hold', Number.NaN, 1.005],
      ['set', 0.6, 1.005],
    ]);
  });

  it('leaves an ordinary cancel inside the curve to cancelAndHoldAtTime', () => {
    const { ctx, param } = busContext();
    const bus = new ControlBus(ctx, 0);
    bus.write(0.2, 1.0, true);
    bus.write(0.5, 1.005);
    bus.cancelFrom(1.002);
    expect(param.calls[param.calls.length - 1]).toEqual(['hold', Number.NaN, 1.002]);
    // A second cancel later, with nothing written between (pause, then play), doesn't guess.
    bus.cancelFrom(3);
    expect(param.calls[param.calls.length - 1]).toEqual(['hold', Number.NaN, 3]);
    // Writing again carries on as usual: a ramp from the held point.
    bus.write(0.4, 3.005);
    expect(param.calls[param.calls.length - 1]).toEqual(['ramp', 0.4, 3.005]);
  });

  it('anchors nothing before its first point, which is always set outright', () => {
    const { ctx, param } = busContext();
    const bus = new ControlBus(ctx, 0.5);
    bus.cancelFrom(2);
    expect(param.calls).toEqual([['hold', Number.NaN, 2]]);
    bus.write(0.7, 2.01);
    expect(param.calls[param.calls.length - 1]).toEqual(['set', 0.7, 2.01]);
  });

  it('keeps the old name working', () => {
    expect(HoldingControlBus).toBe(ControlBus);
  });
});

describe('pairwise mixing (bit-identical sums)', () => {
  it('never feeds more than two sources into one input', () => {
    for (const count of [1, 2, 3, 4, 5, 7, 8]) {
      const ctx = new FakeContext();
      const sources = Array.from({ length: count }, () => new FakeNode());
      const mix = mixPairwise(
        ctx as unknown as BaseAudioContext,
        sources as unknown as AudioNode[],
      );
      for (const g of mix.nodes as unknown as FakeNode[]) expect(g.inputs.length).toBe(2);
      // Every source reaches the output exactly once.
      const reached: FakeNode[] = [];
      const walk = (n: FakeNode): void => {
        if (n.inputs.length === 0) reached.push(n);
        for (const i of n.inputs) walk(i);
      };
      walk(mix.output as unknown as FakeNode);
      expect(reached.length).toBe(count);
      expect(new Set(reached).size).toBe(count);
      expect(mix.nodes.length).toBe(count - 1);
    }
  });
});

describe('one-shot mix (bit-identical sums of overlapping one-shots)', () => {
  interface Shot {
    node: FakeNode;
    start: number;
    end: number;
  }

  /** Add one-shots in order; returns which slot (input node) each went to, or null. */
  function place(mix: OneShotMix, ctx: FakeContext, shots: Shot[]): (FakeGain | null)[] {
    return shots.map((s) => {
      const ok = mix.add(s.node as unknown as AudioNode, s.start, s.end);
      if (!ok) return null;
      return ctx.gains.find((g) => g.inputs.includes(s.node)) ?? null;
    });
  }

  /** A burst of overlapping one-shots: onsets every `gap` s, each `length` s long. */
  function burst(count: number, gap: number, length: number, from = 0): Shot[] {
    return Array.from({ length: count }, (_, i) => ({
      node: new FakeNode(),
      start: from + i * gap,
      end: from + i * gap + length,
    }));
  }

  it('mixes its slots in pairs', () => {
    const ctx = new FakeContext();
    const mix = new OneShotMix(ctx as unknown as BaseAudioContext);
    for (const g of ctx.gains) expect(g.inputs.length).toBeLessThanOrEqual(2);
    const leaves: FakeNode[] = [];
    const walk = (n: FakeNode): void => {
      if (n.inputs.length === 0) leaves.push(n);
      for (const i of n.inputs) walk(i);
    };
    walk(mix.output as unknown as FakeNode);
    expect(leaves).toHaveLength(ONE_SHOT_SLOTS);
  });

  it('never lets more than two one-shots sound together in one slot', () => {
    const ctx = new FakeContext();
    const mix = new OneShotMix(ctx as unknown as BaseAudioContext);
    // Droplets 0.8 s long every 0.05 s: ~16 sound at once.
    const shots = burst(60, 0.05, 0.8);
    const slots = place(mix, ctx, shots);
    expect(slots.every((s) => s !== null)).toBe(true);
    for (let t = 0; t < 4; t += 0.001) {
      const perSlot = new Map<FakeNode, number>();
      shots.forEach((s, i) => {
        const slot = slots[i];
        if (slot && s.start <= t && t <= s.end) perSlot.set(slot, (perSlot.get(slot) ?? 0) + 1);
      });
      for (const n of perSlot.values()) expect(n).toBeLessThanOrEqual(2);
    }
  });

  it('chooses slots from the one-shots’ times alone', () => {
    const run = (): number[] => {
      const ctx = new FakeContext();
      const mix = new OneShotMix(ctx as unknown as BaseAudioContext);
      return place(mix, ctx, burst(40, 0.07, 0.6)).map((s) => (s ? ctx.gains.indexOf(s) : -1));
    };
    expect(run()).toEqual(run());
  });

  it('drops a one-shot only when every slot is full then', () => {
    const ctx = new FakeContext();
    const mix = new OneShotMix(ctx as unknown as BaseAudioContext, 3);
    const shots = burst(7, 0.01, 1);
    const slots = place(mix, ctx, shots);
    expect(slots.slice(0, 6).every((s) => s !== null)).toBe(true);
    expect(slots[6]).toBeNull();
    // Later, once the first ones have ended, there is room again.
    expect(mix.add(new FakeNode() as unknown as AudioNode, 1.2, 1.5)).toBe(true);
  });

  it('forgets cancelled one-shots (released) and finished ones (pruned)', () => {
    const ctx = new FakeContext();
    const mix = new OneShotMix(ctx as unknown as BaseAudioContext, 1);
    expect(place(mix, ctx, burst(2, 0.1, 1))).not.toContain(null);
    expect(mix.add(new FakeNode() as unknown as AudioNode, 0.3, 1.3)).toBe(false);
    // A live edit releases the one-shots from 0.05 s on: the second one goes.
    mix.cancelFrom(0.05);
    expect(mix.add(new FakeNode() as unknown as AudioNode, 0.3, 1.3)).toBe(true);
    expect(mix.add(new FakeNode() as unknown as AudioNode, 0.4, 1.4)).toBe(false);
    // Once the clock has passed the first one's end, it no longer counts.
    mix.prune(1.1);
    expect(mix.add(new FakeNode() as unknown as AudioNode, 1.2, 1.4)).toBe(true);
  });
});

describe('noise in step with composition time', () => {
  it('maps composition time to a buffer position', () => {
    expect(noiseOffset(0, 5)).toBe(0);
    expect(noiseOffset(1.25, 5)).toBeCloseTo(1.25, 12);
    expect(noiseOffset(12.5, 5)).toBeCloseTo(2.5, 9);
    expect(noiseOffset(-1, 5)).toBeCloseTo(4, 12);
    expect(noiseOffset(Number.NaN, 5)).toBe(0);
  });

  it('starts only on the first window (or when nothing plays), never on a seek', () => {
    const modes: ContinuityMode[] = ['start', 'continue', 'rewind', 'seek'];
    expect(modes.map((m) => noiseRestarts(m, true))).toEqual([true, false, false, false]);
    expect(modes.map((m) => noiseRestarts(m, false))).toEqual([true, true, true, true]);
  });

  function setup(): { ctx: FakeContext; noise: TimelineNoise } {
    const ctx = new FakeContext();
    const buffer = { duration: 5, numberOfChannels: 2 } as unknown as AudioBuffer;
    const noise = new TimelineNoise(ctx as unknown as BaseAudioContext, buffer);
    return { ctx, noise };
  }

  it('starts at the buffer position of the first window, then runs on through seeks', () => {
    const { ctx, noise } = setup();
    // Preview: playback starts at composition time 7.5 s, context time 2 s.
    noise.sync('start', 7.5, 2);
    expect(ctx.sources.length).toBe(1);
    expect(ctx.sources[0]?.startedAt).toBe(2);
    expect(ctx.sources[0]?.offset).toBeCloseTo(2.5, 9);
    expect(ctx.sources[0]?.loop).toBe(true);
    // Later windows, a seek, a loop wrap: no restart, no stop.
    noise.sync('continue', 7.55, 2.05);
    noise.sync('seek', 1, 3);
    noise.sync('rewind', 1.1, 3.1);
    expect(ctx.sources.length).toBe(1);
    expect(ctx.sources[0]?.stoppedAt).toBe(Number.POSITIVE_INFINITY);
  });

  it('offline, starts at composition time 0 with offset 0', () => {
    const { ctx, noise } = setup();
    noise.sync('start', 0, 0);
    expect(ctx.sources[0]?.startedAt).toBe(0);
    expect(ctx.sources[0]?.offset).toBe(0);
  });

  it('forgets a start that was cancelled before it played, and starts again later', () => {
    const { ctx, noise } = setup();
    noise.sync('start', 0, 1);
    noise.cancelFrom(0.9); // e.g. paused before playback began
    expect(ctx.sources[0]?.stoppedAt).toBeLessThanOrEqual(1);
    noise.sync('seek', 0.4, 5);
    expect(ctx.sources.length).toBe(2);
    expect(ctx.sources[1]?.startedAt).toBe(5);
    expect(ctx.sources[1]?.offset).toBeCloseTo(0.4, 12);
    // A cancel after it started leaves it playing.
    noise.cancelFrom(6);
    expect(ctx.sources[1]?.stoppedAt).toBe(Number.POSITIVE_INFINITY);
  });

  it('stops every source on dispose', () => {
    const { ctx, noise } = setup();
    noise.sync('start', 0, 0);
    noise.dispose();
    expect(ctx.sources[0]?.stoppedAt).toBe(0);
  });
});
