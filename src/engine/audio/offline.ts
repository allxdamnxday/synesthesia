/**
 * Offline sound render (SPEC 9.1, 10.2 step 3 "audio first"): build a fresh material on an
 * OfflineAudioContext covering the timeline, schedule it, render, and peak-normalize.
 * The MP4 render calls this before drawing any video frame.
 *
 * Scheduling: timelines up to 60 s get one `schedule()` call over [0, duration), exactly as
 * SPEC 10.2 describes. Longer ones are scheduled in 5 s windows, one window ahead of the
 * renderer, using `OfflineAudioContext.suspend()`. The samples are bit-identical (the
 * material writes the same grid points either way), but Chrome renders a single huge
 * automation list in quadratic time: measured on Chrome 153, 480 s took 8.1 s in one call
 * and 1.2 s in windows.
 */
import { createMasterChain } from '../../materials/sound/shared/masterChain';
import {
  DEFAULT_CONTROL_RATE,
  type PropertyValues,
  type SoundMaterialEntry,
} from '../../materials/types';
import type { SignatureSampler } from '../../signature/types';
import { DEFAULT_NORMALIZE_DB, normalizeBufferPeak } from './normalize';

export interface OfflineSoundOptions {
  entry: SoundMaterialEntry;
  sampler: SignatureSampler;
  props: PropertyValues;
  seed: number;
  /** Seconds to render (normally `sampler.duration`). */
  duration: number;
  /** Default 48000. */
  sampleRate?: number;
  /** Peak-normalize to `normalizeDb` (default on, −1 dBFS). */
  normalize?: boolean;
  normalizeDb?: number;
  /** Automation points per second. Default DEFAULT_CONTROL_RATE (200). */
  controlRate?: number;
  /**
   * Scheduling window in seconds. 0 means one `schedule()` call over the whole timeline.
   * Default: 0 up to SINGLE_CALL_MAX_SEC, LONG_WINDOW_SEC beyond. Any value renders the
   * same samples; tests use small windows to prove preview/offline parity.
   */
  windowSec?: number;
  /** Master gain before the soft limiter. Default as the preview engine. */
  masterGain?: number;
}

/** Longest timeline rendered with a single schedule() call. */
export const SINGLE_CALL_MAX_SEC = 60;
/** Window used for longer timelines. */
export const LONG_WINDOW_SEC = 5;
export const DEFAULT_SAMPLE_RATE = 48000;

/** Window edges [0, w, 2w, …, duration]; a single window when `windowSec` is 0. */
export function windowEdges(duration: number, windowSec: number): number[] {
  if (!(windowSec > 0) || windowSec >= duration) return [0, duration];
  const edges: number[] = [];
  for (let k = 0; k * windowSec < duration; k++) edges.push(k * windowSec);
  edges.push(duration);
  return edges;
}

export async function renderSoundOffline(opts: OfflineSoundOptions): Promise<AudioBuffer> {
  const sampleRate = opts.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const duration = Math.max(0, opts.duration);
  const length = Math.max(1, Math.ceil(duration * sampleRate));
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length, sampleRate });
  const chain = createMasterChain(ctx, ctx.destination, { gain: opts.masterGain });
  const material = opts.entry.create();
  await material.build(ctx, chain.input, opts.seed);

  const controlRate = opts.controlRate ?? DEFAULT_CONTROL_RATE;
  const windowSec = opts.windowSec ?? (duration <= SINGLE_CALL_MAX_SEC ? 0 : LONG_WINDOW_SEC);
  const schedule = (t0: number, t1: number): void => {
    if (t1 <= t0) return;
    // ctxTimeAtT0 === t0: offline context time is composition time.
    material.schedule({
      sampler: opts.sampler,
      props: opts.props,
      t0,
      t1,
      ctxTimeAtT0: t0,
      controlRate,
    });
  };

  const edges = windowEdges(duration, windowSec);
  let failure: Error | null = null;
  const fail = (err: unknown): void => {
    failure ??= err instanceof Error ? err : new Error('Scheduling the sound failed.');
  };
  // Schedule the first two windows now; when rendering reaches the start of window w,
  // schedule window w + 1, so events are always written a full window ahead.
  schedule(edges[0] ?? 0, edges[1] ?? duration);
  if (edges.length > 2) schedule(edges[1] ?? 0, edges[2] ?? duration);
  for (let w = 1; w + 2 < edges.length; w++) {
    const at = edges[w] ?? 0;
    const a = edges[w + 1] ?? 0;
    const b = edges[w + 2] ?? 0;
    ctx
      .suspend(at)
      .then(() => {
        try {
          schedule(a, b);
        } catch (err) {
          fail(err);
        }
        return ctx.resume();
      })
      .catch(fail);
  }

  let buffer: AudioBuffer;
  try {
    buffer = await ctx.startRendering();
  } finally {
    material.dispose();
    chain.dispose();
  }
  // Assigned inside the suspend callbacks; TypeScript can't see that.
  const failed = failure as Error | null;
  if (failed) throw failed;
  if (opts.normalize ?? true) normalizeBufferPeak(buffer, opts.normalizeDb ?? DEFAULT_NORMALIZE_DB);
  return buffer;
}
