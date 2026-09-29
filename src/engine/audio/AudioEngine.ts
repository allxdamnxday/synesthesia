/**
 * Preview sound engine (SPEC 9.1 "Sound scheduling", 7.5 timing model).
 *
 * Owns an AudioContext (48 kHz requested), the master chain, and the current sound
 * material. A lookahead scheduler runs every ~50 ms and schedules the next ~200 ms of the
 * composition timeline into the material, in windows aligned to the global control grid,
 * so preview and the offline render write the same automation.
 *
 * The AudioContext is the master clock: `compositionTime()` / `compositionTimeAt()` tell
 * the visual preview loop which composition time is audible right now, for A/V sync.
 *
 * Transport behaviour:
 * - play/pause fade in/out over a few milliseconds (no clicks);
 * - seek dips the output around the jump (8 ms out, silent, 8 ms in); the material resets
 *   and fast-forwards to the new time;
 * - at the end of the timeline the engine stops and calls `onEnded`, or, with `loop` on,
 *   wraps to 0 seamlessly: the sound's state carries straight on (click-free);
 * - property edits cancel scheduled automation just ahead of the audible time and
 *   reschedule the window with the new values (SPEC 9.1);
 * - switching material crossfades old and new without stopping playback;
 * - if the main thread is too busy for the scheduler to keep up and the scheduled sound runs
 *   out (the material holds its last values meanwhile), the next tick resynchronises to where
 *   playback should be, with the same dip as a seek.
 *
 * Jumps are silent for one control step: after a play start, a seek, a resync or a new
 * material's start, the output stays at zero until the material's first control point has
 * passed (it can fall up to one step after the jump), so a material may set its values
 * outright at that point.
 *
 * No wall-clock reads: timing comes from `ctx.currentTime` (the lint forbids clocks here).
 * `setInterval` drives the scheduler only; what gets scheduled depends on context time.
 */
import { RampedParam } from '../../materials/sound/shared/automation';
import {
  createMasterChain,
  DEFAULT_MASTER_GAIN,
  type MasterChain,
} from '../../materials/sound/shared/masterChain';
import {
  DEFAULT_CONTROL_RATE,
  type PropertyValues,
  type SoundMaterial,
  type SoundMaterialEntry,
} from '../../materials/types';
import type { SignatureSampler } from '../../signature/types';
import { clamp } from '../../lib/math';
import { awayFromControlPoint, PlaybackMap } from './playbackMap';

export interface AudioEngineOptions {
  /** Use an existing context (the engine will not close it). Default: a new one. */
  context?: AudioContext;
  /** Requested sample rate for a new context. Default 48000. */
  sampleRate?: number;
  /** Default 'interactive'. */
  latencyHint?: AudioContextLatencyCategory | number;
  /** Seconds scheduled ahead of the audio clock. Default DEFAULT_LOOKAHEAD_SEC (0.35). */
  lookaheadSec?: number;
  /** Scheduler tick in milliseconds. Default 50. */
  intervalMs?: number;
  /** Automation points per second. Default DEFAULT_CONTROL_RATE. */
  controlRate?: number;
  /** Where the master chain ends. Default `context.destination`. */
  destination?: AudioNode;
  /** Master gain. Default as offline renders. */
  masterGain?: number;
}

export interface SoundLoadOptions {
  entry: SoundMaterialEntry;
  sampler: SignatureSampler;
  props: PropertyValues;
  seed: number;
}

interface Slot {
  entry: SoundMaterialEntry;
  material: SoundMaterial;
  node: GainNode;
  gain: RampedParam;
}

/** How the lookahead scheduler has kept up since playback started (for Diagnostics). */
export interface SchedulerStats {
  /** Scheduler ticks while playing. */
  ticks: number;
  /**
   * Times the schedule ran out before a tick came (a busy main thread) and playback had to
   * resynchronise.
   */
  resyncs: number;
  /** Context time where the latest resync jumped, in silence (NaN if none). */
  lastResyncAt: number;
  /**
   * Smallest amount of scheduled sound left when a tick came, in seconds (Infinity before the
   * second tick). Normally about lookahead − interval; below the safety margin means a resync.
   */
  minLeadSec: number;
}

