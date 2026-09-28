import { describe, expect, it } from 'vitest';
import { encodeField } from '../../src/signature/fieldCodec';
import {
  FileFormatError,
  SIGNATURE_MESSAGES,
  formatJson,
  migrateSignature,
  parseSignature,
  runMigrations,
  serializeSignature,
  validateSignature,
  verifySignatureHash,
  type JsonObject,
} from '../../src/signature/serialize';
import { FEATURE_NAMES, type KineticSignature } from '../../src/signature/types';
import { makeSignature, withHash } from './helpers/signatureFactory';

async function sampleSignature(): Promise<KineticSignature> {
  return withHash(
    makeSignature({
      frameRate: 30,
      frameCount: 12,
      cols: 4,
      rows: 3,
      field: (f, r, c) => [Math.sin(f + c) * 0.3, Math.cos(f - r) * 0.2],
      features: {
        energy: (f) => 0.1 + f / 7,
        flowX: (f) => Math.sin(f) / 3,
        // atan2(−0, 1) is −0: extraction can produce it, and it must survive a file.
        direction: (f) => (f === 0 ? -0 : Math.atan2(-Math.sin(f), Math.cos(f))),
        centroidX: (f) => 0.5 + f / 100,
      },
      onsets: [2, 7],
    }),
  );
}

/** A deep, mutable copy of a signature as plain JSON data. */
function rawCopy(sig: KineticSignature): JsonObject {
  return JSON.parse(serializeSignature(sig)) as JsonObject;
}

function catchError(fn: () => unknown): FileFormatError {
  try {
    fn();
  } catch (err) {
    if (err instanceof FileFormatError) return err;
    throw err;
  }
  throw new Error('expected a FileFormatError');
}

