/**
 * Offline render to MP4 (SPEC 10): the public surface.
 *
 * Importing this module is cheap: the pipeline (Mediabunny and every material) loads on
 * the first `renderComposition` or `renderBatch` call.
 *
 *   const result = await renderComposition({
 *     composition, signature,
 *     output: { width: 1920, height: 1080, fps: 30, quality: 'high', normalize: true, sidecar: false },
 *     destination: { kind: 'folder', directory } | { kind: 'download' } | { kind: 'memory' },
 *     signal, onProgress, pause,
 *   });
 *
 * Album batch renders: `renderBatch({ tracks, output, destination, signal, pause, … })`
 * renders tracks one after another into the same folder and returns a summary.
 * Cancelling rejects with a RenderCancelledError (`isRenderCancelled(error)`); failures
 * reject with a RenderError whose `message` is plain language for the artist.
 * Capability checks live in ./capabilities (getRenderDefaults).
 */
import type { RenderRequest, RenderResult } from './types';

export type * from './types';
export {
  RenderCancelledError,
  RenderError,
  describeError,
  isRenderCancelled,
  renderErrorMessage,
  renderMessage,
  type RenderErrorCode,
  type RenderStage,
} from './errors';
export {
  EtaEstimator,
  FINISH_SHARE,
  SOUND_SHARE,
  batchFraction,
  formatLength,
  formatTimeLeft,
  planBatch,
  progressFraction,
  type BatchPlan,
  type EtaOptions,
  type RenderPhase,
  type RenderProgress,
} from './progress';
export {
  MP4_EXTENSION,
  SIDECAR_EXTENSION,
  firstFreeNumber,
  numberedStem,
  renderFileStem,
  seedLabel,
} from './naming';
export {
  RENDER_CHANNELS,
  RENDER_SAMPLE_RATE,
  audioSampleCount,
  frameTime,
  renderFrameCount,
} from './timing';
export {
  compositionDuration,
  createTimelineSampler,
  samplerConfigFor,
  signatureDurationOf,
} from './timeline';
export { createPauseController, yieldToEventLoop, type PauseController } from './pause';
export {
  renderBatch,
  type BatchOptions,
  type BatchSummary,
  type BatchTrack,
  type BatchTrackOutcome,
} from './batch';

/** Render one composition to MP4 (loads the pipeline on first use). */
export async function renderComposition(request: RenderRequest): Promise<RenderResult> {
  const pipeline = await import('./renderComposition');
  return pipeline.renderComposition(request);
}