function freshStats(): SchedulerStats {
  return {
    ticks: 0,
    resyncs: 0,
    lastResyncAt: Number.NaN,
    minLeadSec: Number.POSITIVE_INFINITY,
  };
}

/** Play/pause fade, seconds. */
const FADE_SEC = 0.012;
/** Seek dip: fade out, jump, fade in; seconds each way. */
const DIP_SEC = 0.008;
/** Material switch crossfade, seconds. */
const XFADE_SEC = 0.04;
/** Timelines shorter than this don't loop (guards a runaway scheduler). */
const MIN_LOOP_SEC = 0.05;
/**
 * Seconds scheduled ahead around a material's start (play, a material switch): its build and
 * first window can keep the main thread busy for a while (a new impulse response, seeded
 * noise), longer than the usual lookahead would cover.
 */
const START_LOOKAHEAD_SEC = 0.5;
/** How far ahead the preview scheduler keeps sound written (SPEC 9.1 suggests ~0.2 s). */
export const DEFAULT_LOOKAHEAD_SEC = 0.35;
/** A live edit starts at least this many samples away from any control point. */
const GRID_GUARD_SAMPLES = 4;

export class AudioEngine {
  readonly context: AudioContext;
  /** Called when playback reaches the end of the timeline with loop off. */
  onEnded: (() => void) | null = null;
  /** Called when a loop wrap becomes audible (composition time jumped back to 0). */
  onLoop: (() => void) | null = null;

  private readonly ownsContext: boolean;
  private readonly chain: MasterChain;
  private readonly fadeNode: GainNode;
  private readonly fade: RampedParam;
  private readonly lookaheadSec: number;
  private readonly intervalMs: number;
  private readonly controlRate: number;

  private slot: Slot | null = null;
  private retiring: Slot[] = [];
  private sampler: SignatureSampler | null = null;
  private props: PropertyValues = {};
  private seedValue = 0;
  private lastDuration = 0;

  private readonly map = new PlaybackMap();
  private playingFlag = false;
  private position = 0;
  private loopFlag = false;
  private mutedFlag = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Context time up to which the material has been scheduled. */
  private scheduledCtx = 0;
  /** Composition time at `scheduledCtx`. */
  private scheduledT = 0;
  /** Context time where the timeline ends (loop off), once scheduled. */
  private endCtx = Number.POSITIVE_INFINITY;
  /** Start of the fade at the end of the timeline, if scheduled. */
  private endFadeAt = Number.NaN;
  /** Context times of scheduled loop wraps not yet reported. */
  private pendingWraps: number[] = [];
  private playToken = 0;
  private loadToken = 0;
  private disposed = false;
  private stats: SchedulerStats = freshStats();
  /** False until the first tick after play() has scheduled (its lead is not a measurement). */
  private leadValid = false;

  constructor(options: AudioEngineOptions = {}) {
    this.ownsContext = !options.context;
    this.context =
      options.context ??
      new AudioContext({
        sampleRate: options.sampleRate ?? 48000,
        latencyHint: options.latencyHint ?? 'interactive',
      });
    // 0.35 s of slack: a Persistence drag rebuilds a reverb on the main thread (tens of ms,
    // longer on a 2017 MacBook Pro); 0.2 s occasionally ran dry. Live edits aren't delayed by
    // this: they cancel and reschedule from "now".
    this.lookaheadSec = options.lookaheadSec ?? DEFAULT_LOOKAHEAD_SEC;
    this.intervalMs = options.intervalMs ?? 50;
    this.controlRate = options.controlRate ?? DEFAULT_CONTROL_RATE;
    this.chain = createMasterChain(this.context, options.destination ?? this.context.destination, {
      gain: options.masterGain ?? DEFAULT_MASTER_GAIN,
    });
    this.fadeNode = this.context.createGain();
    this.fade = new RampedParam(this.fadeNode.gain, 0);
    this.fadeNode.connect(this.chain.input);
  }

