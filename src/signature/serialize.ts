/**
 * Reading and writing signature files (`.sig.json`, SPEC 8.3 and 11.3).
 *
 * - `serializeSignature` writes readable JSON (arrays of numbers stay on one line) with
 *   the keys in format order. Numbers round-trip exactly, including −0, so the content
 *   hash survives export and import.
 * - `parseSignature` reads a file: JSON → migration to the current version → thorough
 *   validation. Anything wrong throws a `FileFormatError` whose `message` is plain
 *   language for the artist and whose `detail` names the exact problem for Diagnostics.
 * - Migrations: `SIGNATURE_MIGRATIONS[n]` upgrades a version-n object to version n + 1.
 *   Version 1 is the first format, so nothing is registered yet; each future version
 *   bump adds one function (and a test with a real old file).
 *
 * The generic helpers here (JSON formatting, migration runner, field readers) are shared
 * with the composition format in src/engine/compositionSerialize.ts.
 */
import { decodeField } from './fieldCodec';
import { hashOfSignature } from './hash';
import {
  FEATURE_NAMES,
  SIGNATURE_FORMAT,
  SIGNATURE_VERSION,
  type FeatureStats,
  type FocusArea,
  type KineticSignature,
  type SignatureFeatures,
} from './types';

export const SIGNATURE_FILE_EXTENSION = '.sig.json';

// ---------------------------------------------------------------------------------------
// Errors

export type FileErrorCode = 'not-json' | 'wrong-kind' | 'newer-version' | 'damaged';

/** A file that can't be read. `message` is for the artist; `detail` is for Diagnostics. */
export class FileFormatError extends Error {
  readonly code: FileErrorCode;
  readonly detail: string | undefined;

  constructor(code: FileErrorCode, message: string, detail?: string) {
    super(message);
    this.name = 'FileFormatError';
    this.code = code;
    this.detail = detail;
  }
}

export const NOT_JSON_MESSAGE =
  "This file can't be read. It may be damaged, or it may not be a Synesthesia file.";

export const SIGNATURE_MESSAGES = {
  notSignature: "This file isn't a Synesthesia signature.",
  isComposition: 'This is a composition file, not a signature.',
  newer:
    'This signature was made with a newer version of Synesthesia. Update the app, then try again.',
  damaged: "This signature file is damaged, so it can't be opened.",
} as const;

// ---------------------------------------------------------------------------------------
// Generic JSON helpers (shared with the composition format)

export type JsonObject = Record<string, unknown>;
/** Upgrades an object of one format version to the next version. */
export type Migration = (raw: JsonObject) => JsonObject;

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** JSON.parse that throws a plain-language FileFormatError. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (err) {
    throw new FileFormatError('not-json', NOT_JSON_MESSAGE, String(err));
  }
}

/**
 * Bring a raw file object up to `current` by applying `migrations[v]` for each version
 * v below it. Throws for files from a newer app or without a usable version.
 */
export function runMigrations(
  raw: JsonObject,
  current: number,
  migrations: Readonly<Record<number, Migration>>,
  messages: { newer: string; damaged: string },
): JsonObject {
  const version = raw.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new FileFormatError('damaged', messages.damaged, `version: ${String(version)}`);
  }
  if (version > current) {
    throw new FileFormatError(
      'newer-version',
      messages.newer,
      `version ${version}, this app reads up to ${current}`,
    );
  }
  let result = raw;
  for (let v = version; v < current; v++) {
    const step = migrations[v];
    if (!step) throw new Error(`No migration registered from version ${v}`);
    result = { ...step(result), version: v + 1 };
  }
  return result;
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`Can't write the number ${n} to a file`);
  // JSON.stringify writes −0 as "0"; "-0" is valid JSON and parses back to −0.
  return Object.is(n, -0) ? '-0' : String(n);
}

