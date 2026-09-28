/**
 * AudioParam automation helpers for sound materials (SPEC 9.1, "Sound scheduling").
 *
 * Control-rate automation is anchored to a global grid: point k always sits at composition
 * time k / controlRate, whichever window schedules it. Preview (many short lookahead
 * windows) and offline render (one window over the whole timeline) therefore write exactly
 * the same points, which is what makes them sound the same.
 *
 * Nothing here reads a clock or uses browser randomness.
 */

/** Grid-membership tolerance, in grid steps; absorbs floating-point error in t × rate. */
export const GRID_EPSILON = 1e-6;

/** First grid index whose time is at or after `t`. */
export function gridIndexAtOrAfter(t: number, rate: number): number {
  // `|| 0` turns −0 (from ceil of a tiny negative) into 0.
  return Math.ceil(t * rate - GRID_EPSILON) || 0;
}

/** Last grid index whose time is at or before `t` (same tolerance as gridIndexAtOrAfter). */
export function gridIndexAtOrBefore(t: number, rate: number): number {
  return Math.floor(t * rate + GRID_EPSILON);
}

/**
 * Time boundary between grid index k − 1 and k for discrete events: an event at time te
 * belongs with grid point gridIndexAtOrBefore(te) iff it falls in
 * [eventBoundary(k), eventBoundary(k + 1)).
 */
export function eventBoundary(k: number, rate: number): number {
  return (k - GRID_EPSILON) / rate;
}

/**
 * Grid indices k with t0 ≤ k / rate < t1, as a half-open range [first, end).
 * Contiguous windows [a, b), [b, c) partition the grid: every index lands in exactly one.
 */
export function gridRange(t0: number, t1: number, rate: number): [number, number] {
  const first = gridIndexAtOrAfter(t0, rate);
  const end = Math.max(first, gridIndexAtOrAfter(t1, rate));
  return [first, end];
}

/**
 * Offset that maps composition time to context time inside one schedule window:
 * ctxTime = t + offset. Computed once per window so the offline render (offset exactly 0)
 * writes event times of exactly k / rate.
 */
export function windowOffset(win: { t0: number; ctxTimeAtT0: number }): number {
  return win.ctxTimeAtT0 - win.t0;
}

/** Exact one-pole smoothing coefficient for time constant `tau` at step `dt`. */
export function onePoleCoefficient(tau: number, dt: number): number {
  return tau <= 0 ? 1 : 1 - Math.exp(-dt / tau);
}

/**
 * `setTargetAtTime` time constant that covers ~95% of a change in `seconds`
 * (three time constants).
 */
export function timeConstantFor(seconds: number): number {
  return Math.max(1e-4, seconds / 3);
}

/** Glide a parameter towards `value`, starting at `atTime`, reaching ~95% after `seconds`. */
export function glideTo(param: AudioParam, value: number, atTime: number, seconds: number): void {
  param.setTargetAtTime(value, atTime, timeConstantFor(seconds));
}

/**
 * Clear automation after `ctxTime` and hold the value the parameter has at that moment,
 * so later events continue from where the sound actually is (no jumps, no clicks).
 */
export function cancelFrom(param: AudioParam, ctxTime: number): void {
  const time = Math.max(0, ctxTime);
  // Chrome has had cancelAndHoldAtTime since v57; guard anyway so a missing method
  // degrades to a plain cancel instead of throwing.
  const hold = (param as { cancelAndHoldAtTime?: (t: number) => AudioParam }).cancelAndHoldAtTime;
  if (typeof hold === 'function') hold.call(param, time);
  else param.cancelScheduledValues(time);
}

/**
 * A control signal: a ConstantSourceNode whose offset carries automation written at the
 * control rate. One bus can drive many parameters (connect it to each), so a material
 * writes each control curve once instead of once per voice.
 *
 * Connected to an AudioParam, the bus output is added to that parameter's own value, so
 * targets are usually given a base value of 0 (or a fixed offset such as a voice detune).
 */
export class ControlBus {
  readonly node: ConstantSourceNode;
  private written = false;

  constructor(ctx: BaseAudioContext, initial = 0) {
    this.node = ctx.createConstantSource();
    this.node.offset.value = initial;
    this.node.start();
  }

  get param(): AudioParam {
    return this.node.offset;
  }

  connect(target: AudioParam | AudioNode): void {
    if (target instanceof AudioNode) this.node.connect(target);
    else this.node.connect(target);
  }