  /** Full composition timeline in seconds (0 before a material is loaded). */
  get duration(): number {
    return this.sampler?.duration ?? 0;
  }

  get playing(): boolean {
    return this.playingFlag;
  }

  get loop(): boolean {
    return this.loopFlag;
  }

  get muted(): boolean {
    return this.mutedFlag;
  }

  get seed(): number {
    return this.seedValue;
  }

  /** Id of the loaded sound material, or null. */
  get materialId(): string | null {
    return this.slot?.entry.meta.id ?? null;
  }

  /** How the scheduler has kept up since the last `resetSchedulerStats()` (or construction). */
  get schedulerStats(): SchedulerStats {
    return { ...this.stats };
  }

  resetSchedulerStats(): void {
    this.stats = freshStats();
  }

  /**
   * Build a fresh instance of a sound material and make it current. While playing, the new
   * material crossfades in at the current position without restarting playback. Call again
   * to change the seed or the signature.
   */
  async load(opts: SoundLoadOptions): Promise<void> {
    this.assertUsable();
    const token = ++this.loadToken;
    // Building the new material can take a while: let the current one run further ahead.
    this.scheduleAhead(START_LOOKAHEAD_SEC);
    const material = opts.entry.create();
    const node = this.context.createGain();
    const gain = new RampedParam(node.gain, 0);
    node.connect(this.fadeNode);
    try {
      await material.build(this.context, node, opts.seed);
    } catch (err) {
      node.disconnect();
      throw err;
    }
    if (token !== this.loadToken || this.disposed) {
      material.dispose();
      node.disconnect();
      return;
    }

    const samplerChanged = this.sampler !== opts.sampler;
    // So is the new material's first window: it takes over this far ahead.
    if (!samplerChanged) this.scheduleAhead(START_LOOKAHEAD_SEC);
    const old = this.slot;
    this.slot = { entry: opts.entry, material, node, gain };
    this.sampler = opts.sampler;
    this.props = opts.props;
    this.seedValue = opts.seed;
    this.lastDuration = opts.sampler.duration;

    const at = this.context.currentTime + this.safetyMargin();
    if (old) this.retire(old, at);
    if (!this.playingFlag) {
      gain.setAt(1, at);
      this.position = clamp(this.position, 0, this.duration);
      return;
    }
    if (samplerChanged) {
      // A different signature: the timeline itself changed, so jump (with a dip).
      gain.setAt(1, at);
      this.jumpTo(at, clamp(this.compositionTime(), 0, this.duration));
      this.scheduleAhead(START_LOOKAHEAD_SEC);
      return;
    }
    gain.setAt(0, at);
    gain.rampTo(1, at + this.jumpHoldSec(), XFADE_SEC);
    this.scheduleMaterialRange(material, at, this.scheduledCtx);
  }

  /**
   * Start playback at `from` (default: where it was paused; the start after the end).
   * Resumes the AudioContext, so call it from a user gesture the first time.
   */
  async play(from?: number): Promise<void> {
    this.assertUsable();
    if (!this.slot || !this.sampler) throw new Error('Load a sound material before playing.');
    const token = ++this.playToken;
    if (this.context.state !== 'running') await this.context.resume();
    if (token !== this.playToken || this.disposed) return;
    if (this.playingFlag) {
      if (from !== undefined) this.seek(from);
      return;
    }
    const duration = this.duration;
    let t = clamp(from ?? this.position, 0, duration);
    if (t >= duration - 1e-6) t = 0;
    const at = this.context.currentTime + this.safetyMargin();
    // If a pause is still fading out, finish that fade first so the jump to the new
    // position happens in silence.
    const fadeOut = this.fade.valueAt(at) > 0 ? FADE_SEC : 0;
    const start = at + fadeOut;
    this.fade.rampTo(0, at, fadeOut);
    this.slot.material.cancelFrom(start);
    t = Math.min(this.offGridTime(t), duration);
    this.map.reset(start, t);
    this.scheduledCtx = start;
    this.scheduledT = t;
    this.endCtx = Number.POSITIVE_INFINITY;
    this.endFadeAt = Number.NaN;
    this.pendingWraps = [];
    this.fade.rampTo(1, start + this.jumpHoldSec(), FADE_SEC);
    this.playingFlag = true;
    this.leadValid = false;
    // The first window may be heavy (the material's first impulse response): a head start.
    this.scheduleAhead(START_LOOKAHEAD_SEC);
    this.tick();
    this.timer = setInterval(this.tick, this.intervalMs);
  }

