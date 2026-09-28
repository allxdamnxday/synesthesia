/**
 * Batch render for Album mode (SPEC 12.3 step 4): render many compositions one after
 * another into one destination (normally the folder chosen once), with per-track
 * progress, pause and cancel, and a summary at the end.
 *
 * - Tracks render sequentially with the same output settings (a track may override them).
 * - A failed track is recorded and the batch moves on, so an unattended render finishes
 *   everything it can. Problems with the destination itself (folder gone, permission
 *   lost, disk full) stop the batch, since every later track would fail the same way.
 * - Cancel (the AbortSignal) stops the current track, deletes its partial file and skips
 *   the rest. Pause (a PauseController) holds between frames and between tracks.
 * - The sound codec is looked up once for the whole batch.
 *
 * This module doesn't load the renderer until it runs, so it is cheap to import.
 */
import type { Composition } from '../engine/composition';
import type { KineticSignature } from '../signature/types';
import {
  RenderCancelledError,
  RenderError,
  describeError,
  isRenderCancelled,
  renderErrorMessage,
  renderMessage,
  type RenderErrorCode,
} from './errors';
import type { RenderProgress } from './progress';
import type {
  PauseGate,
  RenderDestination,
  RenderEncoding,
  RenderOutputOptions,
  RenderRequest,
  RenderResult,
} from './types';

export interface BatchTrack {
  composition: Composition;
  signature: KineticSignature;
  /** Settings for this track only (for example a different size). */
  output?: Partial<RenderOutputOptions>;
}

export type BatchTrackOutcome =
  | { status: 'rendered'; result: RenderResult }
  | { status: 'failed'; message: string; detail: string; code: RenderErrorCode | 'unknown' }
  | { status: 'cancelled' }
  | { status: 'skipped' };

export interface BatchSummary {
  /** One outcome per track, in order. */
  outcomes: BatchTrackOutcome[];
  rendered: number;
  failed: number;
  skipped: number;
  cancelled: boolean;
  /** Set when a destination problem stopped the batch early. */
  stoppedBy: RenderError | null;
}

export interface BatchOptions {
  tracks: readonly BatchTrack[];
  output: RenderOutputOptions;
  destination: RenderDestination;
  signal?: AbortSignal;
  pause?: PauseGate;
  encoding?: RenderEncoding;
  onTrackStart?: (index: number, track: BatchTrack) => void;
  onTrackProgress?: (index: number, progress: RenderProgress) => void;
  onTrackEnd?: (index: number, outcome: BatchTrackOutcome) => void;
  /** Tests only: the function that renders one track. */
  render?: (request: RenderRequest) => Promise<RenderResult>;
  /** Tests only: where the default sound codec comes from. */
  resolveEncoding?: () => Promise<RenderEncoding>;
}

/** Destination problems that would make every later track fail too. */
const STOPPING_CODES: ReadonlySet<RenderErrorCode> = new Set<RenderErrorCode>([
  'folder-missing',
  'folder-permission',
  'disk-full',
  'write-failed',
  'no-video',
]);

async function loadRender(): Promise<(request: RenderRequest) => Promise<RenderResult>> {
  const module = await import('./renderComposition');
  return module.renderComposition;
}

async function loadEncoding(): Promise<RenderEncoding> {
  const { getRenderDefaults } = await import('./capabilities');
  const defaults = await getRenderDefaults();
  if (!defaults.largestResolution) {
    throw new RenderError('no-video', renderMessage('no-video'), defaults.notes.join(' '));
  }
  return { audioCodec: defaults.audioCodec, audioBitrate: defaults.audioBitrate };
}

export async function renderBatch(options: BatchOptions): Promise<BatchSummary> {
  const { tracks, signal } = options;
  const outcomes: BatchTrackOutcome[] = tracks.map(() => ({ status: 'skipped' }));
  const summary: BatchSummary = {
    outcomes,
    rendered: 0,
    failed: 0,
    skipped: tracks.length,
    cancelled: false,
    stoppedBy: null,
  };
  const finish = (): BatchSummary => {
    summary.rendered = outcomes.filter((o) => o.status === 'rendered').length;
    summary.failed = outcomes.filter((o) => o.status === 'failed').length;
    summary.skipped = outcomes.filter((o) => o.status === 'skipped').length;
    return summary;
  };
  if (tracks.length === 0) return finish();

  const render = options.render ?? (await loadRender());
  let encoding = options.encoding;

  for (let index = 0; index < tracks.length; index++) {
    const track = tracks[index];
    if (!track) continue;
    try {
      await options.pause?.wait(signal);
      if (signal?.aborted) throw new RenderCancelledError();
      encoding ??= await (options.resolveEncoding ?? loadEncoding)();
      options.onTrackStart?.(index, track);
      const result = await render({
        composition: track.composition,
        signature: track.signature,
        output: { ...options.output, ...track.output },
        destination: options.destination,
        signal,
        pause: options.pause,
        encoding,
        onProgress: (progress) => options.onTrackProgress?.(index, progress),
      });
      outcomes[index] = { status: 'rendered', result };
    } catch (error) {
      if (signal?.aborted || isRenderCancelled(error)) {
        outcomes[index] = { status: 'cancelled' };
        options.onTrackEnd?.(index, outcomes[index]);
        summary.cancelled = true;
        return finish();
      }
      const code = error instanceof RenderError ? error.code : 'unknown';
      outcomes[index] = {
        status: 'failed',
        message: renderErrorMessage(error),
        detail: describeError(error),
        code,
      };
      if (error instanceof RenderError && STOPPING_CODES.has(error.code)) {
        options.onTrackEnd?.(index, outcomes[index]);
        summary.stoppedBy = error;
        return finish();
      }
    }
    options.onTrackEnd?.(index, outcomes[index]);
  }
  return finish();
}
