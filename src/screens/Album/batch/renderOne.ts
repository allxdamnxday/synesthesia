/**
 * Where batch rendering meets the MP4 render pipeline (src/render, SPEC 10.2).
 *
 * The Album screen renders each chosen track through `renderOneTrack`. It stays null
 * until the render pipeline lands; until then the screen lets the person choose tracks
 * and a folder, and explains that rendering is coming. To connect it: render
 * `request.composition` with `request.signature` at the composition's own render size,
 * report progress through `request.onProgress`, honour `request.signal` (and await
 * `request.checkpoint()` between frames so Pause holds mid-track), save the MP4 (and the
 * `.spcomp.json` sidecar when `request.sidecar`) to `request.destination`, and wrap
 * failures in a TrackRenderError with a plain-language message.
 */
import type { RenderOneFn } from './renderTracks';

export const renderOneTrack: RenderOneFn | null = null;
