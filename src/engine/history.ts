/**
 * Undo/redo for composition edits (SPEC 6.3, 13.1 "safe to explore"). Continuous
 * gestures (a slider drag) are coalesced into one step with `coalesceKey`.
 */

export interface History<T> {
  readonly present: T;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
  lastKey: string | null;
}

export class UndoHistory<T> implements History<T> {
  private state: HistoryState<T>;
  private readonly limit: number;

  constructor(initial: T, limit = 200) {
    this.state = { past: [], present: initial, future: [], lastKey: null };
    this.limit = limit;
  }

  get present(): T {
    return this.state.present;
  }

  get canUndo(): boolean {
    return this.state.past.length > 0;
  }

  get canRedo(): boolean {
    return this.state.future.length > 0;
  }

  /**
   * Record a new present value. With a `coalesceKey` equal to the previous push's key,
   * the change merges into the same undo step (e.g. one slider drag).
   */
  push(next: T, coalesceKey: string | null = null): void {
    const { past, present, lastKey } = this.state;
    if (coalesceKey !== null && coalesceKey === lastKey && past.length > 0) {
      this.state = { past, present: next, future: [], lastKey };
      return;
    }
    const trimmed = past.length >= this.limit ? past.slice(past.length - this.limit + 1) : past;
    this.state = { past: [...trimmed, present], present: next, future: [], lastKey: coalesceKey };
  }

  /** End the current coalescing gesture so the next push starts a new step. */
  endGesture(): void {
    this.state = { ...this.state, lastKey: null };
  }

  /** Replace the present value without recording an undo step (e.g. after a load). */
  replace(value: T): void {
    this.state = { ...this.state, present: value, lastKey: null };
  }

  undo(): T {
    const { past, present, future } = this.state;
    const previous = past[past.length - 1];
    if (previous === undefined) return present;
    this.state = {
      past: past.slice(0, -1),
      present: previous,
      future: [present, ...future],
      lastKey: null,
    };
    return previous;
  }

  redo(): T {
    const { past, present, future } = this.state;
    const next = future[0];
    if (next === undefined) return present;
    this.state = {
      past: [...past, present],
      present: next,
      future: future.slice(1),
      lastKey: null,
    };
    return next;
  }

  clear(value: T): void {
    this.state = { past: [], present: value, future: [], lastKey: null };
  }
}
