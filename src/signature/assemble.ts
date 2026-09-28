/**
 * Build the signature body: everything in `.sig.json` except `id`, `name` and
 * `createdAt`, which the library sets when the signature is saved.
 *
 * Features are stored as float32 values (Math.fround) so they survive any float32
 * storage unchanged, −0 becomes 0 (JSON writes −0 as 0, which would change the hash on
 * re-import), and NaN/Infinity never appear (JSON would turn them into null).
 */
import { encodeField } from './fieldCodec';
import { computeContentHash } from './hash';
import { computeStats } from './stats';
import {
  FEATURE_NAMES,
  SIGNATURE_FORMAT,
  SIGNATURE_VERSION,
  type ExtractionOptions,
  type KineticSignature,
  type SignatureFeatures,
} from './types';

export type SignatureBody = Omit<KineticSignature, 'id' | 'name' | 'createdAt'>;

const MAX_FLOAT32 = 3.4028234663852886e38;

/** A finite float32 value with −0 folded into 0. */
export function cleanFloat32(x: number): number {
  if (Number.isNaN(x)) return 0;
  const f = Math.fround(x);
  if (f === Infinity || x > MAX_FLOAT32) return MAX_FLOAT32;
  if (f === -Infinity || x < -MAX_FLOAT32) return -MAX_FLOAT32;
  return f === 0 ? 0 : f;
}

/** A finite number (NaN/±Infinity → fallback) with −0 folded into 0. */
export function cleanNumber(x: number, fallback = 0): number {
  if (!Number.isFinite(x)) return fallback;
  return x === 0 ? 0 : x;
}

/** Replace NaN/±Infinity with 0 and −0 with 0 in place. */
export function cleanField(field: Float32Array): Float32Array {
  for (let i = 0; i < field.length; i++) {
    const v = field[i];
    if (v === 0 || !Number.isFinite(v)) field[i] = 0;
  }
  return field;
}

/** Features as float32 values with no NaN, Infinity or −0; onsets as sorted unique ints. */
export function cleanFeatures(features: SignatureFeatures, frameCount: number): SignatureFeatures {
  const out = { onsets: [] } as unknown as SignatureFeatures;
  for (const name of FEATURE_NAMES) {
    const values = features[name];
    const clean: number[] = new Array<number>(frameCount);
    for (let i = 0; i < frameCount; i++) clean[i] = cleanFloat32(values[i] ?? 0);
    out[name] = clean;
  }
  const onsets = new Set<number>();
  for (const f of features.onsets) {
    if (Number.isInteger(f) && f >= 0 && f < frameCount) onsets.add(f);
  }
  out.onsets = [...onsets].sort((a, b) => a - b);
  return out;
}

export interface AssembleInput {
  source: KineticSignature['source'];
  preferredSpeed: number;
  options: Pick<ExtractionOptions, 'noiseFloorMode' | 'farneback'>;
  /** The analysis width actually used (after clamping). */
  analysisWidth: number;
  /** The window actually used (after normalizing). */
  temporalSmoothingFrames: number;
  noiseFloor: number;
  frameRate: number;
  grid: { cols: number; rows: number };
  /** Final field: frameCount × rows × cols × 2. Cleaned in place. */
  field: Float32Array;
  features: SignatureFeatures;
}

export async function assembleSignature(input: AssembleInput): Promise<SignatureBody> {
  const { grid } = input;
  const valuesPerFrame = grid.cols * grid.rows * 2;
  if (valuesPerFrame === 0 || input.field.length % valuesPerFrame !== 0) {
    throw new Error('Field length does not match the grid');
  }
  const frameCount = input.field.length / valuesPerFrame;
  const field = cleanField(input.field);
  const features = cleanFeatures(input.features, frameCount);
  const frameRate = cleanNumber(input.frameRate);
  const contentHash = await computeContentHash({ frameRate, frameCount, grid, field, features });
  const p = input.options.farneback;
  return {
    format: SIGNATURE_FORMAT,
    version: SIGNATURE_VERSION,
    contentHash,
    source: {
      ...input.source,
      nativeFps: cleanNumber(input.source.nativeFps),
      width: cleanNumber(input.source.width),
      height: cleanNumber(input.source.height),
      trim: {
        startSec: cleanNumber(input.source.trim.startSec),
        endSec: cleanNumber(input.source.trim.endSec),
      },
      focusArea: input.source.focusArea ? { ...input.source.focusArea } : null,
    },
    preferredSpeed: cleanNumber(input.preferredSpeed, 1),
    extraction: {
      method: 'farneback',
      params: {
        pyrScale: p.pyrScale,
        levels: p.levels,
        winsize: p.winsize,
        iterations: p.iterations,
        polyN: p.polyN,
        polySigma: p.polySigma,
      },
      analysisWidth: input.analysisWidth,
      noiseFloor: cleanNumber(input.noiseFloor),
      noiseFloorMode: input.options.noiseFloorMode,
      temporalSmoothingFrames: input.temporalSmoothingFrames,
    },
    frameRate,
    frameCount,
    grid: { cols: grid.cols, rows: grid.rows },
    field: { encoding: 'f32-base64', data: encodeField(field) },
    features,
    stats: computeStats(features),
  };
}
