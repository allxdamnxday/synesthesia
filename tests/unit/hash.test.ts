import { describe, expect, it } from 'vitest';
import { encodeField } from '../../src/signature/fieldCodec';
import { computeContentHash, hashOfSignature } from '../../src/signature/hash';
import {
  FEATURE_NAMES,
  type KineticSignature,
  type SignatureFeatures,
} from '../../src/signature/types';

function tinySignature(): KineticSignature {
  const frameCount = 4;
  const grid = { cols: 3, rows: 2 };
  const field = new Float32Array(frameCount * grid.cols * grid.rows * 2).map((_, i) =>
    Math.fround(Math.sin(i * 0.37) * 0.8),
  );
  const features = { onsets: [1] } as SignatureFeatures;
  for (const name of FEATURE_NAMES) features[name] = [0.1, 0.25, 1 / 3, -0.5];
  return {
    format: 'sp-signature',
    version: 1,
    id: 'test',
    name: 'Tiny',
    createdAt: '2026-09-28T00:00:00.000Z',
    contentHash: '',
    source: {
      fileName: 'tiny.mp4',
      nativeFps: 30,
      width: 320,
      height: 180,
      trim: { startSec: 0, endSec: 1 },
      rotate: 0,
      mirror: false,
      focusArea: null,
    },
    preferredSpeed: 1,
    extraction: {
      method: 'farneback',
      params: { pyrScale: 0.5, levels: 3, winsize: 15, iterations: 3, polyN: 5, polySigma: 1.2 },
      analysisWidth: 320,
      noiseFloor: 0.01,
      noiseFloorMode: 'auto',
      temporalSmoothingFrames: 3,
    },
    frameRate: 30,
    frameCount,
    grid,
    field: { encoding: 'f32-base64', data: encodeField(field) },
    features,
    stats: {},
  };
}

describe('content hash', () => {
  it('is a 64-char hex SHA-256 and survives a JSON round trip', async () => {
    const sig = tinySignature();
    sig.contentHash = await hashOfSignature(sig);
    expect(sig.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const reimported = JSON.parse(JSON.stringify(sig)) as KineticSignature;
    expect(await hashOfSignature(reimported)).toBe(sig.contentHash);
  });

  it('ignores names and metadata but not movement data', async () => {
    const a = tinySignature();
    const b = { ...tinySignature(), name: 'Other', id: 'x', createdAt: '2020-01-01T00:00:00Z' };
    expect(await hashOfSignature(a)).toBe(await hashOfSignature(b));
    const c = tinySignature();
    c.features.energy[2] = 0.3334;
    expect(await hashOfSignature(c)).not.toBe(await hashOfSignature(a));
  });

  it('rejects mismatched lengths', async () => {
    const sig = tinySignature();
    await expect(
      computeContentHash({
        frameRate: 30,
        frameCount: 5,
        grid: sig.grid,
        field: new Float32Array(10),
        features: sig.features,
      }),
    ).rejects.toThrow();
  });
});

describe('negative zero', () => {
  it('hashes −0 and +0 identically, so JSON round trips keep the hash', async () => {
    const a = tinySignature();
    a.features.energy[0] = -0;
    const b = tinySignature();
    b.features.energy[0] = 0;
    expect(await hashOfSignature(a)).toBe(await hashOfSignature(b));
    const reimported = JSON.parse(JSON.stringify(a)) as KineticSignature;
    expect(await hashOfSignature(reimported)).toBe(await hashOfSignature(a));
  });
});