  /** Pause with a short fade. The position is where the listener heard it stop. */
  pause(): void {
    this.playToken++;
    if (!this.playingFlag) return;
    const at = this.context.currentTime + this.safetyMargin();
    this.position = clamp(this.compositionTime(), 0, this.duration);
    this.fade.rampTo(0, at, FADE_SEC);
    this.slot?.material.cancelFrom(at + FADE_SEC);
    this.stopTimer();
    this.playingFlag = false;
    this.endCtx = Number.POSITIVE_INFINITY;
    this.endFadeAt = Number.NaN;
    this.pendingWraps = [];
    this.map.clear();
  }

  /** Jump to composition time `t`. While playing, the output dips briefly around the jump. */
  seek(t: number): void {
    const target = clamp(t, 0, this.duration);
    if (!this.playingFlag || !this.slot) {
      this.position = target;
      return;
    }
    this.jumpTo(this.context.currentTime + this.safetyMargin(), target);
    this.scheduleUntil(this.context.currentTime + this.lookaheadSec);
  }

  /** New property values. While playing, they take effect ~30 ms later, click-free. */
  setProps(props: PropertyValues): void {
    this.props = props;
    if (!this.playingFlag || !this.slot) return;
    this.rescheduleFrom(this.context.currentTime + this.safetyMargin());
  }

  /**
   * Call after reconfiguring the sampler (speed, loops, tail, smoothing, strength). If the
   * timeline length is unchanged the new values glide in; otherwise playback jumps to the
   * same composition time in the new timeline.
   */
  timelineChanged(): void {
    const duration = this.duration;
    const lengthChanged = Math.abs(duration - this.lastDuration) > 1e-9;
    this.lastDuration = duration;
    if (!this.playingFlag) {
      this.position = clamp(this.position, 0, duration);
      return;
    }
    if (lengthChanged) this.seek(Math.min(this.compositionTime(), duration));
    else this.rescheduleFrom(this.context.currentTime + this.safetyMargin());
  }

  /** Transport loop: at the end of the timeline, wrap to 0 instead of stopping. */
  setLoop(loop: boolean): void {
    if (loop === this.loopFlag) return;
    this.loopFlag = loop;
    if (!this.playingFlag) return;
    const at = this.context.currentTime + this.safetyMargin();
    if (loop) {
      if (Number.isFinite(this.endCtx) && at < this.endCtx) {
        this.endCtx = Number.POSITIVE_INFINITY;
        this.clearEndFade();
        this.scheduleUntil(this.context.currentTime + this.lookaheadSec);
      }
      return;
    }
    // Loop turned off: undo a wrap that is already scheduled ahead.
    const wrap = this.pendingWraps.find((c) => c > at);
    if (wrap === undefined) return;
    this.slot?.material.cancelFrom(wrap);
    this.map.truncateFrom(wrap);
    this.pendingWraps = this.pendingWraps.filter((c) => c < wrap);
    this.scheduledCtx = wrap;
    this.scheduledT = this.duration;
    this.markEnd();
  }

