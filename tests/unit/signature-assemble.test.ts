import { describe, expect, it } from 'vitest';
import { cleanFeatures, cleanFloat32 } from '../../src/signature/assemble';
import { decodeField } from '../../src/signature/fieldCodec';
import { hashOfSignature } from '../../src/signature/hash';
import { finishSignature, type FinishInput } from '../../src/signature/pipeline';
import {
  DEFAULT_EXTRACTION_OPTIONS,
  FEATURE_NAMES,
  MIN_NOISE_FLOOR,
  type KineticSignature,
  type SignatureFeatures,
} from '../../src/signature/types';
import { fieldOf, rightward, still } from './signatureFields';

function input(field: Float32Array, frameCount: number, cols = 8, rows = 6): FinishInput {
  return {
    raw: { field, frameCount, cols, rows, fps: 30 },
    options: DEFAULT_EXTRACTION_OPTIONS,
    analysisWidth: 320,
    source: {
      fileName: 'synthetic.mp4',
      nativeFps: 30,
      width: 320,
      height: 240,
      trim: { startSec: 0, endSec: frameCount / 30 },
      rotate: 0,
      mirror: false,
      focusArea: null,
    },
    preferredSpeed: 1,
  };
}

/** Frames 0–9 still, 10–29 moving right at 0.4, 30–39 still. */
function startStopField(): Float32Array {
  return fieldOf(8, 6, 40, (f) =>
    f >= 10 && f < 30 ? (x, y) => [0.4 * (1 + 0.1 * Math.sin(10 * x + 7 * y)), 0] : still,
  );
}

describe('cleaning values for the file', () => {
  it('stores float32 values, never −0, NaN or Infinity', () => {
    expect(Object.is(cleanFloat32(-0), 0)).toBe(true);
    expect(cleanFloat32(NaN)).toBe(0);
    expect(cleanFloat32(Infinity)).toBe(3.4028234663852886e38);
    expect(cleanFloat32(-1e300)).toBe(-3.4028234663852886e38);
    expect(cleanFloat32(0.1)).toBe(Math.fround(0.1));
    expect(Object.is(cleanFloat32(-1e-50), 0)).toBe(true); // underflows to −0
  });

  it('keeps onsets as sorted, unique, in-range frame indices', () => {
    const features = { onsets: [5, 2, 2, 99, -1, 1.5] } as SignatureFeatures;
    for (const name of FEATURE_NAMES) features[name] = [0, -0, NaN, 1, 2, 3];
    const clean = cleanFeatures(features, 6);
    expect(clean.onsets).toEqual([2, 5]);
    expect(clean.energy.every((x) => Number.isFinite(x) && !Object.is(x, -0))).toBe(true);
  });
});

describe('finishing a signature from a raw field', () => {
  it('builds a complete body whose field and features are consistent', async () => {
    const body = await finishSignature(input(startStopField(), 40));
    expect(body.format).toBe('sp-signature');
    expect(body.version).toBe(1);
    expect(body.frameCount).toBe(40);
    expect(body.frameRate).toBe(30);
    expect(body.grid).toEqual({ cols: 8, rows: 6 });
    expect(body.extraction.method).toBe('farneback');
    expect(body.extraction.temporalSmoothingFrames).toBe(3);
    expect(body.extraction.noiseFloorMode).toBe('auto');
    expect(body.extraction.noiseFloor).toBe(MIN_NOISE_FLOOR); // quiet frames are perfectly still
    expect(body.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const field = decodeField(body.field.data);
    expect(field.length).toBe(40 * 8 * 6 * 2);
    for (const name of FEATURE_NAMES) {
      expect(body.features[name]).toHaveLength(40);
      expect(body.stats[name]).toBeDefined();
    }
    // Moving right in the middle, still at both ends.
    expect(body.features.energy[20]).toBeGreaterThan(0.3);
    expect(body.features.energy[0]).toBe(0);
    expect(body.features.direction[20]).toBeCloseTo(0, 5);
    expect(body.features.coherence[20]).toBeGreaterThan(0.99);
    // An onset where the movement starts (smoothing starts the rise one frame early).
    expect(body.features.onsets.length).toBeGreaterThan(0);
    expect(body.features.onsets[0]).toBeGreaterThanOrEqual(8);
    expect(body.features.onsets[0]).toBeLessThanOrEqual(11);
  });

  it('never writes NaN, Infinity or −0 into features or stats', async () => {
    const field = startStopField();
    field[100] = NaN;
    field[101] = Infinity;
    const body = await finishSignature(input(field, 40));
    expect(JSON.stringify(body.features)).not.toContain('null');
    expect(JSON.stringify(body.stats)).not.toContain('null');
    expect(Array.from(decodeField(body.field.data)).every(Number.isFinite)).toBe(true);
    for (const name of FEATURE_NAMES) {
      for (const v of body.features[name]) {
        expect(Number.isFinite(v)).toBe(true);
        expect(Object.is(v, -0)).toBe(false);
      }
    }
  });

  it('is deterministic, and survives export and re-import with the same hash', async () => {
    const a = await finishSignature(input(startStopField(), 40));
    const b = await finishSignature(input(startStopField(), 40));
    expect(b.contentHash).toBe(a.contentHash);
    const file: KineticSignature = {
      ...a,
      id: 'x',
      name: 'Start and stop',
      createdAt: '2026-09-28T00:00:00.000Z',
    };
    const reimported = JSON.parse(JSON.stringify(file)) as KineticSignature;
    expect(await hashOfSignature(reimported)).toBe(a.contentHash);
  });

  it('a still field gives zero energy and density, and a moving field does not', async () => {
    const quiet = await finishSignature(
      input(
        fieldOf(8, 6, 20, () => still),
        20,
      ),
    );
    expect(quiet.features.energy.every((e) => e === 0)).toBe(true);
    expect(quiet.features.density.every((d) => d === 0)).toBe(true);
    expect(quiet.features.onsets).toEqual([]);
    const moving = await finishSignature(input(startStopField(), 40));
    expect(moving.features.density.slice(12, 28).every((d) => d === 1)).toBe(true);
  });

  it('auto floor: movement present in every frame and cell is treated as noise', async () => {
    // SPEC 8.1: the floor comes from the quietest frames. If the whole frame moves all the
    // time (like a handheld pan), the floor rises to 1.5× that movement.
    const body = await finishSignature(
      input(
        fieldOf(8, 6, 20, () => rightward),
        20,
      ),
    );
    expect(body.extraction.noiseFloor).toBeCloseTo(1.5, 5);
    expect(body.features.density.every((d) => d === 0)).toBe(true);
  });

  it('uses a manual floor when asked', async () => {
    const i = input(startStopField(), 40);
    i.options = { ...i.options, noiseFloorMode: 'manual', manualNoiseFloor: 0.5 };
    const body = await finishSignature(i);
    expect(body.extraction.noiseFloor).toBe(0.5);
    expect(body.extraction.noiseFloorMode).toBe('manual');
    // 0.4 < 0.5: everything is below the floor, so nothing moves.
    expect(body.features.energy.every((e) => e === 0)).toBe(true);
  });

  it('rejects a field that does not match its grid', async () => {
    await expect(finishSignature(input(new Float32Array(10), 2))).rejects.toThrow();
    await expect(finishSignature(input(new Float32Array(0), 0))).rejects.toThrow();
  });
});
