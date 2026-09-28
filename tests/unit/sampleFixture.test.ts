import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSampler } from '../../src/signature/sampler';
import {
  parseSignature,
  serializeSignature,
  verifySignatureHash,
} from '../../src/signature/serialize';

// tests/fixtures/sample.sig.json is written by scripts/make-sample-signature.mjs, which
// reimplements the file math in plain JavaScript. These checks use the app's own code.
const text = readFileSync(resolve(import.meta.dirname, '../fixtures/sample.sig.json'), 'utf8');

describe('sample signature fixture', () => {
  it('parses and its content hash matches', async () => {
    const sig = parseSignature(text);
    expect(sig.name).toBe('Sample wink');
    expect(sig.frameCount).toBe(66);
    expect(sig.grid).toEqual({ cols: 16, rows: 9 });
    expect(await verifySignatureHash(sig)).toBe(true);
  });

  it('keeps its hash through the app’s own writer', async () => {
    const again = parseSignature(serializeSignature(parseSignature(text)));
    expect(await verifySignatureHash(again)).toBe(true);
  });

  it('plays as a wink: down while closing, up while opening', () => {
    const s = createSampler(parseSignature(text), { smoothing: 0 });
    expect(s.sample(0.75).features.flowY).toBeGreaterThan(0);
    expect(s.sample(1.3).features.flowY).toBeLessThan(0);
    expect(s.sample(0.1).features.energy).toBeLessThan(s.sample(0.75).features.energy);
    const onsets = s.onsetsBetween(0, s.duration);
    expect(onsets.length).toBeGreaterThanOrEqual(2);
    expect(onsets[0]).toBeGreaterThan(0.6);
    expect(onsets[0]).toBeLessThan(0.9);
  });
});
