/**
 * Render progress bookkeeping and the plain-language time estimate (SPEC 10.1, 14.3).
 *
 * Pure: nothing here reads a clock. The UI passes wall-clock times into the estimator
 * (display only), so render output never depends on how fast a machine is.
 */

/** Stages of one render, in order. */
export type RenderPhase = 'starting' | 'sound' | 'frames' | 'finishing' | 'done';

export interface RenderProgress {
  phase: RenderPhase;
  /** Frames drawn and handed to the encoder so far. */
  framesDone: number;
  frameCount: number;
}

/** Share of the progress bar given to making the sound (before any frame). */
export const SOUND_SHARE = 0.05;
/** Share given to finishing the file (after the last frame). */
export const FINISH_SHARE = 0.03;

/** Overall progress of one render, 0..1, for a progress bar. */
export function progressFraction(p: RenderProgress): number {
  const frames = p.frameCount > 0 ? Math.min(1, Math.max(0, p.framesDone / p.frameCount)) : 0;
  switch (p.phase) {
    case 'starting':
      return 0;
    case 'sound':
      return 0;
    case 'frames':
      return SOUND_SHARE + (1 - SOUND_SHARE - FINISH_SHARE) * frames;
    case 'finishing':
      return 1 - FINISH_SHARE;
    case 'done':
      return 1;
  }
}

/** Frames per track for a batch, and the progress of the whole batch. */
export interface BatchPlan {
  frameCounts: readonly number[];
  totalFrames: number;
}

export function planBatch(frameCounts: readonly number[]): BatchPlan {
  const clean = frameCounts.map((n) => (Number.isFinite(n) && n > 0 ? n : 0));
  return { frameCounts: clean, totalFrames: clean.reduce((sum, n) => sum + n, 0) };
}

/**
 * Progress of a whole batch, 0..1: tracks before `index` count as done, and track `index`
 * is `trackFraction` done. Tracks weigh by their frame counts.
 */
export function batchFraction(plan: BatchPlan, index: number, trackFraction: number): number {
  if (plan.totalFrames <= 0) return 0;
  let before = 0;
  for (let i = 0; i < Math.min(index, plan.frameCounts.length); i++)
    before += plan.frameCounts[i] ?? 0;
  const current = (plan.frameCounts[index] ?? 0) * Math.min(1, Math.max(0, trackFraction));
  return Math.min(1, (before + current) / plan.totalFrames);
}

export interface EtaOptions {
  /** Frames that must be done before an estimate is given (default 5). */
  minFrames?: number;
  /** Wall-clock time the frames must have run before an estimate is given (default 1 s). */
  minElapsedMs?: number;
  /** Only the last this-many milliseconds of progress set the pace (default 10 s). */
  windowMs?: number;
}

/**
 * Estimates the time left from how fast frames have been going recently. Feed it
 * `update(now, framesDone, frameCount)` during the frames phase (`now` in milliseconds from
 * any monotonic clock). `remainingMs()` stays null until the first frames are done.
 */
export class EtaEstimator {
  private readonly minFrames: number;
  private readonly minElapsedMs: number;
  private readonly windowMs: number;
  private samples: { at: number; frames: number }[] = [];
  private startedAt: number | null = null;
  private frameCount = 0;

  constructor(options: EtaOptions = {}) {
    this.minFrames = options.minFrames ?? 5;
    this.minElapsedMs = options.minElapsedMs ?? 1000;
    this.windowMs = options.windowMs ?? 10_000;
  }

  reset(): void {
    this.samples = [];
    this.startedAt = null;
    this.frameCount = 0;
  }

  update(now: number, framesDone: number, frameCount: number): void {
    this.frameCount = frameCount;
    const last = this.samples[this.samples.length - 1];
    // Time or frames going backwards means a new render: start over.
    if (last && (now < last.at || framesDone < last.frames)) this.reset();
    this.frameCount = frameCount;
    this.startedAt ??= now;
    this.samples.push({ at: now, frames: framesDone });
    // Drop samples older than the window, keeping the newest one before it, so the pace
    // always spans at least the whole window once there is that much history.
    while (this.samples.length > 2 && now - (this.samples[1]?.at ?? now) >= this.windowMs) {
      this.samples.shift();
    }
  }

  /** Estimated milliseconds until the last frame, or null while it's too early to say. */
  remainingMs(): number | null {
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    if (!first || !last || this.startedAt === null) return null;
    if (last.frames < this.minFrames) return null;
    if (last.at - this.startedAt < this.minElapsedMs) return null;
    const elapsed = last.at - first.at;
    const done = last.frames - first.frames;
    if (elapsed <= 0 || done <= 0) return null;
    return Math.max(0, ((this.frameCount - last.frames) * elapsed) / done);
  }
}

/** "About 3 minutes left", "About 40 seconds left", "A few seconds left". */
export function formatTimeLeft(ms: number): string {
  const seconds = Math.max(0, ms) / 1000;
  if (seconds < 10) return 'A few seconds left';
  if (seconds < 55) return `About ${Math.max(10, Math.round(seconds / 5) * 5)} seconds left`;
  if (seconds < 90) return 'About a minute left';
  const minutes = seconds / 60;
  if (minutes < 59.5) return `About ${Math.round(minutes)} minutes left`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round((minutes - hours * 60) / 5) * 5;
  const hourText = hours === 1 ? '1 hour' : `${hours} hours`;
  if (rest === 0) return `About ${hourText} left`;
  if (rest === 60) return `About ${hours + 1} hours left`;
  return `About ${hourText} ${rest} minutes left`;
}

/** A length for people: "5.2 seconds", "1 minute 12 seconds", "3 minutes". */
export function formatLength(seconds: number): string {
  const s = Math.max(0, seconds);
  if (s < 59.95) {
    const rounded = Math.round(s * 10) / 10;
    const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
    return rounded === 1 ? '1 second' : `${text} seconds`;
  }
  const total = Math.round(s);
  const minutes = Math.floor(total / 60);
  const rest = total - minutes * 60;
  const minuteText = minutes === 1 ? '1 minute' : `${minutes} minutes`;
  if (rest === 0) return minuteText;
  return `${minuteText} ${rest === 1 ? '1 second' : `${rest} seconds`}`;
}
