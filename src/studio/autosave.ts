/**
 * Autosave for the Studio's working composition (SPEC 11.1): changes are written about a
 * second after the last edit, so a crash or a closed tab loses at most that second, and
 * `flush()` writes at once (when the page hides or the Studio closes). Writes happen one
 * at a time and in order, so an older value never lands after a newer one.
 */

export interface TimerApi {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const browserTimers: TimerApi = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Debounce for Studio autosave. */
export const AUTOSAVE_DELAY_MS = 1000;

export class Debouncer<T> {
  private pendingValue: { value: T } | null = null;
  private timer: unknown = null;
  private chain: Promise<void> = Promise.resolve();
  private readonly write: (value: T) => Promise<void> | void;
  private readonly delayMs: number;
  private readonly timers: TimerApi;
  private readonly onError: (error: unknown) => void;

  constructor(options: {
    write: (value: T) => Promise<void> | void;
    delayMs?: number;
    timers?: TimerApi;
    onError?: (error: unknown) => void;
  }) {
    this.write = options.write;
    this.delayMs = options.delayMs ?? AUTOSAVE_DELAY_MS;
    this.timers = options.timers ?? browserTimers;
    this.onError = options.onError ?? (() => undefined);
  }

  /** True while a value waits to be written. */
  get pending(): boolean {
    return this.pendingValue !== null;
  }

  /** Write `value` after the delay; a newer value replaces it and restarts the wait. */
  schedule(value: T): void {
    this.pendingValue = { value };
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = this.timers.set(() => {
      this.timer = null;
      void this.flush();
    }, this.delayMs);
  }

  /** Write the waiting value now (if any); resolves when every write so far has finished. */
  flush(): Promise<void> {
    if (this.timer !== null) {
      this.timers.clear(this.timer);
      this.timer = null;
    }
    const pending = this.pendingValue;
    this.pendingValue = null;
    if (pending) {
      this.chain = this.chain.then(async () => {
        try {
          await this.write(pending.value);
        } catch (error) {
          this.onError(error);
        }
      });
    }
    return this.chain;
  }

  /** Forget the waiting value without writing it. */
  cancel(): void {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
    this.pendingValue = null;
  }
}
