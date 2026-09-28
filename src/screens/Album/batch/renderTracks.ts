/**
 * Batch render (SPEC 12.3 step 4): render the chosen tracks one after another,
 * unattended, with per-track progress, pause and cancel, and a summary at the end.
 *
 * This module only sequences. Each track is rendered by a `RenderOneFn` (renderOne.ts
 * connects it to the MP4 render pipeline in src/render), so tests can drive the whole
 * batch with a fake. A track that fails is recorded and the batch moves on, so a long
 * album never stops halfway because of one track.
 *
 * Pausing holds the batch at the next safe point: between tracks, or between frames when
 * the renderer awaits `checkpoint()`. Cancelling aborts the current track (through its
 * AbortSignal) and leaves the rest unrendered. Time spent paused doesn't count toward
 * the estimate.
 */
import type { Composition } from '../../../engine/composition';
import { LibraryError, errorDetail, userMessage } from '../../../library';
import type { KineticSignature } from '../../../signature/types';

/** Where finished files go: a folder the person chose (Chrome), or the downloads folder. */
export type RenderDestination =
  { kind: 'folder'; name: string; handle: FileSystemDirectoryHandle } | { kind: 'downloads' };

export interface BatchRenderOptions {
  destination: RenderDestination;
  /** Peak-normalize each track's sound ("Even out loudness", SPEC 9.1). */
  normalize: boolean;
  /** Save each composition's `.spcomp.json` next to its video (SPEC 10.1: on in albums). */
  sidecar: boolean;
}

export interface RenderOneRequest extends BatchRenderOptions {
  composition: Composition;
  signature: KineticSignature;
  /** Aborted when the person cancels the batch. */
  signal: AbortSignal;
  /** Progress through this track, 0–1. */
  onProgress: (fraction: number) => void;
  /**
   * Optional to await between frames: resolves at once unless the batch is paused (then
   * when it resumes) and rejects with an AbortError once the batch is cancelled.
   */
  checkpoint: () => Promise<void>;
}

export interface RenderOneResult {
  /** The file written, e.g. `SP_Wink_01_123456.mp4`. */
  fileName: string;
}

/**
 * Render one composition to MP4. Rejects with a TrackRenderError (or a LibraryError)
 * whose message is written for the artist, or with an AbortError when cancelled.
 */
export type RenderOneFn = (request: RenderOneRequest) => Promise<RenderOneResult>;

/** A failure explained in plain language (the render seam wraps technical errors in it). */
export class TrackRenderError extends Error {
  readonly detail: string | undefined;

  constructor(message: string, detail?: string) {
    super(message);
    this.name = 'TrackRenderError';
    this.detail = detail;
  }
}

export const BATCH_MESSAGES = {
  missingSignature:
    "This track's signature isn't in your library. Import the signature, then render the track again.",
  failed: "This track couldn't be rendered. The Diagnostics page can help find out why.",
} as const;

export type TrackOutcome =
  | { status: 'rendered'; fileName: string; ms: number }
  | { status: 'failed'; message: string; detail: string }
  | { status: 'skipped' };

export interface BatchSummary {
  /** One per track, in batch order; 'skipped' means not rendered because of a cancel. */
  outcomes: TrackOutcome[];
  rendered: number;
  failed: number;
  skipped: number;
  cancelled: boolean;
  /** Rendering time, not counting pauses (ms). */
  elapsedMs: number;
}

export interface BatchCallbacks {
  onTrackStart?: (index: number) => void;
  /** `etaMs`: estimated time left for the whole batch, once there's enough to go on. */
  onTrackProgress?: (index: number, fraction: number, etaMs: number | null) => void;
  /** Awaited before the next track starts (e.g. to record the file in the album). */
  onTrackDone?: (index: number, outcome: TrackOutcome) => void | Promise<void>;
  /** The batch is now holding (true) or running again (false). */
  onHoldChange?: (holding: boolean) => void;
}

export interface BatchDeps {
  renderOne: RenderOneFn;
  /** The signature a composition plays (the library's lookup: by id, else by movement). */
  loadSignature: (composition: Composition) => Promise<KineticSignature | undefined>;
  /** Milliseconds from any fixed origin (wall-clock; only for the estimate). */
  now?: () => number;
}

function abortError(): DOMException {
  return new DOMException('The batch was cancelled.', 'AbortError');
}

/** Pause, resume and cancel for one batch. */
export class BatchController {
  private readonly abort = new AbortController();
  private pauseRequested = false;
  private waiters: Array<{ resolve: () => void; reject: (reason: unknown) => void }> = [];

  get signal(): AbortSignal {
    return this.abort.signal;
  }

  get cancelled(): boolean {
    return this.abort.signal.aborted;
  }

  /** A pause was asked for (the batch holds at its next safe point). */
  get pausing(): boolean {
    return this.pauseRequested;
  }

