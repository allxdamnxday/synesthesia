/**
 * Control timeline: runs a sound material's control program (a small deterministic state
 * machine stepped at the control rate) across schedule windows.
 *
 * A material describes *what* happens at each control step (envelopes, glides, springs)
 * as pure code over a plain state object; the timeline takes care of *when*:
 *
 * - **continue**: the window starts where the previous one ended in context time. The
 *   state carries on. This covers ordinary lookahead windows and the transport wrapping
 *   from the end of the timeline back to 0 (the sound stays continuous: no clicks).
 * - **rewind**: after `cancelFrom(ctxTime)` for a live property edit, the new window
 *   starts inside the already-scheduled range with the same time mapping. The state is
 *   restored from history at the last kept grid point and continues with the new
 *   properties.
 * - **start** / **seek**: first window, or a jump in the time mapping (seek, restart after
 *   pause, scheduler underrun). The state resets to its initial value and fast-forwards
 *   through the grid points before the window (SPEC 7.5), so the sound at time t is the
 *   same however playback got there.
 *
 * Because every grid point is stepped exactly once and in order, one offline window over
 * the whole timeline and any sequence of contiguous preview windows produce identical
 * control values.
 */
import type { SignatureFrame } from '../../../signature/types';
import type { PropertyValues, ScheduleWindow } from '../../types';
import { eventBoundary, gridIndexAtOrBefore, gridRange, windowOffset } from './automation';

export type ContinuityMode = 'start' | 'continue' | 'rewind' | 'seek';

export interface ControlProgram<S> {
  /** Allocate a state object (initial values are set by `reset`). */
  createState(): S;
  /** Put `state` into its initial condition at composition time 0. */
  reset(state: S): void;
  /** Copy every field of `from` into `to`. */
  copy(from: S, to: S): void;
  /** Advance one control step of `dt` seconds to the grid point whose frame is given. */
  step(state: S, frame: SignatureFrame, props: PropertyValues, dt: number): void;
}

export interface ControlHandlers<S> {
  /** Called once per window before any point, with how it relates to the previous one. */
  begin?(mode: ContinuityMode): void;
  /**
   * Called for every grid point after the state has advanced to it. `jump` is true for the
   * first point after a start or seek: write it as an instant set, not a ramp.
   */
  point(ctxTime: number, state: S, t: number, jump: boolean): void;
  /**
   * Discrete events (e.g. onsets): return their composition times in [from, to), sorted.
   * The timeline asks for a slightly wider range than the window and keeps the events it
   * owns, so each event is handled exactly once however the timeline is split into windows.
   */
  events?(from: number, to: number): readonly number[];
  /**
   * Called for each event right after the state has advanced to the last grid point at or
   * before it (the same state in preview and offline).
   */
  event?(t: number, ctxTime: number, state: S): void;
}

export interface ControlTimelineOptions {
  /** How far back a live edit can rewind, in seconds (must exceed the lookahead). */
  historySec?: number;
  /**
   * Longest fast-forward on a seek, in seconds. Older state is approximated by starting
   * from rest; every sound material's memory is far shorter than this.
   */
  maxFastForwardSec?: number;
}

/** Context-time tolerance for contiguity and mapping checks (well under one sample). */
const CTX_EPSILON = 1e-6;

export class ControlTimeline<S> {
  private readonly program: ControlProgram<S>;
  private readonly historySec: number;
  private readonly maxFastForwardSec: number;
  private readonly state: S;

  // History ring buffer of the most recently scheduled grid points.
  private capacity = 0;
  private hK = new Float64Array(0);
  private hT = new Float64Array(0);
  private hCtx = new Float64Array(0);
  private hStates: S[] = [];
  private head = 0; // index of the next write
  private count = 0;

  /** Context time where the last scheduled window ended; NaN after a cancel or reset. */
  private scheduledCtxEnd = Number.NaN;
  private started = false;

  constructor(program: ControlProgram<S>, options: ControlTimelineOptions = {}) {
    this.program = program;
    this.historySec = options.historySec ?? 1;
    this.maxFastForwardSec = options.maxFastForwardSec ?? 30;
    this.state = program.createState();
    program.reset(this.state);
  }

  /** The current state (after the most recently scheduled grid point). Read-only use. */
  get current(): S {
    return this.state;
  }

  /** Forget everything: the next window starts from the initial state. */
  reset(): void {
    this.started = false;
    this.count = 0;
    this.scheduledCtxEnd = Number.NaN;
    this.program.reset(this.state);
  }

  /**
   * Drop history at or after `ctxTime` (its automation was cancelled) and mark the next
   * window as needing a rewind or a seek rather than a plain continuation.
   */
  cancelFrom(ctxTime: number): void {
    while (this.count > 0) {
      const newest = (this.head - 1 + this.capacity) % this.capacity;
      if ((this.hCtx[newest] ?? 0) < ctxTime - CTX_EPSILON) break;
      this.head = newest;
      this.count--;
    }
    this.scheduledCtxEnd = Number.NaN;
  }