describe('signature files', () => {
  it('round-trip exactly and keep the content hash', async () => {
    const sig = await sampleSignature();
    const text = serializeSignature(sig);
    const back = parseSignature(text);
    expect(back).toEqual(sig);
    expect(Object.is(back.features.direction[0], -0)).toBe(true);
    expect(await verifySignatureHash(back)).toBe(true);
    expect(serializeSignature(back)).toBe(text);
  });

  it('write keys in format order, with number lists on one line', async () => {
    const text = serializeSignature(await sampleSignature());
    const keys = Object.keys(JSON.parse(text) as JsonObject);
    expect(keys).toEqual([
      'format',
      'version',
      'id',
      'name',
      'createdAt',
      'contentHash',
      'source',
      'preferredSpeed',
      'extraction',
      'frameRate',
      'frameCount',
      'grid',
      'field',
      'features',
      'stats',
    ]);
    expect(text).toMatch(/\n {4}"onsets": \[2,7\]\n/);
    expect(text.endsWith('}\n')).toBe(true);
  });

  it('drop unknown keys when reading', async () => {
    const raw = rawCopy(await sampleSignature());
    raw.extra = 'surprise';
    (raw.source as JsonObject).camera = 'phone';
    const back = validateSignature(migrateSignature(raw));
    expect('extra' in back).toBe(false);
    expect('camera' in back.source).toBe(false);
  });

  it('accept a missing focus area as none', async () => {
    const raw = rawCopy(await sampleSignature());
    delete (raw.source as JsonObject).focusArea;
    expect(validateSignature(raw).source.focusArea).toBeNull();
  });

  it('refuse text that is not JSON', () => {
    const err = catchError(() => parseSignature('{"format": "sp-signature", '));
    expect(err.code).toBe('not-json');
    expect(err.message).toMatch(/can't be read/);
  });

  it('refuse other kinds of files with a clear message', () => {
    expect(catchError(() => parseSignature('[1, 2]')).message).toBe(
      SIGNATURE_MESSAGES.notSignature,
    );
    expect(catchError(() => parseSignature('{"format": "something"}')).code).toBe('wrong-kind');
    const comp = catchError(() => parseSignature('{"format": "sp-composition", "version": 1}'));
    expect(comp.code).toBe('wrong-kind');
    expect(comp.message).toBe(SIGNATURE_MESSAGES.isComposition);
  });

  it('refuse files from a newer version of the app', async () => {
    const raw = rawCopy(await sampleSignature());
    raw.version = 2;
    const err = catchError(() => parseSignature(JSON.stringify(raw)));
    expect(err.code).toBe('newer-version');
    expect(err.message).toBe(SIGNATURE_MESSAGES.newer);
  });

  const DAMAGE: [string, string, (raw: JsonObject) => void][] = [
    ['missing id', 'id', (r) => delete r.id],
    ['empty id', 'id', (r) => (r.id = '  ')],
    ['text version', 'version', (r) => (r.version = '1')],
    ['bad hash', 'contentHash', (r) => (r.contentHash = 'abc')],
    ['odd rotation', 'source.rotate', (r) => ((r.source as JsonObject).rotate = 45)],
    ['mirror as text', 'source.mirror', (r) => ((r.source as JsonObject).mirror = 'no')],
    [
      'trim ends before it starts',
      'source.trim.endSec',
      (r) => (((r.source as JsonObject).trim as JsonObject).endSec = -1),
    ],
    [
      'focus area outside the frame',
      'source.focusArea',
      (r) => ((r.source as JsonObject).focusArea = { x: 0.5, y: 0, w: 0.8, h: 1 }),
    ],
    ['fractional frame count', 'frameCount', (r) => (r.frameCount = 1.5)],
    ['no frames', 'frameCount', (r) => (r.frameCount = 0)],
    ['negative frame rate', 'frameRate', (r) => (r.frameRate = -30)],
    ['empty grid', 'grid.cols', (r) => ((r.grid as JsonObject).cols = 0)],
    ['frame count disagrees with field', 'field.data', (r) => (r.frameCount = 13)],
    [
      'truncated field',
      'field.data',
      (r) => {
        const field = r.field as JsonObject;
        field.data = (field.data as string).slice(0, -8);
      },
    ],
    [
      'field is not base64',
      'field.data',
      (r) => {
        const field = r.field as JsonObject;
        field.data = `!!!!${(field.data as string).slice(4)}`;
      },
    ],
    ['unknown encoding', 'field.encoding', (r) => ((r.field as JsonObject).encoding = 'f16')],
    [
      'short feature list',
      'features.energy',
      (r) => ((r.features as JsonObject).energy as number[]).pop(),
    ],
    [
      'text in a feature list',
      'features.flowX[2]',
      (r) => (((r.features as JsonObject).flowX as unknown[])[2] = 'x'),
    ],
    ['onset past the end', 'features.onsets[0]', (r) => ((r.features as JsonObject).onsets = [99])],
    ['fractional onset', 'features.onsets[0]', (r) => ((r.features as JsonObject).onsets = [1.5])],
    ['missing stats', 'stats.curl', (r) => delete (r.stats as JsonObject).curl],
    ['missing features', 'features', (r) => delete r.features],
  ];

  for (const [label, path, mutate] of DAMAGE) {
    it(`refuse a damaged file: ${label}`, async () => {
      const raw = rawCopy(await sampleSignature());
      mutate(raw);
      const err = catchError(() => parseSignature(JSON.stringify(raw)));
      expect(err.code).toBe('damaged');
      expect(err.message).toBe(SIGNATURE_MESSAGES.damaged);
      expect(err.detail).toContain(path);
    });
  }

  it('refuse infinite numbers written as huge literals', async () => {
    const text = serializeSignature(await sampleSignature()).replace(
      '"preferredSpeed": 1',
      '"preferredSpeed": 1e999',
    );
    const err = catchError(() => parseSignature(text));
    expect(err.code).toBe('damaged');
    expect(err.detail).toContain('preferredSpeed');
  });

  it('refuse a field containing NaN', async () => {
    const sig = await sampleSignature();
    const values = new Float32Array(12 * 3 * 4 * 2);
    values[5] = Number.NaN;
    const err = catchError(() =>
      validateSignature({ ...sig, field: { encoding: 'f32-base64', data: encodeField(values) } }),
    );
    expect(err.detail).toContain('field.data');
  });

  it('notice when movement data was changed after hashing', async () => {
    const sig = await sampleSignature();
    const raw = rawCopy(sig);
    ((raw.features as JsonObject).energy as number[])[3] = 0.5;
    const tampered = parseSignature(JSON.stringify(raw));
    expect(await verifySignatureHash(tampered)).toBe(false);
    expect(await verifySignatureHash({ ...sig, name: 'Renamed' })).toBe(true);
  });

  it('never write a number that cannot be read back', async () => {
    const sig = await sampleSignature();
    sig.features.energy[0] = Number.NaN;
    expect(() => serializeSignature(sig)).toThrow();
  });
});

describe('migrations', () => {
  it('treat the current version as identity', async () => {
    const raw = rawCopy(await sampleSignature());
    expect(migrateSignature(raw)).toBe(raw);
  });

  it('apply one step per version, in order', () => {
    const steps = {
      1: (r: JsonObject) => ({ ...r, trail: [...(r.trail as string[]), 'one'] }),
      2: (r: JsonObject) => ({ ...r, trail: [...(r.trail as string[]), 'two'] }),
    };
    const messages = { newer: 'newer', damaged: 'damaged' };
    const out = runMigrations({ version: 1, trail: [] }, 3, steps, messages);
    expect(out).toEqual({ version: 3, trail: ['one', 'two'] });
    expect(runMigrations({ version: 2, trail: [] }, 3, steps, messages).trail).toEqual(['two']);
    expect(() => runMigrations({ version: 4 }, 3, steps, messages)).toThrow('newer');
    expect(() => runMigrations({ version: 0 }, 3, steps, messages)).toThrow('damaged');
    expect(() => runMigrations({}, 3, steps, messages)).toThrow('damaged');
  });
});

describe('formatJson', () => {
  it('keeps number lists on one line and preserves −0', () => {
    expect(formatJson({ a: [1, -0, 2.5], b: { c: 'x', d: undefined }, e: [], f: null })).toBe(
      '{\n  "a": [1,-0,2.5],\n  "b": {\n    "c": "x"\n  },\n  "e": [],\n  "f": null\n}\n',
    );
    expect(formatJson([{ x: true }, 'y'])).toBe('[\n  {\n    "x": true\n  },\n  "y"\n]\n');
  });

  it('escapes text safely', () => {
    const text = formatJson({ name: 'Quote " and \\ and \n newline' });
    expect((JSON.parse(text) as JsonObject).name).toBe('Quote " and \\ and \n newline');
  });

  it('covers every feature in a signature file', async () => {
    const parsed = JSON.parse(serializeSignature(await sampleSignature())) as JsonObject;
    const features = parsed.features as JsonObject;
    expect(Object.keys(features)).toEqual([...FEATURE_NAMES, 'onsets']);
    expect(Object.keys(parsed.stats as JsonObject)).toEqual([...FEATURE_NAMES]);
  });
});
