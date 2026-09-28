/**
 * The playhead of a signature preview (Prepare's Signature view and the Signature screen).
 *
 * Composition time advances with the wall clock, one animation frame at a time, while
 * playing; it loops back to 0 at the end (or stops there when Loop is off). Everything that
 * shows the playhead (the wake canvas, the transport, the sparklines, the clip beside the
 * wake) subscribes and reads `getTime()`; the canvas turns that time into fixed 1/60 s
 * simulation steps through VisualRunner, so what it shows never depends on frame timing.
 *
 * Wall-clock code belongs outside the deterministic folders, so this lives with the screens.
 * The scheduler is injectable so the logic can be tested without a browser.
 */

export interface FrameScheduler {
  request(callback: (now: number) => void): number;
  cancel(handle: number): void;
}

export const animationFrameScheduler: FrameScheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

/** Longest step one frame may take (after a hidden tab or a debugger pause). */
export const MAX_FRAME_SEC = 0.1;

export interface PlaybackClockOptions {
  playing?: boolean;
  loop?: boolean;
  scheduler?: FrameScheduler;
}

export class PlaybackClock {
  private time = 0;
  private duration: number;
  private playing: boolean;
  private looping: boolean;
  /** Bumps whenever the timeline is reconfigured (e.g. a new speed). */
  private epoch = 0;
  private attached = false;
  private handle: number | null = null;
  private lastNow: number | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly scheduler: FrameScheduler;

  constructor(duration: number, options: PlaybackClockOptions = {}) {
    this.duration = Math.max(0, Number.isFinite(duration) ? duration : 0);
    this.playing = options.playing ?? false;
    this.looping = options.loop ?? true;
    this.scheduler = options.scheduler ?? animationFrameScheduler;
  }

  // Arrow properties: stable identities for useSyncExternalStore.
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  readonly getTime = (): number => this.time;
  readonly getDuration = (): number => this.duration;
  readonly isPlaying = (): boolean => this.playing;
  readonly isLooping = (): boolean => this.looping;
  readonly getEpoch = (): number => this.epoch;

  /** Start driving time from animation frames (call from an effect). */
  attach(): void {
    this.attached = true;
    this.schedule();
  }

  /** Stop requesting frames (effect cleanup). Playing state is kept for a later attach. */
  detach(): void {
    this.attached = false;
    this.cancel();
  }

  play(): void {
    if (this.playing) return;
    if (this.time >= this.duration) this.time = 0;
    this.playing = true;
    this.lastNow = null;
    this.schedule();
    this.emit();
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    this.cancel();
    this.emit();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  setLoop(loop: boolean): void {
    if (loop === this.looping) return;
    this.looping = loop;
    this.emit();
  }

  seek(t: number): void {
    const next = Math.min(this.duration, Math.max(0, Number.isFinite(t) ? t : 0));
    if (next === this.time) return;
    this.time = next;
    this.emit();
  }

  /**
   * A new timeline length (e.g. the speed changed). The playhead keeps its place in the
   * movement, as a fraction of the whole.
   */
  setDuration(duration: number): void {
    const next = Math.max(0, Number.isFinite(duration) ? duration : 0);
    const fraction = this.duration > 0 ? this.time / this.duration : 0;
    this.duration = next;
    this.time = Math.min(next, Math.max(0, fraction * next));
    this.epoch++;
    this.emit();
  }

  private readonly frame = (now: number): void => {
    this.handle = null;
    if (!this.playing || !this.attached) return;
    const dt =
      this.lastNow === null ? 0 : Math.min(MAX_FRAME_SEC, Math.max(0, (now - this.lastNow) / 1000));
    this.lastNow = now;
    let t = this.time + dt;
    if (this.duration <= 0) {
      t = 0;
      this.playing = false;
    } else if (t >= this.duration) {
      if (this.looping) {
        t %= this.duration;
      } else {
        t = this.duration;
        this.playing = false;
      }
    }
    this.time = t;
    this.emit();
    this.schedule();
  };

  private schedule(): void {
    if (this.attached && this.playing && this.handle === null) {
      this.handle = this.scheduler.request(this.frame);
    }
  }

  private cancel(): void {
    if (this.handle !== null) {
      this.scheduler.cancel(this.handle);
      this.handle = null;
    }
    this.lastNow = null;
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
