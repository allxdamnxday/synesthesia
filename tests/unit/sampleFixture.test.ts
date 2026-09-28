import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hashOfSignature } from '../../src/signature/hash';
import { createSampler } from '../../src/signature/sampler';
import {
  parseSignature,
  serializeSignature,
  verifySignatureHash,
} from '../../src/signature/serialize';
import { createSyntheticSignature } from '../../src/signature/synthetic';
import type { KineticSignature } from '../../src/signature/types';

// tests/fixtures/sample.sig.json is the synthetic wink, built by the real signature
// pipeline (src/signature/synthetic.ts → pipeline.ts) with a real content hash. The first
// test checks the committed file still matches what the pipeline makes; to rewrite it
// after a deliberate change to the pipeline, run:
//
//   UPDATE_FIXTURES=1 npx vitest run tests/unit/sampleFixture.test.ts
const FIXTURE_PATH = resolve(import.meta.dirname, '../fixtures/sample.sig.json');
/** Stable identity, relied on by the library tests. */
const SAMPLE_ID = '5a3c1e2f-8b7d-4c6a-9e0f-1d2b3c4a5e6f';

/** The sample signature: a 16 × 9 synthetic wink with a fixed identity and a real hash. */
async function buildSample(): Promise<KineticSignature> {
  const sig: KineticSignature = {
    ...createSyntheticSignature('wink', { cols: 16, rows: 9 }),
    id: SAMPLE_ID,
    name: 'Sample wink',
    createdAt: '2026-09-28T00:00:00.000Z',
  };
  return { ...sig, contentHash: await hashOfSignature(sig) };
}

/** Read the file at the time of use, so a rewrite in the first test is seen by the rest. */
const readFixture = (): string => readFileSync(FIXTURE_PATH, 'utf8');

describe('sample signature fixture', () => {
  it('matches what the real pipeline makes (UPDATE_FIXTURES=1 rewrites it)', async () => {
    const expected = serializeSignature(await buildSample());
    if (process.env.UPDATE_FIXTURES === '1') writeFileSync(FIXTURE_PATH, expected);
    expect(readFixture()).toBe(expected);
  });

  it('parses and its content hash matches', async () => {
    const sig = parseSignature(readFixture());
    expect(sig.id).toBe(SAMPLE_ID);
    expect(sig.name).toBe('Sample wink');
    expect(sig.frameCount).toBe(66);
    expect(sig.grid).toEqual({ cols: 16, rows: 9 });
    expect(await verifySignatureHash(sig)).toBe(true);
  });

  it('keeps its hash through the app’s own writer', async () => {
    const again = parseSignature(serializeSignature(parseSignature(readFixture())));
    expect(await verifySignatureHash(again)).toBe(true);
  });

  it('stays small', () => {
    expect(Buffer.byteLength(readFixture())).toBeLessThan(150 * 1024);
  });

  it('plays as a wink: down while closing, up while opening', () => {
    const s = createSampler(parseSignature(readFixture()), { smoothing: 0 });
    expect(s.sample(0.75).features.flowY).toBeGreaterThan(0);
    expect(s.sample(1.3).features.flowY).toBeLessThan(0);
    expect(s.sample(0.1).features.energy).toBeLessThan(s.sample(0.75).features.energy);
    const onsets = s.onsetsBetween(0, s.duration);
    expect(onsets.length).toBeGreaterThanOrEqual(2);
    expect(onsets[0]).toBeGreaterThan(0.6);
    expect(onsets[0]).toBeLessThan(0.9);
  });
});
