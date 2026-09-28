/**
 * Discrete events (strikes, plucks, resets) for AudioWorklet processors, written as AudioParam
 * automation so they land on an exact sample in both AudioContext and OfflineAudioContext.
 *
 * A lane is one `trigger` parameter plus any number of value parameters. `fire(time, values)`
 * sets every value parameter at `time`, then sets `trigger` to a new serial number at the same
 * time. The processor watches `trigger` sample by sample: whenever it differs from the last
 * value seen, an event starts at that sample, and it reads the value parameters at the same
 * sample. Only *changes* matter, never the serial's value, so the serial may differ between
 * preview and offline without changing the output.
 *
 * `cancelFrom(time)` removes events at or after `time` (after a live edit or a seek) and holds
 * what came before. Serials only ever increase (wrapping far beyond any session), so the next
 * event always differs from the held value and is never missed.
 *
 * Port messages are never used for events: they are asynchronous and not sample-accurate, and
 * an offline render would not wait for them.
 */
import { cancelFrom } from './automation';

/** Serials stay below 2^24, where float32 (AudioParam) still represents every integer. */
export const TRIGGER_SERIAL_LIMIT = 16_000_000;

export class TriggerLane<K extends string = string> {
  private serial = 0;
  private readonly keys: readonly K[];

  constructor(
    private readonly trigger: AudioParam,
    private readonly values: Readonly<Record<K, AudioParam>>,
  ) {
    this.keys = Object.keys(values) as K[];
  }

  /** Start an event at context time `ctxTime` with these values (same sample for all). */
  fire(ctxTime: number, values: Readonly<Record<K, number>>): void {
    const time = Math.max(0, ctxTime);
    for (const key of this.keys) this.values[key].setValueAtTime(values[key], time);
    this.serial = (this.serial % TRIGGER_SERIAL_LIMIT) + 1;
    this.trigger.setValueAtTime(this.serial, time);
  }

  /** Remove events at or after `ctxTime`, holding the values in force before it. */
  cancelFrom(ctxTime: number): void {
    cancelFrom(this.trigger, ctxTime);
    for (const key of this.keys) cancelFrom(this.values[key], ctxTime);
  }
}

/**
 * Look up an AudioWorkletNode parameter by name. The names are fixed by the processor's
 * `parameterDescriptors`, so a missing one is a programming error.
 */
export function workletParam(node: AudioWorkletNode, name: string): AudioParam {
  const param = node.parameters.get(name);
  if (!param) throw new Error(`The sound processor has no parameter "${name}".`);
  return param;
}
