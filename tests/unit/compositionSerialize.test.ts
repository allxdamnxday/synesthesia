import { describe, expect, it } from 'vitest';
import type { Composition } from '../../src/engine/composition';
import {
  COMPOSITION_MESSAGES,
  FileFormatError,
  migrateComposition,
  parseComposition,
  serializeComposition,
  validateComposition,
} from '../../src/engine/compositionSerialize';
import type { JsonObject } from '../../src/signature/serialize';

function makeComposition(overrides: Partial<Composition> = {}): Composition {
  return {
    format: 'sp-composition',
    version: 1,
    id: 'c0ffee00-0000-4000-8000-000000000001',
    name: 'Track 07',
    createdAt: '2026-09-28T10:00:00.000Z',
    updatedAt: '2026-09-28T11:00:00.000Z',
    signature: {
      id: '11111111-2222-4333-8444-555555555555',
      contentHash: 'a'.repeat(64),
      name: 'Wink 01',
    },
    seed: 424242,
    timeline: {
      speed: 0.75,
      loops: 2,
      loopMode: 'pingpong',
      tailSec: 3,
      smoothing: 0.2,
      signatureStrength: 1.25,
    },
    linked: true,
    visual: {
      materialId: 'water',
      materialVersion: 1,
      properties: { viscosity: 0.3, persistence: 0.8, palette: 2 },
    },
    sound: { materialId: 'water', materialVersion: 2, properties: { brightness: 0.6 } },
    mute: { visual: false, sound: true },
    chance: {
      albumId: 'album-1',
      index: 6,
      masterSeed: 123456,
      openProperties: ['viscosity', 'dispersion'],
      overrides: ['brightness'],
    },
    render: { width: 1920, height: 1080, fps: 30 },
    status: 'kept',
    notes: 'The honey hides the blink.\nTry less viscosity.',
    thumbnail: 'data:image/png;base64,iVBORw0KGgo=',
    ...overrides,
  };
}

function rawCopy(c: Composition): JsonObject {
  return JSON.parse(serializeComposition(c)) as JsonObject;
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

describe('composition files', () => {
  it('round-trip exactly', () => {
    const c = makeComposition();
    const text = serializeComposition(c);
    expect(parseComposition(text)).toEqual(c);
    expect(serializeComposition(parseComposition(text))).toBe(text);
  });

  it('round-trip without chance or thumbnail', () => {
    const c = makeComposition({ chance: null });
    delete c.thumbnail;
    const back = parseComposition(serializeComposition(c));
    expect(back).toEqual(c);
    expect('thumbnail' in back).toBe(false);
  });

  it('keep only the chance fields that are present', () => {
    const c = makeComposition({ chance: { openProperties: ['range'], overrides: [] } });
    const back = parseComposition(serializeComposition(c));
    expect(back.chance).toEqual({ openProperties: ['range'], overrides: [] });
  });

  it('write keys in format order', () => {
    const keys = Object.keys(rawCopy(makeComposition()));
    expect(keys.slice(0, 7)).toEqual([
      'format',
      'version',
      'id',
      'name',
      'createdAt',
      'updatedAt',
      'signature',
    ]);
    expect(keys.at(-1)).toBe('thumbnail');
  });

  it('refuse text that is not JSON', () => {
    expect(catchError(() => parseComposition('nope')).code).toBe('not-json');
  });

  it('refuse a signature file with a clear message', () => {
    const err = catchError(() => parseComposition('{"format":"sp-signature","version":1}'));
    expect(err.code).toBe('wrong-kind');
    expect(err.message).toBe(COMPOSITION_MESSAGES.isSignature);
    expect(catchError(() => parseComposition('"text"')).message).toBe(
      COMPOSITION_MESSAGES.notComposition,
    );
  });

  it('refuse files from a newer version of the app', () => {
    const raw = rawCopy(makeComposition());
    raw.version = 7;
    expect(catchError(() => parseComposition(JSON.stringify(raw))).code).toBe('newer-version');
  });

  const DAMAGE: [string, string, (raw: JsonObject) => void][] = [
    ['negative seed', 'seed', (r) => (r.seed = -1)],
    ['fractional seed', 'seed', (r) => (r.seed = 1.5)],
    ['zero loops', 'timeline.loops', (r) => ((r.timeline as JsonObject).loops = 0)],
    ['unknown loop mode', 'timeline.loopMode', (r) => ((r.timeline as JsonObject).loopMode = 'x')],
    ['smoothing above 1', 'timeline.smoothing', (r) => ((r.timeline as JsonObject).smoothing = 2)],
    ['unsupported fps', 'render.fps', (r) => ((r.render as JsonObject).fps = 24)],
    ['zero width', 'render.width', (r) => ((r.render as JsonObject).width = 0)],
    ['unknown status', 'status', (r) => (r.status = 'done')],
    [
      'text property value',
      'visual.properties.viscosity',
      (r) => (((r.visual as JsonObject).properties as JsonObject).viscosity = 'thick'),
    ],
    ['missing material', 'sound.materialId', (r) => delete (r.sound as JsonObject).materialId],
    ['missing mute flag', 'mute.visual', (r) => delete (r.mute as JsonObject).visual],
    [
      'bad signature hash',
      'signature.contentHash',
      (r) => ((r.signature as JsonObject).contentHash = 'xyz'),
    ],
    ['linked as text', 'linked', (r) => (r.linked = 'yes')],
    [
      'overrides not a list',
      'chance.overrides',
      (r) => ((r.chance as JsonObject).overrides = 'brightness'),
    ],
    ['svg thumbnail', 'thumbnail', (r) => (r.thumbnail = 'data:image/svg+xml;base64,PHN2Zz4=')],
    ['missing notes', 'notes', (r) => delete r.notes],
  ];

  for (const [label, path, mutate] of DAMAGE) {
    it(`refuse a damaged file: ${label}`, () => {
      const raw = rawCopy(makeComposition());
      mutate(raw);
      const err = catchError(() => parseComposition(JSON.stringify(raw)));
      expect(err.code).toBe('damaged');
      expect(err.message).toBe(COMPOSITION_MESSAGES.damaged);
      expect(err.detail).toContain(path);
    });
  }

  it('drop unknown keys and ignore prototype keys in properties', () => {
    const raw = rawCopy(makeComposition());
    raw.extra = 1;
    const text = JSON.stringify(raw).replace('"viscosity":0.3', '"__proto__":0.5,"viscosity":0.3');
    const back = parseComposition(text);
    expect('extra' in back).toBe(false);
    expect(Object.getPrototypeOf(back.visual.properties)).toBe(Object.prototype);
    expect(back.visual.properties.viscosity).toBe(0.3);
  });

  it('treat the current version as identity', () => {
    const raw = rawCopy(makeComposition());
    expect(migrateComposition(raw)).toBe(raw);
    expect(validateComposition(raw)).toEqual(makeComposition());
  });
});
