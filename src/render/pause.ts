/**
 * Pausing and yielding for long renders.
 *
 * - `createPauseController()`: pause/resume a render or a batch between frames (Album
 *   batch renders, SPEC 12.3).
 * - `yieldToEventLoop()`: give the page a turn between frames so progress repaints and
 *   Cancel responds. It posts a message-channel task rather than using a timer, because
 *   Chrome slows timers in background tabs to once a second (or once a minute after five
 *   minutes), which would stall an unattended album render. Neither reads a clock.
 */
import { RenderCancelledError } from './errors';
import type { PauseGate } from './types';

export interface PauseController extends PauseGate {
  readonly paused: boolean;
  pause(): void;
  resume(): void;
}

export function createPauseController(): PauseController {
  let paused = false;
  let waiters: (() => void)[] = [];
  const release = () => {
    const current = waiters;
    waiters = [];
    for (const wake of current) wake();
  };
  return {
    get paused() {
      return paused;
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
      release();
    },
    wait(signal) {
      if (signal?.aborted) return Promise.reject(new RenderCancelledError());
      if (!paused) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          waiters = waiters.filter((w) => w !== wake);
          reject(new RenderCancelledError());
        };
        const wake = () => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        };
        waiters.push(wake);
        signal?.addEventListener('abort', onAbort, { once: true });
      });
    },
  };
}

let channel: MessageChannel | null = null;
const pending: (() => void)[] = [];

/** Resolve on a fresh task, after the browser has had a chance to paint and handle input. */
export function yieldToEventLoop(): Promise<void> {
  if (typeof MessageChannel !== 'function') {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (!channel) {
    channel = new MessageChannel();
    channel.port1.onmessage = () => pending.shift()?.();
    // Node (unit tests) keeps a process alive while a port listens; browsers have no unref.
    (channel.port1 as MessagePort & { unref?: () => void }).unref?.();
  }
  const port = channel.port2;
  return new Promise((resolve) => {
    pending.push(resolve);
    port.postMessage(null);
  });
}
