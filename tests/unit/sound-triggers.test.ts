import { describe, expect, it } from 'vitest';
import { TRIGGER_SERIAL_LIMIT, TriggerLane } from '../../src/materials/sound/shared/triggers';

/** Records the automation calls a TriggerLane makes. */
class FakeParam {
  events: { kind: 'set' | 'cancel'; value?: number; time: number }[] = [];
  setValueAtTime(value: number, time: number): this {
    this.events.push({ kind: 'set', value, time });
    return this;
  }
  cancelAndHoldAtTime(time: number): this {
    this.events.push({ kind: 'cancel', time });
    return this;
  }
}

function lane() {
  const trigger = new FakeParam();
  const freq = new FakeParam();
  const velocity = new FakeParam();
  const l = new TriggerLane(trigger as unknown as AudioParam, {
    freq: freq as unknown as AudioParam,
    velocity: velocity as unknown as AudioParam,
  });
  return { l, trigger, freq, velocity };
}

describe('trigger lanes (discrete worklet events)', () => {
  it('sets every value and a new serial at the same time', () => {
    const { l, trigger, freq, velocity } = lane();
    l.fire(1.25, { freq: 440, velocity: 0.8 });
    expect(freq.events).toEqual([{ kind: 'set', value: 440, time: 1.25 }]);
    expect(velocity.events).toEqual([{ kind: 'set', value: 0.8, time: 1.25 }]);
    expect(trigger.events).toEqual([{ kind: 'set', value: 1, time: 1.25 }]);
  });

  it('never repeats a serial, so no event is missed after a cancel', () => {
    const { l, trigger } = lane();
    for (let i = 0; i < 5; i++) l.fire(i, { freq: 1, velocity: 1 });
    l.cancelFrom(2.5);
    l.fire(2.6, { freq: 1, velocity: 1 });
    const serials = trigger.events.filter((e) => e.kind === 'set').map((e) => e.value);
    expect(serials).toEqual([1, 2, 3, 4, 5, 6]);
    expect(trigger.events.some((e) => e.kind === 'cancel' && e.time === 2.5)).toBe(true);
  });

  it('cancels every parameter from the given time', () => {
    const { l, trigger, freq, velocity } = lane();
    l.cancelFrom(3);
    for (const p of [trigger, freq, velocity])
      expect(p.events).toEqual([{ kind: 'cancel', time: 3 }]);
  });

  it('keeps serials exact in float32 and never writes the default (0)', () => {
    expect(TRIGGER_SERIAL_LIMIT).toBeLessThan(2 ** 24);
    const { l, trigger } = lane();
    // Run past the limit: the serial wraps to 1, never 0, and consecutive values differ.
    const internal = l as unknown as { serial: number };
    internal.serial = TRIGGER_SERIAL_LIMIT - 1;
    l.fire(0, { freq: 1, velocity: 1 });
    l.fire(1, { freq: 1, velocity: 1 });
    l.fire(2, { freq: 1, velocity: 1 });
    const serials = trigger.events.map((e) => e.value);
    expect(serials).toEqual([TRIGGER_SERIAL_LIMIT, 1, 2]);
  });

  it('clamps event times at zero', () => {
    const { l, trigger } = lane();
    l.fire(-0.01, { freq: 1, velocity: 1 });
    expect(trigger.events[0]?.time).toBe(0);
  });
});
