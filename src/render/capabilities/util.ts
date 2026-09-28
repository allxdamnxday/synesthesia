/** Small helpers shared by the capability probes. No clocks, no randomness. */

/** A readable message from anything thrown. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.name && error.name !== 'Error' ? `${error.name}: ${error.message}` : error.message;
  }
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** Thrown by {@link withTimeout} so callers can tell "took too long" from "failed". */
export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} did not finish within ${ms} ms`);
    this.name = 'TimeoutError';
  }
}

/**
 * Resolves or rejects like `promise`, or rejects with a {@link TimeoutError} after `ms`.
 * The timer only guards against a hung browser API; it never shapes any output.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(errorMessage(error)));
      },
    );
  });
}

/** Resolves after `ms` (used for a single retry after a transient failure). */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** "12 MB", "6.0 GB": decimal units, as operating systems show disk space. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'unknown';
  if (bytes < 1000) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = -1;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  const digits = value < 10 ? 1 : 0;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

/** "192 kbps" */
export function formatBitrate(bitsPerSecond: number): string {
  return `${Math.round(bitsPerSecond / 1000)} kbps`;
}
