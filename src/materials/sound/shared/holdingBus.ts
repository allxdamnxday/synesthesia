/**
 * A ControlBus that stays continuous when it is cancelled after everything it scheduled.
 *
 * `ControlBus.cancelFrom` uses `cancelAndHoldAtTime`. When the cancel time lies inside the
 * scheduled automation that is exactly right. But when it lies *after* the last scheduled
 * point (the scheduler starved and the audio ran past its schedule; the engine then resyncs),
 * the Web Audio spec inserts no hold event: the parameter has simply been holding the last
 * value. The next `linearRampToValueAtTime` then ramps from that last event, long in the past,
 * so the parameter snaps onto the ramp's line the moment it is written: a jump, which clicks.
 *
 * This bus remembers its last point and, in that case, anchors the held value at the cancel
 * time, so the next ramp starts there. Everything else is ControlBus unchanged.
 */
import { ControlBus } from './automation';

export class HoldingControlBus extends ControlBus {
  /** The last point written (NaN once a cancel has cut into the written curve). */
  private lastValue = Number.NaN;
  private lastTime = Number.NEGATIVE_INFINITY;

  override write(value: number, ctxTime: number, jump = false): void {
    super.write(value, ctxTime, jump);
    this.lastValue = value;
    this.lastTime = ctxTime;
  }

  override cancelFrom(ctxTime: number): void {
    super.cancelFrom(ctxTime);
    if (ctxTime > this.lastTime) {
      // Past everything scheduled: the parameter has been holding the last value.
      if (Number.isFinite(this.lastValue)) this.param.setValueAtTime(this.lastValue, ctxTime);
      this.lastTime = ctxTime;
    } else {
      // Cut inside the curve: cancelAndHoldAtTime held the value there, which we don't track.
      this.lastValue = Number.NaN;
      this.lastTime = ctxTime;
    }
  }
}