  /** Mute the sound field (for mute/solo); the clock keeps running. */
  setMuted(muted: boolean): void {
    this.mutedFlag = muted;
    this.chain.setMuted(muted, this.context.currentTime + 0.005);
  }

  /**
   * Composition time audible right now, from the audio clock (steps with each audio
   * callback). For smooth visuals, use `compositionTimeAt(frameTimestamp)`.
   */
  compositionTime(): number {
    if (!this.playingFlag) return this.position;
    return this.timeAtContextTime(this.context.currentTime - this.outputLatencySec());
  }

  /**
   * Composition time audible at wall-clock time `wallMs` on the `performance.now()` timeline
   * (e.g. a requestAnimationFrame timestamp), using `getOutputTimestamp()`. Smooth between
   * audio callbacks and compensated for output latency: the visual loop should use this.
   */
  compositionTimeAt(wallMs: number): number {
    if (!this.playingFlag) return this.position;
    const ts = this.context.getOutputTimestamp();
    const ctxTime = ts.contextTime;
    const perfTime = ts.performanceTime;
    if (ctxTime === undefined || perfTime === undefined || !(perfTime > 0)) {
      return this.compositionTime();
    }
    const at = ctxTime + (wallMs - perfTime) / 1000;
    return this.timeAtContextTime(Math.min(at, this.context.currentTime));
  }

  /** Composition time that plays at AudioContext time `ctxTime` (current schedule). */
  timeAtContextTime(ctxTime: number): number {
    if (!this.playingFlag || this.map.empty) return this.position;
    const at = Math.min(Math.max(ctxTime, this.map.firstCtx), this.scheduledCtx);
    return clamp(this.map.timeAt(at), 0, this.duration);
  }

