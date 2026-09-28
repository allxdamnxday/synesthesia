/**
 * The pure second half of extraction (SPEC 8.1 steps 8–12): noise floor → soft threshold
 * → extraction smoothing → features → stats → hash. The worker feeds it the pooled raw
 * field; synthetic signatures and tests feed it analytic fields.
 */
import { assembleSignature, cleanField, type SignatureBody } from './assemble';
import { computeFeatures } from './features';
import { applySoftThreshold, resolveNoiseFloor } from './noiseFloor';
import { normalizeWindow, smoothOverTime } from './temporalSmoothing';
import type { ExtractionOptions, KineticSignature, SignatureFeatures } from './types';

export interface RawField {
  /** frameCount × rows × cols × 2 (u, v), field diagonals per second, before the floor. */
  field: Float32Array;
  frameCount: number;
  cols: number;
  rows: number;
  /** Analysis frames per second. */
  fps: number;
}

export type ProcessOptions = Pick<
  ExtractionOptions,
  'noiseFloorMode' | 'manualNoiseFloor' | 'temporalSmoothingFrames'
>;

export interface ProcessedField {
  /** Final field: after the soft threshold and extraction smoothing. */
  field: Float32Array;
  features: SignatureFeatures;
  /** The noise floor used. */
  floor: number;
  /** The smoothing window used (after normalizing). */
  window: number;
}

/** Floor → soft threshold → smoothing → features, synchronously. The input is not changed. */
export function processRawField(raw: RawField, options: ProcessOptions): ProcessedField {
  const cells = raw.cols * raw.rows;
  if (raw.frameCount < 1) throw new Error('A signature needs at least one frame of movement');
  if (raw.field.length !== raw.frameCount * cells * 2) {
    throw new Error('Raw field length does not match frameCount × grid');
  }
  // Work on a copy with any non-finite values (a decoder or flow glitch) set to 0.
  const rawField = cleanField(Float32Array.from(raw.field));
  const floor = resolveNoiseFloor(
    rawField,
    raw.frameCount,
    cells,
    options.noiseFloorMode,
    options.manualNoiseFloor,
  );
  const thresholded = applySoftThreshold(rawField, floor);
  const window = normalizeWindow(options.temporalSmoothingFrames);
  const field = smoothOverTime(thresholded, raw.frameCount, cells * 2, window);
  const features = computeFeatures({
    field,
    frameCount: raw.frameCount,
    cols: raw.cols,
    rows: raw.rows,
    fps: raw.fps,
    floor,
  });
  return { field, features, floor, window };
}

export interface FinishInput {
  raw: RawField;
  options: ProcessOptions & Pick<ExtractionOptions, 'farneback'>;
  /** The analysis size actually used, as its longer side in pixels. */
  analysisWidth: number;
  source: KineticSignature['source'];
  preferredSpeed: number;
}

export async function finishSignature(input: FinishInput): Promise<SignatureBody> {
  const { raw, options } = input;
  const processed = processRawField(raw, options);
  return assembleSignature({
    source: input.source,
    preferredSpeed: input.preferredSpeed,
    options,
    analysisWidth: input.analysisWidth,
    temporalSmoothingFrames: processed.window,
    noiseFloor: processed.floor,
    frameRate: raw.fps,
    grid: { cols: raw.cols, rows: raw.rows },
    field: processed.field,
    features: processed.features,
  });
}
