/**
 * Content hash of a signature (SPEC 8.1 step 12): SHA-256 over the movement data only
 * (never names, ids, dates or source metadata), so an exported and re-imported
 * signature always yields the same hash.
 *
 * Canonical bytes, all little-endian:
 *   frameRate f64 | frameCount u32 | cols u32 | rows u32
 *   field: frameCount × rows × cols × 2 × f32
 *   features: for each name in FEATURE_NAMES order, frameCount × f64
 *   onsets: count u32, then count × f64
 */
import { decodeField } from './fieldCodec';
import { FEATURE_NAMES, type KineticSignature, type SignatureFeatures } from './types';

export interface HashInput {
  frameRate: number;
  frameCount: number;
  grid: { cols: number; rows: number };
  field: Float32Array;
  features: SignatureFeatures;
}

export function signatureHashBytes(input: HashInput): Uint8Array<ArrayBuffer> {
  const n = input.frameCount;
  const expectedField = n * input.grid.rows * input.grid.cols * 2;
  if (input.field.length !== expectedField) {
    throw new Error(`Field has ${input.field.length} values, expected ${expectedField}`);
  }
  const size =
    8 +
    4 +
    4 +
    4 +
    input.field.length * 4 +
    FEATURE_NAMES.length * n * 8 +
    4 +
    input.features.onsets.length * 8;
  const buffer = new ArrayBuffer(size);
  const view = new DataView(buffer);
  let o = 0;
  view.setFloat64(o, input.frameRate, true);
  o += 8;
  view.setUint32(o, n, true);
  o += 4;
  view.setUint32(o, input.grid.cols, true);
  o += 4;
  view.setUint32(o, input.grid.rows, true);
  o += 4;
  for (let i = 0; i < input.field.length; i++) {
    view.setFloat32(o, input.field[i] ?? 0, true);
    o += 4;
  }
  for (const name of FEATURE_NAMES) {
    const values = input.features[name];
    if (values.length !== n) {
      throw new Error(`Feature "${name}" has ${values.length} values, expected ${n}`);
    }
    for (let i = 0; i < n; i++) {
      view.setFloat64(o, values[i] ?? 0, true);
      o += 8;
    }
  }
  view.setUint32(o, input.features.onsets.length, true);
  o += 4;
  for (const onset of input.features.onsets) {
    view.setFloat64(o, onset, true);
    o += 8;
  }
  return new Uint8Array(buffer);
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 hex of the canonical bytes. Works in windows, workers and Node 20+. */
export async function computeContentHash(input: HashInput): Promise<string> {
  const bytes = signatureHashBytes(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return toHex(digest);
}

/** Recompute a stored signature's hash (for import checks). */
export async function hashOfSignature(signature: KineticSignature): Promise<string> {
  return computeContentHash({
    frameRate: signature.frameRate,
    frameCount: signature.frameCount,
    grid: signature.grid,
    field: decodeField(signature.field.data),
    features: signature.features,
  });
}
