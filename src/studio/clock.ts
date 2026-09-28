/**
 * The Studio's playback clock: where the playhead is, in seconds of composition time.
 *
 * In preview the sound engine's clock is the master (docs/ARCHITECTURE.md "Time"): every
 * animation frame the visual loop asks the clock where the playhead is and steps the
 * simulation up to that time. `AudioEngineClock` (./audioClock.ts) wraps the sound engine;
 * `WallClock` stands in when there is no playable sound (no sound material, Web Audio
 * missing, or while the sound is still loading). Both behave the same way at the end of
 * the timeline: wrap to 0 with Loop on, otherwise stop at the end; Play after the end
 * starts again from 0.
 *
 * Wall-clock reads are fine here: this folder is outside the deterministic ones, and the
 * simulation itself only ever advances by fixed steps of composition time.
 */

export interface PlaybackClock {
  /** True while the playhead advances (or is about to: the sound is starting). */
  readonly playing: boolean;
  /**
   * Composition time of the playhead. Pass a requestAnimationFrame timestamp (the
   * `performance.now()` timeline) to get the time shown in that frame.
   */
  now(atMs?: number): number;
  /** Start advancing from the current position (from 0 when at the end). */
  play(): void;
  /** Stop advancing; the playhead stays where it is. */
  pause(): void;
  /** Move the playhead; keeps playing if it was playing. */
  seek(t: number): void;
  /** At the end of the timeline, wrap to 0 instead of stopping. */
  setLoop(loop: boolean): void;
  /** The timeline's length may have changed (the sampler was reconfigured). */
  timelineChanged(): void;
  dispose(): void;
}

/** Timelines shorter than this never loop (as in the sound engine). */
const MIN_LOOP_SEC = 0.05;

export interface WallClockOptions {
  /** Current length of the timeline, in seconds (read on demand). */
  duration: () => number;
  /** Milliseconds on the `performance.now()` timeline. */
  nowMs?: () => number;
  /** Called when playback stops at the end of the timeline (Loop off). */
  onEnded?: () => void;
}

/** A clock driven by the wall clock: one second of real time is one second of composition. */
export class WallClock implements PlaybackClock {
  private origin = 0;
  private startedAtMs = 0;
  private running = false;
  private loop = false;
  private readonly duration: () => number;
  private readonly nowMs: () => number;
  private readonly onEnded: (() => void) | undefined;

  constructor(options: WallClockOptions) {
    this.duration = options.duration;
    this.nowMs = options.nowMs ?? (() => performance.now());
    this.onEnded = options.onEnded;
  }

  get playing(): boolean {
    return this.running;
  }

  now(atMs?: number): number {
    if (!this.running) return this.origin;
    const at = atMs ?? this.nowMs();
    const t = this.origin + Math.max(0, at - this.startedAtMs) / 1000;
    const duration = Math.max(0, this.duration());
    if (t < duration) return t;
    if (this.loop && duration >= MIN_LOOP_SEC) {
      // Wrap, keeping the overshoot so the rhythm of repeated passes stays even.
      const wrapped = (t - duration) % duration;
      this.origin = wrapped;
      this.startedAtMs = at;
      return wrapped;
    }
    this.origin = duration;
    this.running = false;
    this.onEnded?.();
    return duration;
  }

  play(): void {
    if (this.running) return;
    if (this.origin >= this.duration() - 1e-6) this.origin = 0;
    this.startedAtMs = this.nowMs();
    this.running = true;
  }

  pause(): void {
    if (!this.running) return;
    this.origin = this.now();
    this.running = false;
  }

  seek(t: number): void {
    const duration = Math.max(0, this.duration());
    this.origin = Number.isFinite(t) ? Math.min(duration, Math.max(0, t)) : 0;
    this.startedAtMs = this.nowMs();
  }

  setLoop(loop: boolean): void {
    this.loop = loop;
  }

  timelineChanged(): void {
    const duration = Math.max(0, this.duration());
    const t = this.now();
    if (t > duration) this.seek(duration);
  }

  dispose(): void {
    this.running = false;
  }
}
