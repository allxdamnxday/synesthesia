/**
 * Reading and writing composition files (`.spcomp.json`, SPEC 11.2 and 11.3).
 *
 * Same approach as signature files (src/signature/serialize.ts): readable JSON with keys
 * in format order, a migrations registry (`COMPOSITION_MIGRATIONS[n]` upgrades version n
 * to n + 1; version 1 is the first format, so nothing is registered yet), and thorough
 * validation that throws a `FileFormatError` with a plain-language message.
 *
 * A composition references its signature by id and content hash; it never contains the
 * signature itself. Validation checks shape and ranges only; whether the referenced
 * materials exist is for the Studio to decide (it shows a gentle notice).
 */
import {
  FileFormatError,
  failWith,
  formatJson,
  isJsonObject,
  parseJson,
  readBoolean,
  readChoice,
  readNumber,
  readObject,
  readString,
  readStringArray,
  runMigrations,
  type Fail,
  type JsonObject,
  type Migration,
} from '../signature/serialize';
import type { PropertyValues } from '../materials/types';
import {
  COMPOSITION_FORMAT,
  COMPOSITION_VERSION,
  type ChanceRecord,
  type Composition,
  type MaterialSettings,
} from './composition';

export { FileFormatError } from '../signature/serialize';

export const COMPOSITION_FILE_EXTENSION = '.spcomp.json';

export const COMPOSITION_MESSAGES = {
  notComposition: "This file isn't a Synesthesia composition.",
  isSignature: 'This is a signature file, not a composition.',
  newer:
    'This composition was made with a newer version of Synesthesia. Update the app, then try again.',
  damaged: "This composition file is damaged, so it can't be opened.",
} as const;

/**
 * Upgrades from older composition file versions, keyed by the version they upgrade
 * from. To change the format: bump COMPOSITION_VERSION (and the `version` type) in
 * composition.ts, register `n: (raw) => …`, and add a test that loads a real old file.
 */
export const COMPOSITION_MIGRATIONS: Readonly<Record<number, Migration>> = {};

/** Upgrade a raw parsed object to the current composition version (unvalidated). */
export function migrateComposition(raw: unknown): JsonObject {
  if (!isJsonObject(raw)) {
    throw new FileFormatError('wrong-kind', COMPOSITION_MESSAGES.notComposition, 'not an object');
  }
  if (raw.format !== COMPOSITION_FORMAT) {
    const message =
      raw.format === 'sp-signature'
        ? COMPOSITION_MESSAGES.isSignature
        : COMPOSITION_MESSAGES.notComposition;
    throw new FileFormatError('wrong-kind', message, `format: ${String(raw.format)}`);
  }
  return runMigrations(raw, COMPOSITION_VERSION, COMPOSITION_MIGRATIONS, COMPOSITION_MESSAGES);
}

const HASH_PATTERN = /^[0-9a-f]{64}$/;
/** Thumbnails are small raster data URLs (never SVG, which could carry markup). */
const THUMBNAIL_PATTERN = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const MAX_SEED = 0xffffffff;
const MAX_RENDER_SIZE = 8192;

function readProperties(value: unknown, path: string, fail: Fail): PropertyValues {
  const o = readObject(value, path, fail);
  const props: PropertyValues = {};
  for (const key of Object.keys(o)) {
    if (key === '__proto__') continue;
    props[key] = readNumber(o, key, path, fail);
  }
  return props;
}

function readMaterial(value: unknown, path: string, fail: Fail): MaterialSettings {
  const o = readObject(value, path, fail);
  return {
    materialId: readString(o, 'materialId', path, fail, { nonEmpty: true, maxLength: 100 }),
    materialVersion: readNumber(o, 'materialVersion', path, fail, { integer: true, min: 0 }),
    properties: readProperties(o.properties, `${path}.properties`, fail),
  };
}

function readChance(value: unknown, fail: Fail): ChanceRecord | null {
  if (value === null || value === undefined) return null;
  const o = readObject(value, 'chance', fail);
  const chance: ChanceRecord = {
    openProperties: readStringArray(o, 'openProperties', 'chance', fail),
    overrides: readStringArray(o, 'overrides', 'chance', fail),
  };
  if (o.albumId !== undefined) {
    chance.albumId = readString(o, 'albumId', 'chance', fail, { maxLength: 200 });
  }
  if (o.index !== undefined) {
    chance.index = readNumber(o, 'index', 'chance', fail, { integer: true, min: 0 });
  }
  if (o.masterSeed !== undefined) {
    chance.masterSeed = readNumber(o, 'masterSeed', 'chance', fail, {
      integer: true,
      min: 0,
      max: MAX_SEED,
    });
  }
  return chance;
}

/**
 * Check a current-version composition object thoroughly and return a clean copy
 * (unknown keys are dropped). Throws FileFormatError.
 */
