/**
 * Mapping between AudioContext time and composition time during playback.
 *
 * Playback is a chain of contiguous segments. Each starts at a context time with a
 * composition time and runs at rate 1 until the next one starts (a transport loop wrap or a
 * seek begins a new segment). Pure bookkeeping, no Web Audio, so it is unit-tested directly.
 */
export interface PlaybackSegment {
  /** Context time where the segment starts. */
  ctx: number;
  /** Composition time at that moment. */
  t: number;
}

/**
 * Where a live edit should start: `at` (context time, at composition time `t`), or, if that is
 * within `guardSec` of a control point (a multiple of 1 / `rate` in composition time), a little
 * later, `2 × guardSec` further on, clear of the point. Pure.
 */
export function awayFromControlPoint(
  at: number,
  t: number,
  rate: number,
  guardSec: number,
): number {
  const k = Math.round(t * rate);
  return Math.abs(t - k / rate) < guardSec ? at + 2 * guardSec : at;
}

/**
 * Where a jump (play, seek, resync) to composition time `t` should land: `t`, or, if that is
 * within `guardSec` of a control point, `2 × guardSec` earlier, clear of the point. Earlier,
 * not later, so an onset exactly at `t` (onsets sit on frame times, often on the grid) is
 * still played. Only near 0, where no onset can be (the first frame has no surge), does it
 * move later. Pure.
 */
export function landingOffControlPoint(t: number, rate: number, guardSec: number): number {
  const k = Math.round(t * rate);
  if (!(Math.abs(t - k / rate) < guardSec)) return t;
  return t >= 2 * guardSec ? t - 2 * guardSec : t + 2 * guardSec;
}

export class PlaybackMap {
  private segs: PlaybackSegment[] = [];

  get empty(): boolean {
    return this.segs.length === 0;
  }

  /** Context time of the earliest remembered segment (NaN when empty). */
  get firstCtx(): number {
    return this.segs[0]?.ctx ?? Number.NaN;
  }

  segments(): readonly PlaybackSegment[] {
    return this.segs;
  }

  clear(): void {
    this.segs = [];
  }

  /** Start over with a single segment. */
  reset(ctx: number, t: number): void {
    this.segs = [{ ctx, t }];
  }

  /** Begin a new segment at `ctx` (replacing any that start at or after it). */
  push(ctx: number, t: number): void {
    this.truncateFrom(ctx);
    this.segs.push({ ctx, t });
  }

  /** Drop segments that start at or after `ctx`. */
  truncateFrom(ctx: number): void {
    while (this.segs.length > 0 && (this.segs[this.segs.length - 1]?.ctx ?? 0) >= ctx) {
      this.segs.pop();
    }
  }

  /** Drop segments that start strictly after `ctx`. */
  truncateAfter(ctx: number): void {
    while (this.segs.length > 0 && (this.segs[this.segs.length - 1]?.ctx ?? 0) > ctx) {
      this.segs.pop();
    }
  }

  /** Index of the segment in force at `ctx` (the first one if `ctx` precedes them all). */
  indexAt(ctx: number): number {
    for (let i = this.segs.length - 1; i >= 0; i--) {
      if ((this.segs[i]?.ctx ?? 0) <= ctx) return i;
    }
    return 0;
  }

  /** Composition time at context time `ctx`. Before the first segment: its start time. */
  timeAt(ctx: number): number {
    const seg = this.segs[this.indexAt(ctx)];
    if (!seg) return 0;
    return seg.t + Math.max(0, ctx - seg.ctx);
  }

  /** Forget segments that ended before `ctx` (keeps the one in force at `ctx`). */
  prune(ctx: number): void {
    const i = this.indexAt(ctx);
    if (i > 0) this.segs.splice(0, i);
  }
}
