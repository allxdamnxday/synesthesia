/**
 * Worker-side frame source for extraction (SPEC 8.1 steps 1–4).
 *
 * Frames are taken at fixed times (the middle of each 1/fps interval over the trim), so a
 * variable-frame-rate clip becomes a constant-rate signature. Each decoded frame is drawn
 * once onto a canvas with a single orientation (container rotation → user rotate →
 * mirror), cropped to the focus area at native resolution, and only then resized to the
 * analysis size (Mediabunny's CanvasSink does this, mipmapping strong downscales so small
 * analysis frames don't alias). The pixels are read back as 8-bit grayscale. CanvasSink
 * closes every decoded sample as soon as it is drawn; no decoded frame is kept.
 */
import { CanvasSink } from 'mediabunny';
import type { OpenedClip } from './clipInfo';
import {
  CLIP_FORMAT_MESSAGE,
  CLIP_TOO_LONG_MESSAGE,
  CLIP_TOO_SHORT_MESSAGE,
  EXTRACTION_FAILED_MESSAGE,
  ExtractionFailure,
} from './extractProtocol';
import {
  analysisFrameRate,
  analysisSize,
  composeOrientation,
  focusCropPx,
  orientedSize,
  rgbaToGray,
  sampleTimestamps,
  type Orientation,
  type PixelRect,
} from './frameGeometry';
import { MAX_ANALYSIS_FPS, MAX_CLIP_SECONDS, type ExtractionOptions } from './types';

export interface FramePlan {
  /** Analysis frames per second. */
  fps: number;
  /** Where each analysis frame is taken, seconds (track time). */
  timestamps: Float64Array;
  /** The trim actually used (clamped to the clip). */
  trim: { startSec: number; endSec: number };
  orientation: Orientation;
  /** Focus area in pixels of the oriented frame. */
  crop: PixelRect;
  /** Analysis frame size. */
  width: number;
  height: number;
}

/** Fewest analysis frames that give any movement (one pair). */
export const MIN_ANALYSIS_FRAMES = 2;

/** Work out timing and geometry, refusing clips that are too long or too short. */
export function planFrames(clip: OpenedClip, options: ExtractionOptions): FramePlan {
  const fps = analysisFrameRate(clip.info.nativeFps, MAX_ANALYSIS_FPS);
  if (!(fps > 0)) {
    throw new ExtractionFailure('format', CLIP_FORMAT_MESSAGE, 'Could not measure the frame rate');
  }
  const wantStart = Number.isFinite(options.trim.startSec) ? options.trim.startSec : 0;
  const wantEnd = Number.isFinite(options.trim.endSec) ? options.trim.endSec : clip.endTimestamp;
  const startSec = Math.max(wantStart, clip.firstTimestamp);
  const endSec = Math.min(wantEnd, clip.endTimestamp);
  if (endSec - startSec > MAX_CLIP_SECONDS + 1e-3) {
    throw new ExtractionFailure(
      'too-long',
      CLIP_TOO_LONG_MESSAGE,
      `${(endSec - startSec).toFixed(2)} s after trimming`,
    );
  }
  const timestamps = sampleTimestamps(startSec, endSec, fps);
  if (timestamps.length < MIN_ANALYSIS_FRAMES) {
    throw new ExtractionFailure(
      'too-short',
      CLIP_TOO_SHORT_MESSAGE,
      `${timestamps.length} frame(s) between ${startSec} s and ${endSec} s at ${fps} fps`,
    );
  }
  const orientation = composeOrientation(
    { rotation: clip.info.rotation, flip: clip.flip },
    { rotate: options.rotate, mirror: options.mirror },
  );
  const oriented = orientedSize(
    clip.squarePixelWidth,
    clip.squarePixelHeight,
    orientation.rotation,
  );
  const crop = focusCropPx(options.focusArea, oriented.width, oriented.height);
  const { width, height } = analysisSize(crop.width, crop.height, options.analysisWidth);
  return {
    fps,
    timestamps,
    trim: { startSec, endSec },
    orientation,
    crop,
    width,
    height,
  };
}

interface CanvasLike {
  width: number;
  height: number;
  getContext(contextId: '2d'): unknown;
}

/**
 * Yield one grayscale analysis frame (width × height bytes) per planned timestamp. The
 * same buffer is reused: use each frame before asking for the next.
 */
export async function* grayFrames(clip: OpenedClip, plan: FramePlan): AsyncGenerator<Uint8Array> {
  const { width, height } = plan;
  const sink = new CanvasSink(clip.track, {
    width,
    height,
    fit: 'fill',
    rotation: plan.orientation.rotation,
    flip: plan.orientation.flip,
    crop: plan.crop,
    poolSize: 2,
  });
  const gray = new Uint8Array(width * height);
  let index = 0;
  for await (const wrapped of sink.canvasesAtTimestamps(plan.timestamps)) {
    if (!wrapped) {
      throw new ExtractionFailure(
        'failed',
        EXTRACTION_FAILED_MESSAGE,
        `No frame decoded at ${plan.timestamps[index]} s`,
      );
    }
    const canvas = wrapped.canvas as unknown as CanvasLike;
    const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | null;
    if (!ctx) throw new ExtractionFailure('failed', EXTRACTION_FAILED_MESSAGE, 'No 2D context');
    rgbaToGray(ctx.getImageData(0, 0, width, height).data, gray);
    index++;
    yield gray;
  }
}