export function validateComposition(raw: unknown): Composition {
  const fail = failWith(COMPOSITION_MESSAGES.damaged);
  const o = readObject(raw, 'composition', fail);
  if (o.format !== COMPOSITION_FORMAT) {
    throw new FileFormatError(
      'wrong-kind',
      COMPOSITION_MESSAGES.notComposition,
      `format: ${String(o.format)}`,
    );
  }
  if (o.version !== COMPOSITION_VERSION) fail('version', `expected ${COMPOSITION_VERSION}`);

  const sigObj = readObject(o.signature, 'signature', fail);
  const tl = readObject(o.timeline, 'timeline', fail);
  const mute = readObject(o.mute, 'mute', fail);
  const render = readObject(o.render, 'render', fail);

  const composition: Composition = {
    format: COMPOSITION_FORMAT,
    version: COMPOSITION_VERSION,
    id: readString(o, 'id', '', fail, { nonEmpty: true, maxLength: 200 }),
    name: readString(o, 'name', '', fail, { maxLength: 500 }),
    createdAt: readString(o, 'createdAt', '', fail, { maxLength: 100 }),
    updatedAt: readString(o, 'updatedAt', '', fail, { maxLength: 100 }),
    signature: {
      id: readString(sigObj, 'id', 'signature', fail, { nonEmpty: true, maxLength: 200 }),
      contentHash: readString(sigObj, 'contentHash', 'signature', fail, { pattern: HASH_PATTERN }),
      name: readString(sigObj, 'name', 'signature', fail, { maxLength: 500 }),
    },
    seed: readNumber(o, 'seed', '', fail, { integer: true, min: 0, max: MAX_SEED }),
    timeline: {
      speed: readNumber(tl, 'speed', 'timeline', fail, { above: 0, max: 100 }),
      loops: readNumber(tl, 'loops', 'timeline', fail, { integer: true, min: 1, max: 1000 }),
      loopMode: readChoice(tl, 'loopMode', 'timeline', fail, ['loop', 'pingpong'] as const),
      tailSec: readNumber(tl, 'tailSec', 'timeline', fail, { min: 0, max: 3600 }),
      smoothing: readNumber(tl, 'smoothing', 'timeline', fail, { min: 0, max: 1 }),
      signatureStrength: readNumber(tl, 'signatureStrength', 'timeline', fail, {
        min: 0,
        max: 100,
      }),
    },
    linked: readBoolean(o, 'linked', '', fail),
    visual: readMaterial(o.visual, 'visual', fail),
    sound: readMaterial(o.sound, 'sound', fail),
    mute: {
      visual: readBoolean(mute, 'visual', 'mute', fail),
      sound: readBoolean(mute, 'sound', 'mute', fail),
    },
    chance: readChance(o.chance, fail),
    render: {
      width: readNumber(render, 'width', 'render', fail, {
        integer: true,
        min: 16,
        max: MAX_RENDER_SIZE,
      }),
      height: readNumber(render, 'height', 'render', fail, {
        integer: true,
        min: 16,
        max: MAX_RENDER_SIZE,
      }),
      fps: readChoice(render, 'fps', 'render', fail, [30, 60] as const),
    },
    status: readChoice(o, 'status', '', fail, ['draft', 'kept', 'set-aside'] as const),
    notes: readString(o, 'notes', '', fail, { maxLength: 200_000 }),
  };
  if (o.thumbnail !== undefined && o.thumbnail !== null) {
    composition.thumbnail = readString(o, 'thumbnail', '', fail, {
      maxLength: 2_000_000,
      pattern: THUMBNAIL_PATTERN,
    });
  }
  return composition;
}

/** Migrate and validate an already-parsed JSON value. */
export function compositionFromJson(raw: unknown): Composition {
  return validateComposition(migrateComposition(raw));
}

/** Read a `.spcomp.json` file's text. Throws FileFormatError with a plain-language message. */
export function parseComposition(text: string): Composition {
  return compositionFromJson(parseJson(text));
}

function orderedChance(chance: ChanceRecord | null): JsonObject | null {
  if (!chance) return null;
  return {
    albumId: chance.albumId,
    index: chance.index,
    masterSeed: chance.masterSeed,
    openProperties: [...chance.openProperties],
    overrides: [...chance.overrides],
  };
}

/** The file contents for a composition, keys in format order. */
export function serializeComposition(c: Composition): string {
  return formatJson({
    format: c.format,
    version: c.version,
    id: c.id,
    name: c.name,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    signature: {
      id: c.signature.id,
      contentHash: c.signature.contentHash,
      name: c.signature.name,
    },
    seed: c.seed,
    timeline: {
      speed: c.timeline.speed,
      loops: c.timeline.loops,
      loopMode: c.timeline.loopMode,
      tailSec: c.timeline.tailSec,
      smoothing: c.timeline.smoothing,
      signatureStrength: c.timeline.signatureStrength,
    },
    linked: c.linked,
    visual: {
      materialId: c.visual.materialId,
      materialVersion: c.visual.materialVersion,
      properties: { ...c.visual.properties },
    },
    sound: {
      materialId: c.sound.materialId,
      materialVersion: c.sound.materialVersion,
      properties: { ...c.sound.properties },
    },
    mute: { visual: c.mute.visual, sound: c.mute.sound },
    chance: orderedChance(c.chance),
    render: { width: c.render.width, height: c.render.height, fps: c.render.fps },
    status: c.status,
    notes: c.notes,
    thumbnail: c.thumbnail,
  });
}
