/**
 * Builds small, fully specified KineticSignatures for unit tests. Features default to 0
 * (continuity to 1) unless a generator is given; stats are computed from the features
 * the same way extraction does (min, max, mean, p05, p95).
 */
import { mean, percentile } from '../../../src/lib/math';
import { encodeField } from '../../../src/signature/fieldCodec';
import { hashOfSignature } from '../../../src/signature/hash';
import {
  DEFAULT_FARNEBACK,
  FEATURE_NAMES,
  type FeatureName,
  type FeatureStats,
  type KineticSignature,
  type SignatureFeatures,
} from '../../../src/signature/types';

export interface SignatureSpec {
  frameRate?: number;
  frameCount: number;
  cols?: number;
  rows?: number;
  /** (u, v) at frame f, row r, column c. Defaults to zero. */
  field?: (f: number, r: number, c: number) => [number, number];
  features?: Partial<Record<FeatureName, (f: number) => number>>;
  onsets?: number[];
  name?: string;
  id?: string;
}

export function statsOf(values: readonly number[]): FeatureStats {
  return {
    min: values.length ? Math.min(...values) : 0,
    max: values.length ? Math.max(...values) : 0,
    mean: mean(values),
    p05: percentile(values, 5),
    p95: percentile(values, 95),
  };
}

export function makeSignature(spec: SignatureSpec): KineticSignature {
  const frameRate = spec.frameRate ?? 30;
  const cols = spec.cols ?? 2;
  const rows = spec.rows ?? 1;
  const n = spec.frameCount;
  const field = new Float32Array(n * rows * cols * 2);
  if (spec.field) {
    for (let f = 0; f < n; f++) {
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const [u, v] = spec.field(f, r, c);
          const i = ((f * rows + r) * cols + c) * 2;
          field[i] = u;
          field[i + 1] = v;
        }
      }
    }
  }
  const features = { onsets: spec.onsets ?? [] } as SignatureFeatures;
  const stats: Record<string, FeatureStats> = {};
  for (const name of FEATURE_NAMES) {
    const gen = spec.features?.[name];
    const fallback = name === 'continuity' ? 1 : 0;
    features[name] = Array.from({ length: n }, (_, f) => (gen ? gen(f) : fallback));
    stats[name] = statsOf(features[name]);
  }
  return {
    format: 'sp-signature',
    version: 1,
    id: spec.id ?? '11111111-2222-4333-8444-555555555555',
    name: spec.name ?? 'Test signature',
    createdAt: '2026-09-28T12:00:00.000Z',
    contentHash: '',
    source: {
      fileName: 'test.mp4',
      nativeFps: frameRate,
      width: 1280,
      height: 720,
      trim: { startSec: 0, endSec: n / frameRate },
      rotate: 0,
      mirror: false,
      focusArea: null,
    },
    preferredSpeed: 1,
    extraction: {
      method: 'farneback',
      params: { ...DEFAULT_FARNEBACK },
      analysisWidth: 320,
      noiseFloor: 0.01,
      noiseFloorMode: 'auto',
      temporalSmoothingFrames: 3,
    },
    frameRate,
    frameCount: n,
    grid: { cols, rows },
    field: { encoding: 'f32-base64', data: encodeField(field) },
    features,
    stats,
  };
}

/** The same signature with its contentHash filled in. */
export async function withHash(sig: KineticSignature): Promise<KineticSignature> {
  return { ...sig, contentHash: await hashOfSignature(sig) };
}