  /**
   * Write the value for one grid point. `jump` sets it instantly (start of playback or a
   * seek, where the engine fades around the discontinuity); otherwise the value ramps
   * linearly from the previous point, which keeps the curve continuous.
   */
  write(value: number, ctxTime: number, jump = false): void {
    if (jump || !this.written) {
      this.param.setValueAtTime(value, ctxTime);
      this.written = true;
    } else {
      this.param.linearRampToValueAtTime(value, ctxTime);
    }
  }

  cancelFrom(ctxTime: number): void {
    cancelFrom(this.param, ctxTime);
  }

  dispose(): void {
    try {
      this.node.stop();
    } catch {
      // Already stopped.
    }
    this.node.disconnect();
  }
}

/**
 * A parameter driven only by explicit linear fades (transport fades, mute, crossfades).
 *
 * A linear ramp always starts at the previous automation event, so a ramp added long after
 * that event is effectively an instant jump: a click. RampedParam remembers the breakpoints
 * it wrote, and anchors every fade with the exact value the parameter has at the fade's
 * start. It must be the only writer of its parameter.
 */
export class RampedParam {
  readonly param: AudioParam;
  private times: number[] = [];
  private values: number[] = [];

  constructor(param: AudioParam, initial: number) {
    this.param = param;
    param.value = initial;
    this.times = [0];
    this.values = [initial];
  }

  /** The value at context time `time` according to the breakpoints written so far. */
  valueAt(time: number): number {
    const n = this.times.length;
    if (time <= (this.times[0] ?? 0)) return this.values[0] ?? 0;
    for (let i = n - 1; i >= 0; i--) {
      const ti = this.times[i] ?? 0;
      if (time >= ti) {
        if (i === n - 1) return this.values[i] ?? 0;
        const tj = this.times[i + 1] ?? ti;
        const vi = this.values[i] ?? 0;
        const vj = this.values[i + 1] ?? vi;
        return tj > ti ? vi + ((vj - vi) * (time - ti)) / (tj - ti) : vj;
      }
    }
    return this.values[n - 1] ?? 0;
  }

  /** Linear fade from wherever the parameter is at `at` to `value` at `at + duration`. */
  rampTo(value: number, at: number, duration: number): void {
    const end = at + Math.max(0, duration);
    const start = this.truncateFrom(at);
    this.param.setValueAtTime(start, at);
    this.param.linearRampToValueAtTime(value, end);
    this.times.push(end);
    this.values.push(value);
  }

  /** Set instantly at `at` (only where nothing is audible, e.g. under a fade). */
  setAt(value: number, at: number): void {
    this.truncateFrom(at);
    this.param.setValueAtTime(value, at);
    this.times.push(at);
    this.values.push(value);
  }

  /** Forget breakpoints older than `time` (keeps the one in force at `time`). */
  prune(time: number): void {
    let keep = 0;
    for (let i = 0; i < this.times.length; i++) if ((this.times[i] ?? 0) <= time) keep = i;
    if (keep > 0) {
      this.times.splice(0, keep);
      this.values.splice(0, keep);
    }
  }

  /**
   * Cancel automation from `time`, keeping the curve before it unchanged and holding its
   * value there. Returns the held value.
   */
  private truncateFrom(time: number): number {
    const held = this.valueAt(time);
    cancelFrom(this.param, time);
    let n = this.times.length;
    while (n > 0 && (this.times[n - 1] ?? 0) >= time) n--;
    this.times.length = n;
    this.values.length = n;
    // The cut segment now ends at `time`, on the same line, at the held value.
    this.times.push(time);
    this.values.push(held);
    return held;
  }
}

/**
 * A parameter that changes only when properties change (a filter cutoff, a voice detune,
 * a send level). It jumps at the start of playback or after a seek and glides on live
 * edits, and writes nothing when the value is unchanged, so repeated windows add no events.
 */
export class StaticParam {
  private last = Number.NaN;

  constructor(
    readonly param: AudioParam,
    readonly glideSec = 0.05,
  ) {}

  apply(value: number, ctxTime: number, jump: boolean): void {
    if (jump) {
      this.param.setValueAtTime(value, ctxTime);
      this.last = value;
      return;
    }
    if (value === this.last) return;
    glideTo(this.param, value, ctxTime, this.glideSec);
    this.last = value;
  }

  cancelFrom(ctxTime: number): void {
    cancelFrom(this.param, ctxTime);
    // A hold may have frozen a glide part-way: re-apply on the next window.
    this.last = Number.NaN;
  }
}