function formatValue(value: unknown, indent: string): string {
  if (value === null) return 'null';
  if (typeof value === 'number') return formatNumber(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value !== 'object') throw new Error(`Can't write a ${typeof value} to a file`);
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    const items = value as unknown[];
    if (items.length === 0) return '[]';
    if (items.every((v) => typeof v === 'number')) {
      return `[${items.map(formatNumber).join(',')}]`;
    }
    return `[\n${items.map((v) => inner + formatValue(v, inner)).join(',\n')}\n${indent}]`;
  }
  const entries = Object.entries(value).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return '{}';
  const lines = entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${formatValue(v, inner)}`);
  return `{\n${lines.join(',\n')}\n${indent}}`;
}

/**
 * Readable JSON: objects indented by two spaces, arrays of numbers on one line.
 * Keys keep their insertion order; undefined properties are skipped. Numbers must be
 * finite (−0 is preserved).
 */
export function formatJson(value: unknown): string {
  return `${formatValue(value, '')}\n`;
}

// ---------------------------------------------------------------------------------------
// Field readers: each checks one value and reports its path on failure.

export type Fail = (path: string, problem: string) => never;

export function failWith(message: string): Fail {
  return (path, problem) => {
    throw new FileFormatError('damaged', message, `${path}: ${problem}`);
  };
}

function describe(value: unknown): string {
  if (value === undefined) return 'missing';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  if (typeof value === 'string') return `"${value.length > 40 ? `${value.slice(0, 40)}…` : value}"`;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return typeof value === 'object' ? 'an object' : typeof value;
}

export function readObject(value: unknown, path: string, fail: Fail): JsonObject {
  if (!isJsonObject(value)) fail(path, `expected an object, found ${describe(value)}`);
  return value;
}

export interface StringRules {
  nonEmpty?: boolean;
  maxLength?: number;
  pattern?: RegExp;
}

export function readString(
  obj: JsonObject,
  key: string,
  path: string,
  fail: Fail,
  rules: StringRules = {},
): string {
  const value = obj[key];
  const at = path ? `${path}.${key}` : key;
  if (typeof value !== 'string') return fail(at, `expected text, found ${describe(value)}`);
  if (rules.nonEmpty && value.trim() === '') fail(at, 'is empty');
  if (rules.maxLength !== undefined && value.length > rules.maxLength) {
    fail(at, `longer than ${rules.maxLength} characters`);
  }
  if (rules.pattern && !rules.pattern.test(value)) fail(at, `unexpected value ${describe(value)}`);
  return value;
}

export interface NumberRules {
  min?: number;
  max?: number;
  /** Strictly greater than. */
  above?: number;
  integer?: boolean;
}

function checkNumber(value: unknown, at: string, fail: Fail, rules: NumberRules): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fail(at, `expected a finite number, found ${describe(value)}`);
  }
  if (rules.integer && !Number.isInteger(value))
    fail(at, `expected a whole number, found ${value}`);
  if (rules.min !== undefined && value < rules.min) fail(at, `${value} is below ${rules.min}`);
  if (rules.max !== undefined && value > rules.max) fail(at, `${value} is above ${rules.max}`);
  if (rules.above !== undefined && !(value > rules.above)) {
    fail(at, `${value} must be above ${rules.above}`);
  }
  return value;
}

export function readNumber(
  obj: JsonObject,
  key: string,
  path: string,
  fail: Fail,
  rules: NumberRules = {},
): number {
  return checkNumber(obj[key], path ? `${path}.${key}` : key, fail, rules);
}

export function readBoolean(obj: JsonObject, key: string, path: string, fail: Fail): boolean {
  const value = obj[key];
  if (typeof value !== 'boolean') {
    return fail(path ? `${path}.${key}` : key, `expected true or false, found ${describe(value)}`);
  }
  return value;
}

export function readChoice<T extends string | number>(
  obj: JsonObject,
  key: string,
  path: string,
  fail: Fail,
  allowed: readonly T[],
): T {
  const value = obj[key];
  if (!(allowed as readonly unknown[]).includes(value)) {
    return fail(
      path ? `${path}.${key}` : key,
      `expected one of ${allowed.join(', ')}, found ${describe(value)}`,
    );
  }
  return value as T;
}

export function readNumberArray(
  obj: JsonObject,
  key: string,
  path: string,
  fail: Fail,
  rules: NumberRules & { length?: number } = {},
): number[] {
  const value = obj[key];
  const at = path ? `${path}.${key}` : key;
  if (!Array.isArray(value))
    return fail(at, `expected a list of numbers, found ${describe(value)}`);
  if (rules.length !== undefined && value.length !== rules.length) {
    fail(at, `expected ${rules.length} values, found ${value.length}`);
  }
  const out = new Array<number>(value.length);
  for (let i = 0; i < value.length; i++) out[i] = checkNumber(value[i], `${at}[${i}]`, fail, rules);
  return out;
}

export function readStringArray(obj: JsonObject, key: string, path: string, fail: Fail): string[] {
  const value = obj[key];
  const at = path ? `${path}.${key}` : key;
  if (!Array.isArray(value)) return fail(at, `expected a list of text, found ${describe(value)}`);
  return value.map((item, i) => {
    if (typeof item !== 'string')
      return fail(`${at}[${i}]`, `expected text, found ${describe(item)}`);
    return item;
  });
}

// ---------------------------------------------------------------------------------------
// Signature format

/**
 * Upgrades from older signature file versions, keyed by the version they upgrade from.
 * To change the format: bump SIGNATURE_VERSION (and the `version` type) in types.ts,
 * register `n: (raw) => …` turning a version-n object into version n + 1, and add a test
 * that loads a real version-n file.
 */
export const SIGNATURE_MIGRATIONS: Readonly<Record<number, Migration>> = {};

/** Upgrade a raw parsed object to the current signature version (unvalidated). */
export function migrateSignature(raw: unknown): JsonObject {
  if (!isJsonObject(raw)) {
    throw new FileFormatError('wrong-kind', SIGNATURE_MESSAGES.notSignature, 'not an object');
  }
  if (raw.format !== SIGNATURE_FORMAT) {
    const message =
      raw.format === 'sp-composition'
        ? SIGNATURE_MESSAGES.isComposition
        : SIGNATURE_MESSAGES.notSignature;
    throw new FileFormatError('wrong-kind', message, `format: ${describe(raw.format)}`);
  }
  return runMigrations(raw, SIGNATURE_VERSION, SIGNATURE_MIGRATIONS, SIGNATURE_MESSAGES);
}

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const MAX_GRID = 1024;

function readFocusArea(value: unknown, fail: Fail): FocusArea | null {
  if (value === null || value === undefined) return null;
  const o = readObject(value, 'source.focusArea', fail);
  const path = 'source.focusArea';
  const x = readNumber(o, 'x', path, fail, { min: 0, max: 1 });
  const y = readNumber(o, 'y', path, fail, { min: 0, max: 1 });
  const w = readNumber(o, 'w', path, fail, { above: 0, max: 1 });
  const h = readNumber(o, 'h', path, fail, { above: 0, max: 1 });
  if (x + w > 1 + 1e-6 || y + h > 1 + 1e-6) fail(path, 'extends beyond the frame');
  return { x, y, w, h };
}

function readStats(value: unknown, fail: Fail): Record<string, FeatureStats> {
  const o = readObject(value, 'stats', fail);
  const stats: Record<string, FeatureStats> = {};
  for (const name of FEATURE_NAMES) {
    const s = readObject(o[name], `stats.${name}`, fail);
    const path = `stats.${name}`;
    stats[name] = {
      min: readNumber(s, 'min', path, fail),
      max: readNumber(s, 'max', path, fail),
      mean: readNumber(s, 'mean', path, fail),
      p05: readNumber(s, 'p05', path, fail),
      p95: readNumber(s, 'p95', path, fail),
    };
  }
  return stats;
}

/** Base64 length of `bytes` bytes (with padding). */
function base64Length(bytes: number): number {
  return 4 * Math.ceil(bytes / 3);
}

/**
 * Check a current-version signature object thoroughly and return a clean copy
 * (unknown keys are dropped). Throws FileFormatError.
 */
export function validateSignature(raw: unknown): KineticSignature {
  const fail = failWith(SIGNATURE_MESSAGES.damaged);
  const o = readObject(raw, 'signature', fail);
  if (o.format !== SIGNATURE_FORMAT) {
    throw new FileFormatError(
      'wrong-kind',
      SIGNATURE_MESSAGES.notSignature,
      `format: ${describe(o.format)}`,
    );
  }
  if (o.version !== SIGNATURE_VERSION) fail('version', `expected ${SIGNATURE_VERSION}`);

  const id = readString(o, 'id', '', fail, { nonEmpty: true, maxLength: 200 });
  const name = readString(o, 'name', '', fail, { maxLength: 500 });
  const createdAt = readString(o, 'createdAt', '', fail, { maxLength: 100 });
  const contentHash = readString(o, 'contentHash', '', fail, { pattern: HASH_PATTERN });

  const src = readObject(o.source, 'source', fail);
  const trimObj = readObject(src.trim, 'source.trim', fail);
  const startSec = readNumber(trimObj, 'startSec', 'source.trim', fail, { min: 0 });
  const source: KineticSignature['source'] = {
    fileName: readString(src, 'fileName', 'source', fail, { maxLength: 1000 }),
    nativeFps: readNumber(src, 'nativeFps', 'source', fail, { above: 0 }),
    width: readNumber(src, 'width', 'source', fail, { above: 0 }),
    height: readNumber(src, 'height', 'source', fail, { above: 0 }),
    trim: {
      startSec,
      endSec: readNumber(trimObj, 'endSec', 'source.trim', fail, { min: startSec }),
    },
    rotate: readChoice(src, 'rotate', 'source', fail, [0, 90, 180, 270] as const),
    mirror: readBoolean(src, 'mirror', 'source', fail),
    focusArea: readFocusArea(src.focusArea, fail),
  };

  const preferredSpeed = readNumber(o, 'preferredSpeed', '', fail, { above: 0, max: 100 });

  const ex = readObject(o.extraction, 'extraction', fail);
  const params = readObject(ex.params, 'extraction.params', fail);
  const pp = 'extraction.params';
  const extraction: KineticSignature['extraction'] = {
    method: readChoice(ex, 'method', 'extraction', fail, ['farneback'] as const),
    params: {
      pyrScale: readNumber(params, 'pyrScale', pp, fail),
      levels: readNumber(params, 'levels', pp, fail),
      winsize: readNumber(params, 'winsize', pp, fail),
      iterations: readNumber(params, 'iterations', pp, fail),
      polyN: readNumber(params, 'polyN', pp, fail),
      polySigma: readNumber(params, 'polySigma', pp, fail),
    },
    analysisWidth: readNumber(ex, 'analysisWidth', 'extraction', fail, { above: 0 }),
    noiseFloor: readNumber(ex, 'noiseFloor', 'extraction', fail, { min: 0 }),
    noiseFloorMode: readChoice(ex, 'noiseFloorMode', 'extraction', fail, [
      'auto',
      'manual',
    ] as const),
    temporalSmoothingFrames: readNumber(ex, 'temporalSmoothingFrames', 'extraction', fail, {
      integer: true,
      min: 1,
    }),
  };

  const frameRate = readNumber(o, 'frameRate', '', fail, { above: 0, max: 1000 });
  const frameCount = readNumber(o, 'frameCount', '', fail, { integer: true, min: 1 });
  const gridObj = readObject(o.grid, 'grid', fail);
  const grid = {
    cols: readNumber(gridObj, 'cols', 'grid', fail, { integer: true, min: 1, max: MAX_GRID }),
    rows: readNumber(gridObj, 'rows', 'grid', fail, { integer: true, min: 1, max: MAX_GRID }),
  };

  const fieldObj = readObject(o.field, 'field', fail);
  const encoding = readChoice(fieldObj, 'encoding', 'field', fail, ['f32-base64'] as const);
  const data = readString(fieldObj, 'data', 'field', fail);
  const values = frameCount * grid.rows * grid.cols * 2;
  if (data.length !== base64Length(values * 4)) {
    fail(
      'field.data',
      `expected ${values} values (${base64Length(values * 4)} characters), found ${data.length} characters`,
    );
  }
  let decoded: Float32Array;
  try {
    decoded = decodeField(data);
  } catch (err) {
    return fail('field.data', `not valid base64 (${String(err)})`);
  }
  if (decoded.length !== values) fail('field.data', `decodes to ${decoded.length} values`);
  for (let i = 0; i < decoded.length; i++) {
    if (!Number.isFinite(decoded[i])) fail('field.data', `value ${i} is not a finite number`);
  }

  const featObj = readObject(o.features, 'features', fail);
  const features = {} as SignatureFeatures;
  for (const featureName of FEATURE_NAMES) {
    features[featureName] = readNumberArray(featObj, featureName, 'features', fail, {
      length: frameCount,
    });
  }
  features.onsets = readNumberArray(featObj, 'onsets', 'features', fail, {
    integer: true,
    min: 0,
    max: frameCount - 1,
  });

  return {
    format: SIGNATURE_FORMAT,
    version: SIGNATURE_VERSION,
    id,
    name,
    createdAt,
    contentHash,
    source,
    preferredSpeed,
    extraction,
    frameRate,
    frameCount,
    grid,
    field: { encoding, data },
    features,
    stats: readStats(o.stats, fail),
  };
}

/** Migrate and validate an already-parsed JSON value. */
export function signatureFromJson(raw: unknown): KineticSignature {
  return validateSignature(migrateSignature(raw));
}

/** Read a `.sig.json` file's text. Throws FileFormatError with a plain-language message. */
export function parseSignature(text: string): KineticSignature {
  return signatureFromJson(parseJson(text));
}

/** The file contents for a signature, keys in format order. */
export function serializeSignature(sig: KineticSignature): string {
  const s = sig.source;
  const e = sig.extraction;
  const features: Record<string, number[]> = {};
  for (const name of FEATURE_NAMES) features[name] = sig.features[name];
  features.onsets = sig.features.onsets;
  const stats: Record<string, FeatureStats> = {};
  for (const name of FEATURE_NAMES) {
    const st = sig.stats[name];
    if (st) stats[name] = { min: st.min, max: st.max, mean: st.mean, p05: st.p05, p95: st.p95 };
  }
  return formatJson({
    format: sig.format,
    version: sig.version,
    id: sig.id,
    name: sig.name,
    createdAt: sig.createdAt,
    contentHash: sig.contentHash,
    source: {
      fileName: s.fileName,
      nativeFps: s.nativeFps,
      width: s.width,
      height: s.height,
      trim: { startSec: s.trim.startSec, endSec: s.trim.endSec },
      rotate: s.rotate,
      mirror: s.mirror,
      focusArea: s.focusArea
        ? { x: s.focusArea.x, y: s.focusArea.y, w: s.focusArea.w, h: s.focusArea.h }
        : null,
    },
    preferredSpeed: sig.preferredSpeed,
    extraction: {
      method: e.method,
      params: {
        pyrScale: e.params.pyrScale,
        levels: e.params.levels,
        winsize: e.params.winsize,
        iterations: e.params.iterations,
        polyN: e.params.polyN,
        polySigma: e.params.polySigma,
      },
      analysisWidth: e.analysisWidth,
      noiseFloor: e.noiseFloor,
      noiseFloorMode: e.noiseFloorMode,
      temporalSmoothingFrames: e.temporalSmoothingFrames,
    },
    frameRate: sig.frameRate,
    frameCount: sig.frameCount,
    grid: { cols: sig.grid.cols, rows: sig.grid.rows },
    field: { encoding: sig.field.encoding, data: sig.field.data },
    features,
    stats,
  });
}

/** True when the stored contentHash matches the movement data. */
export async function verifySignatureHash(sig: KineticSignature): Promise<boolean> {
  try {
    return (await hashOfSignature(sig)) === sig.contentHash;
  } catch {
    return false;
  }
}