  /** Stop everything and release the audio graph (closes the context if the engine made it). */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.stopTimer();
    this.playingFlag = false;
    for (const slot of [...this.retiring, ...(this.slot ? [this.slot] : [])]) {
      slot.material.dispose();
      slot.node.disconnect();
    }
    this.retiring = [];
    this.slot = null;
    this.fadeNode.disconnect();
    this.chain.dispose();
    if (this.ownsContext) await this.context.close();
  }

  // ---------------------------------------------------------------------------------------

  private readonly tick = (): void => {
    if (!this.playingFlag || this.disposed) return;
    const now = this.context.currentTime;
    const audible = now - this.outputLatencySec();

    // Report loop wraps that are now audible.
    while (this.pendingWraps.length > 0 && (this.pendingWraps[0] ?? 0) <= audible) {
      this.pendingWraps.shift();
      this.onLoop?.();
    }

    if (Number.isFinite(this.endCtx)) {
      if (audible >= this.endCtx) this.finish();
      return;
    }

    this.stats.ticks++;
    if (this.leadValid) {
      this.stats.minLeadSec = Math.min(this.stats.minLeadSec, this.scheduledCtx - now);
    }
    this.leadValid = true;
    const margin = this.safetyMargin();
    if (this.scheduledCtx < now + margin) {
      // The timer was starved (a busy main thread) and the scheduled sound ran out: the
      // material has been holding its last values. Resynchronise to where playback should be
      // now, with the same dip as a seek, so the jump from the held sound can't click or snap.
      // The material treats it as a seek.
      this.stats.resyncs++;
      const at = now + margin;
      const target = Math.min(this.map.timeAt(at + DIP_SEC), this.duration);
      this.stats.lastResyncAt = this.jumpTo(at, target);
    }
    this.scheduleUntil(now + this.lookaheadSec);
    this.map.prune(audible - 1);
    this.fade.prune(audible - 1);
    this.slot?.gain.prune(audible - 1);
  };

  /**
   * Jump the timeline to composition time `target` inside a dip: the output fades out from
   * `at`, the material jumps at the returned switch time in silence, stays silent for one
   * control step (its first control point may fall that late), then fades back in.
   * Scheduling continues from the switch time.
   */
  private jumpTo(at: number, target: number): number {
    const switchAt = at + DIP_SEC;
    // Land a few samples off the control grid (seek targets are often round times, which sit
    // exactly on a control point): see offControlPoint for the Chrome behaviour this avoids.
    const landing = Math.min(this.offGridTime(target), this.duration);
    this.fade.rampTo(0, at, DIP_SEC);
    this.fade.rampTo(1, switchAt + this.jumpHoldSec(), DIP_SEC);
    this.slot?.material.cancelFrom(switchAt);
    this.map.push(switchAt, landing);
    this.pendingWraps = this.pendingWraps.filter((c) => c < switchAt);
    this.scheduledCtx = switchAt;
    this.scheduledT = landing;
    this.endCtx = Number.POSITIVE_INFINITY;
    this.endFadeAt = Number.NaN;
    return switchAt;
  }

  /**
   * Silence after a jump before fading in: one control step, the longest a material's first
   * control point can come after the start of a window.
   */
  private jumpHoldSec(): number {
    return 1 / this.controlRate;
  }

  /**
   * While playing, schedule at least `sec` ahead of the audio clock (at least the usual
   * lookahead). Does nothing once the end is scheduled, or if the schedule has already run
   * out (the next tick resyncs).
   */
  private scheduleAhead(sec: number): void {
    if (!this.playingFlag || !this.slot || Number.isFinite(this.endCtx)) return;
    const now = this.context.currentTime;
    if (this.scheduledCtx < now + this.safetyMargin()) return;
    this.scheduleUntil(now + Math.max(this.lookaheadSec, sec));
  }

  /** Schedule the current material from the cursor up to context time `horizon`. */
  private scheduleUntil(horizon: number): void {
    const slot = this.slot;
    const sampler = this.sampler;
    if (!slot || !sampler) return;
    const duration = sampler.duration;
    for (let guard = 0; this.scheduledCtx < horizon - 1e-9 && guard < 64; guard++) {
      if (this.scheduledT >= duration - 1e-9) {
        if (!this.loopFlag || duration < MIN_LOOP_SEC) {
          this.markEnd();
          return;
        }
        // Wrap: composition time restarts, the sound's state carries on.
        this.map.push(this.scheduledCtx, 0);
        this.pendingWraps.push(this.scheduledCtx);
        this.scheduledT = 0;
      }
      const t0 = this.scheduledT;
      const t1 = Math.min(duration, t0 + (horizon - this.scheduledCtx));
      slot.material.schedule({
        sampler,
        props: this.props,
        t0,
        t1,
        ctxTimeAtT0: this.scheduledCtx,
        controlRate: this.controlRate,
      });
      this.scheduledCtx += t1 - t0;
      this.scheduledT = t1;
    }
  }

  /**
   * Schedule one material over context times [from, to) following the existing playback
   * segments (used when a new material joins mid-playback).
   */
  private scheduleMaterialRange(material: SoundMaterial, from: number, to: number): void {
    const sampler = this.sampler;
    if (!sampler || to <= from) return;
    const segs = this.map.segments();
    for (let i = this.map.indexAt(from); i < segs.length; i++) {
      const seg = segs[i];
      if (!seg) break;
      const segEnd = segs[i + 1]?.ctx ?? to;
      const c0 = Math.max(seg.ctx, from);
      const c1 = Math.min(segEnd, to);
      if (c1 <= c0) continue;
      material.schedule({
        sampler,
        props: this.props,
        t0: seg.t + (c0 - seg.ctx),
        t1: seg.t + (c1 - seg.ctx),
        ctxTimeAtT0: c0,
        controlRate: this.controlRate,
      });
    }
  }

  /** Cancel the material's automation from `at` and reschedule up to the same horizon. */
  private rescheduleFrom(requested: number): void {
    const slot = this.slot;
    const at = this.offControlPoint(requested);
    if (!slot || at >= this.scheduledCtx - 1e-9) return;
    const horizon = this.scheduledCtx;
    slot.material.cancelFrom(at);
    const t = this.map.timeAt(at);
    this.map.truncateAfter(at);
    this.pendingWraps = this.pendingWraps.filter((c) => c <= at);
    this.scheduledCtx = at;
    this.scheduledT = Math.min(t, this.duration);
    if (Number.isFinite(this.endCtx)) {
      this.endCtx = Number.POSITIVE_INFINITY;
      this.clearEndFade();
    }
    this.scheduleUntil(horizon);
  }

  /**
   * A live edit's start, moved a few samples past a control point if it falls on one.
   *
   * Edits start on render-quantum boundaries and control points are every 5 ms, so about one
   * edit in fifteen would start exactly on a point. The rewritten automation then has events a
   * few ulps apart around the cancel time (the kept old point, the hold, the new point, each
   * time computed through a slightly different window offset), and Chrome renders that
   * wrongly: measured in Chrome 153 (replaying the recorded automation offline), every control
   * bus dropped to nearly zero for one sample, a loud click. A few samples away from any point,
   * the hold is an ordinary short ramp.
   */
  private offControlPoint(at: number): number {
    const guard = GRID_GUARD_SAMPLES / this.context.sampleRate;
    return awayFromControlPoint(at, this.map.timeAt(at), this.controlRate, guard);
  }

  /**
   * A composition time moved a few samples past a control point if it falls on one, for the
   * landing point of a jump (play, seek, resync). A few samples (under 0.1 ms) can't be heard.
   */
  private offGridTime(t: number): number {
    const guard = GRID_GUARD_SAMPLES / this.context.sampleRate;
    const k = Math.round(t * this.controlRate);
    return Math.abs(t - k / this.controlRate) < guard ? t + 2 * guard : t;
  }

  /** The timeline ends at the cursor: fade out over its last moments. */
  private markEnd(): void {
    this.endCtx = this.scheduledCtx;
    const earliest = this.context.currentTime + this.safetyMargin();
    const fadeAt = Math.max(earliest, this.endCtx - FADE_SEC);
    this.fade.rampTo(0, fadeAt, Math.max(0.002, this.endCtx - fadeAt));
    this.endFadeAt = fadeAt;
  }

  private clearEndFade(): void {
    if (Number.isNaN(this.endFadeAt)) return;
    const at = Math.max(this.endFadeAt, this.context.currentTime + this.safetyMargin());
    this.fade.rampTo(1, at, FADE_SEC);
    this.endFadeAt = Number.NaN;
  }

  private finish(): void {
    this.stopTimer();
    this.playingFlag = false;
    this.position = this.duration;
    this.endCtx = Number.POSITIVE_INFINITY;
    this.endFadeAt = Number.NaN;
    this.pendingWraps = [];
    this.map.clear();
    this.onEnded?.();
  }

  /** Fade a replaced material out, then release it. */
  private retire(slot: Slot, at: number): void {
    if (!this.playingFlag) {
      slot.material.dispose();
      slot.node.disconnect();
      return;
    }
    slot.gain.rampTo(0, at, XFADE_SEC);
    slot.material.cancelFrom(at + XFADE_SEC);
    this.retiring.push(slot);
    const delayMs = (at + XFADE_SEC - this.context.currentTime + 0.25) * 1000;
    setTimeout(
      () => {
        const i = this.retiring.indexOf(slot);
        if (i < 0) return;
        this.retiring.splice(i, 1);
        slot.material.dispose();
        slot.node.disconnect();
      },
      Math.max(0, delayMs),
    );
  }

  private stopTimer(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /** How far ahead of `currentTime` changes must be placed to be safely in the future. */
  private safetyMargin(): number {
    return 0.02 + (this.context.baseLatency || 0.01);
  }

  private outputLatencySec(): number {
    return (this.context.baseLatency || 0) + (this.context.outputLatency || 0);
  }

  private assertUsable(): void {
    if (this.disposed) throw new Error('This sound engine has been closed.');
  }
}
