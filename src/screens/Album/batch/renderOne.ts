/**
 * Where batch rendering meets the MP4 render pipeline (src/render, SPEC 10.2).
 *
 * Each chosen track renders at its own composition's size and frame rate, reports its
 * progress, pauses between frames when the batch is paused, stops when the batch is
 * cancelled, and saves the MP4 (and the `.spcomp.json` sidecar when asked) to the chosen
 * folder or the downloads folder. Failures are wrapped in a TrackRenderError whose message
 * is written for the artist; the batch records it and carries on with the next track.
 */
import {
  isRenderCancelled,
  progressFraction,
  RenderError,
  renderComposition,
  type RenderDestination as PipelineDestination,
} from '../../../render';
import { TrackRenderError, type RenderOneFn } from './renderTracks';

const GENERIC_FAILURE = 'This track couldn’t be rendered. The others carry on.';

export const renderOneTrack: RenderOneFn | null = async (request) => {
  const { composition, signature } = request;
  const destination: PipelineDestination =
    request.destination.kind === 'folder'
      ? { kind: 'folder', directory: request.destination.handle }
      : { kind: 'download' };
  try {
    const result = await renderComposition({
      composition,
      signature,
      output: {
        width: composition.render.width,
        height: composition.render.height,
        fps: composition.render.fps,
        normalize: request.normalize,
        sidecar: request.sidecar,
      },
      destination,
      signal: request.signal,
      onProgress: (progress) => request.onProgress(progressFraction(progress)),
      pause: { wait: () => request.checkpoint() },
    });
    return { fileName: result.fileName };
  } catch (err) {
    if (request.signal.aborted || isRenderCancelled(err)) {
      throw new DOMException('The batch was cancelled.', 'AbortError');
    }
    if (err instanceof RenderError) throw new TrackRenderError(err.message, err.detail);
    throw new TrackRenderError(GENERIC_FAILURE, err instanceof Error ? err.message : String(err));
  }
};