  pause(): void {
    if (!this.cancelled) this.pauseRequested = true;
  }

  resume(): void {
    this.pauseRequested = false;
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w.resolve();
  }

  cancel(): void {
    if (this.cancelled) return;
    this.pauseRequested = false;
    this.abort.abort(abortError());
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w.reject(abortError());
  }

  /** Resolves when not paused; rejects with an AbortError if the batch is cancelled. */
  waitWhilePaused(): Promise<void> {
    if (this.cancelled) return Promise.reject(abortError());
    if (!this.pauseRequested) return Promise.resolve();
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }
}

/** Running time that can be stopped and started (pauses don't count). */
class Stopwatch {
  private total = 0;
  private since: number | null;

  constructor(private readonly now: () => number) {
    this.since = now();
  }

  stop(): void {
    if (this.since === null) return;
    this.total += this.now() - this.since;
    this.since = null;
  }

  start(): void {
    if (this.since === null) this.since = this.now();
  }

  elapsed(): number {
    return this.total + (this.since === null ? 0 : this.now() - this.since);
  }
}

/** Only estimate once a little of a track is done (SPEC 10.1: after the first frames). */
const MIN_FRACTION_FOR_ESTIMATE = 0.02;

/** The artist-facing sentence for a failed track. */
export function failureMessage(err: unknown): string {
  if (err instanceof TrackRenderError || err instanceof LibraryError) return err.message;
  const message = userMessage(err);
  return message.startsWith('Something went wrong') ? BATCH_MESSAGES.failed : message;
}

function clamp01(x: number): number {
  return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0;
}

/**
 * Render `tracks` in order. Never throws for a track's failure: every outcome is in the
 * summary. `controller` pauses, resumes and cancels while it runs.
 */
export async function renderTracks(
  tracks: readonly Composition[],
  options: BatchRenderOptions,
  callbacks: BatchCallbacks,
  deps: BatchDeps,
  controller: BatchController = new BatchController(),
): Promise<BatchSummary> {
  const stopwatch = new Stopwatch(deps.now ?? (() => performance.now()));
  const outcomes: TrackOutcome[] = tracks.map(() => ({ status: 'skipped' }));
  const durations: number[] = [];

  const checkpoint = async (): Promise<void> => {
    if (controller.cancelled) throw abortError();
    if (!controller.pausing) return;
    stopwatch.stop();
    callbacks.onHoldChange?.(true);
    try {
      await controller.waitWhilePaused();
    } finally {
      stopwatch.start();
      callbacks.onHoldChange?.(false);
    }
  };

  for (let i = 0; i < tracks.length; i++) {
    try {
      await checkpoint();
    } catch {
      break; // cancelled while holding between tracks
    }
    const composition = tracks[i];
    const startedAt = stopwatch.elapsed();
    const estimate = (fraction: number): number | null => {
      const spent = stopwatch.elapsed() - startedAt;
      const own = fraction >= MIN_FRACTION_FOR_ESTIMATE ? spent / fraction : null;
      const typical =
        durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : own;
      if (typical === null) return null;
      const current = own !== null ? own * (1 - fraction) : typical * (1 - fraction);
      return Math.max(0, current + typical * (tracks.length - i - 1));
    };

    callbacks.onTrackStart?.(i);
    let outcome: TrackOutcome;
    try {
      const signature = await deps.loadSignature(composition);
      if (!signature) {
        throw new TrackRenderError(BATCH_MESSAGES.missingSignature, composition.signature.id);
      }
      const result = await deps.renderOne({
        ...options,
        composition,
        signature,
        signal: controller.signal,
        checkpoint,
        onProgress: (fraction) => {
          const f = clamp01(fraction);
          callbacks.onTrackProgress?.(i, f, estimate(f));
        },
      });
      const ms = stopwatch.elapsed() - startedAt;
      durations.push(ms);
      outcome = { status: 'rendered', fileName: result.fileName, ms };
    } catch (err) {
      outcome = controller.cancelled
        ? { status: 'skipped' }
        : { status: 'failed', message: failureMessage(err), detail: errorDetail(err) };
      if (outcome.status === 'failed') console.warn(`Track ${i + 1} failed:`, outcome.detail);
    }
    outcomes[i] = outcome;
    try {
      await callbacks.onTrackDone?.(i, outcome);
    } catch (err) {
      console.warn('Recording a finished track failed:', errorDetail(err));
    }
    if (controller.cancelled) break;
  }

  stopwatch.stop();
  const count = (status: TrackOutcome['status']) =>
    outcomes.filter((o) => o.status === status).length;
  return {
    outcomes,
    rendered: count('rendered'),
    failed: count('failed'),
    skipped: count('skipped'),
    cancelled: controller.cancelled,
    elapsedMs: stopwatch.elapsed(),
  };
}
