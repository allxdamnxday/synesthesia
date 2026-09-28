/**
 * How many fixed simulation steps the preview runs per animation frame (SPEC 7.5).
 *
 * The visual never skips steps: a slow machine falls behind instead of showing something a
 * render wouldn't. While playing normally a frame needs one or two steps; after a seek the
 * wake is reset and fast-forwarded to the playhead without drawing, spread over as many
 * frames as it takes. That catch-up budget adapts to the machine: it grows while frames
 * stay smooth and halves when they stutter, so the page stays responsive on a 2017 laptop
 * and a fast desktop catches up almost at once.
 */

/** Most steps a frame runs while playing and keeping up (covers a frame of ~130 ms). */
export const PLAY_STEPS_PER_FRAME = 8;
/** Further behind than this (1 s of steps), catch up without drawing, like a seek. */
export const FAR_BEHIND_STEPS = 60;
/** Behind by more than this while playing counts as lagging (for the hint). */
export const LAG_STEPS = 15;
/** Show "Catching up…" once a catch-up (or lag) has lasted this long. */
export const CATCHING_UP_HINT_MS = 500;
/** Longest stretch of CPU time a frame spends issuing steps, in milliseconds. */
export const FRAME_STEP_TIME_MS = 12;

/** Frames this quick leave room for more catch-up work. */
const SMOOTH_FRAME_MS = 25;
/** Frames this slow mean the catch-up is crowding the page. */
const SLOW_FRAME_MS = 45;

export class CatchUpBudget {
  private value: number;
  private readonly min: number;
  private readonly max: number;
  private readonly initial: number;

  constructor(options: { min?: number; max?: number; initial?: number } = {}) {
    this.min = options.min ?? 8;
    this.max = options.max ?? 600;
    this.initial = Math.min(this.max, Math.max(this.min, options.initial ?? 30));
    this.value = this.initial;
  }

  /** Steps a catch-up frame may run. */
  get steps(): number {
    return Math.round(this.value);
  }

  /** Adapt to the time since the previous frame, in milliseconds. */
  update(frameIntervalMs: number): void {
    if (!Number.isFinite(frameIntervalMs) || frameIntervalMs <= 0) return;
    if (frameIntervalMs <= SMOOTH_FRAME_MS) {
      this.value = Math.min(this.max, this.value * 1.25 + 2);
    } else if (frameIntervalMs >= SLOW_FRAME_MS) {
      this.value = Math.max(this.min, this.value * 0.5);
    }
  }

  reset(): void {
    this.value = this.initial;
  }
}

/**
 * Did the playhead jump back (a loop wrap), or only jitter? The sound engine's clock can
 * step back by a hair when a new audio timestamp arrives; only a real jump may reset the
 * wake. Anything more than a quarter second back (or half a very short timeline) counts.
 */
export function isJumpBack(simTime: number, t: number, duration: number, dt: number): boolean {
  const threshold = Math.max(2 * dt, Math.min(0.25, 0.5 * Math.max(0, duration)));
  return simTime - t > threshold;
}

/**
 * After a seek while playing, the sound engine takes a moment (~30 ms) to jump; meanwhile
 * its clock still reports the old time. Hold the playhead at the seek target until the
 * clock arrives there (or a short while passes), so no stale frame is shown.
 */
export class SeekHold {
  private target: number | null = null;
  private untilMs = 0;

  hold(t: number, nowMs: number, forMs = 300): void {
    this.target = t;
    this.untilMs = nowMs + forMs;
  }

  /** The playhead to use this frame. */
  apply(t: number, nowMs: number): number {
    const target = this.target;
    if (target === null) return t;
    if (Math.abs(t - target) < 0.1 || nowMs > this.untilMs) {
      this.target = null;
      return t;
    }
    return target;
  }

  clear(): void {
    this.target = null;
  }
}
