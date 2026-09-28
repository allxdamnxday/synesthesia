import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hashOfSignature } from '../../src/signature/hash';
import { parseSignature } from '../../src/signature/serialize';

const root = resolve(import.meta.dirname, '../..');

describe('bundled sample signature', () => {
  it('is the same file as the test fixture and its hash verifies', async () => {
    const bundled = readFileSync(resolve(root, 'public/samples/sample-wink.sig.json'), 'utf8');
    const fixture = readFileSync(resolve(root, 'tests/fixtures/sample.sig.json'), 'utf8');
    expect(bundled).toBe(fixture);
    const sig = parseSignature(bundled);
    expect(await hashOfSignature(sig)).toBe(sig.contentHash);
  });
});
