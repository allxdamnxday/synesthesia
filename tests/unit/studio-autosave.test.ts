import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTOSAVE_DELAY_MS, Debouncer } from '../../src/studio/autosave';

describe('autosave debouncer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes the latest value once, a second after the last change', async () => {
    const writes: number[] = [];
    const d = new Debouncer<number>({ write: (v) => void writes.push(v) });
    d.schedule(1);
    await vi.advanceTimersByTimeAsync(600);
    d.schedule(2);
    await vi.advanceTimersByTimeAsync(600);
    d.schedule(3);
    expect(writes).toEqual([]);
    expect(d.pending).toBe(true);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(writes).toEqual([3]);
    expect(d.pending).toBe(false);
  });

  it('flush writes at once; cancel forgets', async () => {
    const writes: string[] = [];
    const d = new Debouncer<string>({ write: (v) => void writes.push(v), delayMs: 5000 });
    d.schedule('a');
    await d.flush();
    expect(writes).toEqual(['a']);
    await d.flush();
    expect(writes).toEqual(['a']);
    d.schedule('b');
    d.cancel();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(writes).toEqual(['a']);
  });

  it('writes in order, one at a time, even when a write is slow', async () => {
    const log: string[] = [];
    let release: (() => void) | null = null;
    const d = new Debouncer<string>({
      write: async (v) => {
        log.push(`start ${v}`);
        if (v === 'slow') await new Promise<void>((r) => (release = r));
        log.push(`end ${v}`);
      },
    });
    d.schedule('slow');
    const first = d.flush();
    d.schedule('fast');
    const second = d.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toEqual(['start slow']);
    (release as (() => void) | null)?.();
    await first;
    await second;
    expect(log).toEqual(['start slow', 'end slow', 'start fast', 'end fast']);
  });

  it('a failed write is reported and later writes still happen', async () => {
    const errors: unknown[] = [];
    const writes: number[] = [];
    const d = new Debouncer<number>({
      write: (v) => {
        if (v === 1) throw new Error('quota');
        writes.push(v);
      },
      onError: (e) => errors.push(e),
    });
    d.schedule(1);
    await d.flush();
    d.schedule(2);
    await d.flush();
    expect(errors).toHaveLength(1);
    expect(writes).toEqual([2]);
  });
});
