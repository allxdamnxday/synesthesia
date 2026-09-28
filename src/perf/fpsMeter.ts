/** Frames per second over a sliding window of recent frame timestamps (milliseconds). */
export class FpsMeter {
  private readonly times: number[] = [];
  private readonly windowMs: number;

  constructor(windowMs = 1000) {
    this.windowMs = windowMs;
  }

  /** Record a frame at `nowMs` (e.g. the requestAnimationFrame timestamp). */
  tick(nowMs: number): void {
    this.times.push(nowMs);
    const cutoff = nowMs - this.windowMs;
    while (this.times.length > 2 && (this.times[0] ?? nowMs) < cutoff) this.times.shift();
  }

  /** Average fps over the window; 0 until two frames have been seen. */
  get fps(): number {
    const n = this.times.length;
    if (n < 2) return 0;
    const span = (this.times[n - 1] ?? 0) - (this.times[0] ?? 0);
    return span > 0 ? ((n - 1) * 1000) / span : 0;
  }

  reset(): void {
    this.times.length = 0;
  }
}