  /** Step the program across the window's grid points, calling the handlers. */
  schedule(win: ScheduleWindow, handlers: ControlHandlers<S>): ContinuityMode {
    const rate = win.controlRate;
    const dt = 1 / rate;
    const offset = windowOffset(win);
    const [first, end] = gridRange(win.t0, win.t1, rate);
    this.ensureCapacity(rate);

    const mode = this.prepare(win, first, rate, offset);
    handlers.begin?.(mode);

    const events = this.ownedEvents(win, handlers, mode, first, end, rate);
    let e = 0;
    // Events tied to the grid point just before the window (after a rewind or seek).
    while (e < events.length && (events[e]?.k ?? 0) < first) {
      this.emitEvent(handlers, events[e]?.t ?? 0, offset);
      e++;
    }
    let jump = mode === 'start' || mode === 'seek';
    for (let k = first; k < end; k++) {
      const t = k / rate;
      const frame = win.sampler.sample(t);
      this.program.step(this.state, frame, win.props, dt);
      this.remember(k, t, t + offset);
      handlers.point(t + offset, this.state, t, jump);
      jump = false;
      while (e < events.length && (events[e]?.k ?? 0) <= k) {
        this.emitEvent(handlers, events[e]?.t ?? 0, offset);
        e++;
      }
    }

    this.scheduledCtxEnd = win.ctxTimeAtT0 + (win.t1 - win.t0);
    this.started = true;
    return mode;
  }

  /**
   * The events this window handles, each with its grid point. Ownership depends only on the
   * grid index (never on where window edges fall), so preview windows and one offline call
   * see every event once, at the same point in the sequence:
   * - grid points first … end − 1 belong to this window, and so do their events;
   * - after a rewind or seek, events tied to grid point first − 1 at or after the window
   *   start are handled too (their audio was cancelled with the rest).
   */
  private ownedEvents(
    win: ScheduleWindow,
    handlers: ControlHandlers<S>,
    mode: ContinuityMode,
    first: number,
    end: number,
    rate: number,
  ): { t: number; k: number }[] {
    if (!handlers.events || !handlers.event) return [];
    const from = Math.min(win.t0, eventBoundary(first, rate)) - 1 / rate;
    const to = eventBoundary(end, rate) + 1 / rate;
    const owned: { t: number; k: number }[] = [];
    for (const t of handlers.events(from, to)) {
      const k = gridIndexAtOrBefore(t, rate);
      if (k >= end) continue;
      if (k >= first) owned.push({ t, k });
      else if (mode !== 'continue' && k === first - 1 && t >= win.t0 - 1e-9) owned.push({ t, k });
    }
    return owned;
  }

  private emitEvent(handlers: ControlHandlers<S>, t: number, offset: number): void {
    handlers.event?.(t, t + offset, this.state);
  }

  private prepare(
    win: ScheduleWindow,
    first: number,
    rate: number,
    offset: number,
  ): ContinuityMode {
    if (!this.started) {
      this.program.reset(this.state);
      this.fastForward(win, first, rate);
      return 'start';
    }
    if (Math.abs(win.ctxTimeAtT0 - this.scheduledCtxEnd) < CTX_EPSILON) return 'continue';

    // Rewind: the newest remembered point before the window must be the grid point just
    // before `first`, under the same composition → context mapping.
    while (this.count > 0) {
      const newest = (this.head - 1 + this.capacity) % this.capacity;
      const ctx = this.hCtx[newest] ?? 0;
      if (ctx >= win.ctxTimeAtT0 - CTX_EPSILON) {
        // Scheduled at or after the window start: superseded by this window.
        this.head = newest;
        this.count--;
        continue;
      }
      const k = this.hK[newest] ?? Number.NaN;
      const t = this.hT[newest] ?? Number.NaN;
      if (k === first - 1 && Math.abs(t + offset - ctx) < CTX_EPSILON) {
        this.program.copy(this.hStates[newest], this.state);
        return 'rewind';
      }
      break;
    }

    this.count = 0;
    this.program.reset(this.state);
    this.fastForward(win, first, rate);
    return 'seek';
  }

  /** Step silently from rest through the grid points before `first`. */
  private fastForward(win: ScheduleWindow, first: number, rate: number): void {
    const dt = 1 / rate;
    const from = Math.max(0, first - Math.ceil(this.maxFastForwardSec * rate));
    for (let k = from; k < first; k++) {
      this.program.step(this.state, win.sampler.sample(k / rate), win.props, dt);
    }
  }

  private ensureCapacity(rate: number): void {
    const needed = Math.ceil(this.historySec * rate) + 2;
    if (needed <= this.capacity) return;
    const old = {
      k: this.hK,
      t: this.hT,
      ctx: this.hCtx,
      states: this.hStates,
      head: this.head,
      count: this.count,
      capacity: this.capacity,
    };
    this.capacity = needed;
    this.hK = new Float64Array(needed);
    this.hT = new Float64Array(needed);
    this.hCtx = new Float64Array(needed);
    this.hStates = [];
    for (let i = 0; i < needed; i++) this.hStates.push(this.program.createState());
    // Carry over existing entries, oldest first.
    this.head = 0;
    this.count = 0;
    for (let i = old.count; i > 0; i--) {
      const j = (old.head - i + old.capacity) % old.capacity;
      this.hK[this.head] = old.k[j] ?? 0;
      this.hT[this.head] = old.t[j] ?? 0;
      this.hCtx[this.head] = old.ctx[j] ?? 0;
      this.program.copy(old.states[j], this.hStates[this.head]);
      this.head = (this.head + 1) % this.capacity;
      this.count++;
    }
  }

  private remember(k: number, t: number, ctx: number): void {
    this.hK[this.head] = k;
    this.hT[this.head] = t;
    this.hCtx[this.head] = ctx;
    this.program.copy(this.state, this.hStates[this.head]);
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }
}
