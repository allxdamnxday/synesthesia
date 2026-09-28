/**
 * Albums in the library (SPEC 6.4, 11.3, 12.3): one signature, an ordered set of draft
 * compositions drawn by chance, and the record of working through them.
 *
 * - Creating an album plans every track with the seeded procedure in src/chance/album.ts
 *   and writes the N draft compositions and the album record in one transaction. Each
 *   draft starts from its materials' baselines. The shared properties chance opened are
 *   playable (and, with "Also choose values", start at chance's values); every other
 *   shared property stays at its baseline, locked by chance. Each draft records how it
 *   came about: `chance: { albumId, index, masterSeed, openProperties, overrides: [] }`.
 * - Nothing is deleted by default. A track's status (draft, kept, set aside) and notes live
 *   on its composition, so set-aside tracks stay in the album and its log. Deleting an
 *   album keeps its compositions unless the person explicitly asks for them to go too.
 * - Files: `<title>.spalbum.json` (the album record and its composition ids) and
 *   `ALBUM_LOG.md` (the readable record; src/chance/albumModel.ts writes it).
 * - The `albums` store may also hold placeholder records from before albums had a format
 *   (see LegacyAlbumRecord). Every read validates, so placeholders are never shown and
 *   never thrown away.
 */
import {
  ALBUM_LIMITS,
  planAlbum,
  type AlbumPlan,
  type AlbumSettings,
  type PairingStrategy,
} from '../chance/album';
import { ALBUM_FORMAT, ALBUM_VERSION, formatAlbumLog, type Album } from '../chance/albumModel';
import type { MaterialChoiceInfo } from '../chance/draw';
import { SEED_SPACE } from '../chance/prng';
import type { Composition, CompositionStatus, RenderSettings } from '../engine/composition';
import { createComposition } from '../engine/compositionFactory';
import { validateComposition } from '../engine/compositionSerialize';
import { SHARED_PROPERTIES, isSharedPropertyId } from '../materials/properties';
import {
  SIGNATURE_VIEW_ID,
  getSoundMaterial,
  getVisualMaterial,
  listSoundMaterials,
  listVisualMaterials,
} from '../materials/registry';
import type { MaterialKind, MaterialMeta, PropertyValues } from '../materials/types';
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
import type { KineticSignature } from '../signature/types';
import { openLibraryDb } from './db';
import { downloadText } from './download';
import { LibraryError, MESSAGES, errorDetail } from './errors';
import { RENDER_RESOLUTIONS, getSettings } from './settings';
import { requestPersistenceOnce } from './storage';
import type { StoredAlbum } from './types';
import { cleanName, fileNameFor, newId, nowIso } from './util';

export type { Album } from '../chance/albumModel';
export type { AlbumSettings, PairingStrategy } from '../chance/album';

export const ALBUM_FILE_EXTENSION = '.spalbum.json';
export const ALBUM_LOG_FILE_NAME = 'ALBUM_LOG.md';
export const UNTITLED_ALBUM = 'Untitled album';

export const ALBUM_MESSAGES = {
  notAlbum: "This file isn't a Synesthesia album.",
  newer: 'This album was made with a newer version of Synesthesia. Update the app, then try again.',
  damaged: "This album file is damaged, so it can't be opened.",
  noMaterials: 'Choose at least one visual and one sound material for the album.',
  notInAlbum: "That track isn't part of this album any more.",
} as const;

// ---------------------------------------------------------------------------------------
// File format (`.spalbum.json`)

/**
 * Upgrades from older album file versions, keyed by the version they upgrade from.
 * Version 1 is the first format, so nothing is registered yet. To change the format:
 * bump ALBUM_VERSION (and the `version` type) in src/chance/albumModel.ts, register
 * `n: (raw) => …`, and add a test that loads a real old file.
 */
export const ALBUM_MIGRATIONS: Readonly<Record<number, Migration>> = {};

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const MAX_TRACK_IDS = 1000;

/** Upgrade a raw parsed object to the current album version (unvalidated). */
export function migrateAlbum(raw: unknown): JsonObject {
  if (!isJsonObject(raw)) {
    throw new FileFormatError('wrong-kind', ALBUM_MESSAGES.notAlbum, 'not an object');
  }
  if (raw.format !== ALBUM_FORMAT) {
    throw new FileFormatError(
      'wrong-kind',
      ALBUM_MESSAGES.notAlbum,
      `format: ${String(raw.format)}`,
    );
  }
  return runMigrations(raw, ALBUM_VERSION, ALBUM_MIGRATIONS, ALBUM_MESSAGES);
}

function readIdList(o: JsonObject, key: string, fail: Fail): string[] {
  const ids = readStringArray(o, key, '', fail);
  if (ids.length > MAX_TRACK_IDS) fail(key, `more than ${MAX_TRACK_IDS} entries`);
  const seen = new Set<string>();
  ids.forEach((id, i) => {
    if (id.trim() === '' || id.length > 200) fail(`${key}[${i}]`, 'not a usable id');
    if (seen.has(id)) fail(`${key}[${i}]`, `${id} appears twice`);
    seen.add(id);
  });
  return ids;
}

function readPool(o: JsonObject, key: string, fail: Fail): string[] {
  const ids = readStringArray(o, key, 'settings', fail);
  ids.forEach((id, i) => {
    if (id.trim() === '' || id.length > 100) fail(`settings.${key}[${i}]`, 'not a material id');
  });
  return ids;
}

function readRenders(value: unknown, fail: Fail): Record<string, string> {
  const o = readObject(value, 'renders', fail);
  const renders: Record<string, string> = {};
  for (const key of Object.keys(o)) {
    if (key === '__proto__') continue;
    renders[key] = readString(o, key, 'renders', fail, { nonEmpty: true, maxLength: 500 });
  }
  return renders;
}

/**
 * Check a current-version album object thoroughly and return a clean copy (unknown keys
 * are dropped). Throws FileFormatError.
 */
export function validateAlbum(raw: unknown): Album {
  const fail = failWith(ALBUM_MESSAGES.damaged);
  const o = readObject(raw, 'album', fail);
  if (o.format !== ALBUM_FORMAT) {
    throw new FileFormatError('wrong-kind', ALBUM_MESSAGES.notAlbum, `format: ${String(o.format)}`);
  }
  if (o.version !== ALBUM_VERSION) fail('version', `expected ${ALBUM_VERSION}`);
  const sig = readObject(o.signature, 'signature', fail);
  const s = readObject(o.settings, 'settings', fail);
  const note = o.note;
  if (note !== null && (typeof note !== 'string' || note.length > 2000)) {
    fail('note', 'expected text or null');
  }
  return {
    format: ALBUM_FORMAT,
    version: ALBUM_VERSION,
    id: readString(o, 'id', '', fail, { nonEmpty: true, maxLength: 200 }),
    title: readString(o, 'title', '', fail, { maxLength: 500 }),
    createdAt: readString(o, 'createdAt', '', fail, { maxLength: 100 }),
    updatedAt: readString(o, 'updatedAt', '', fail, { maxLength: 100 }),
    signature: {
      id: readString(sig, 'id', 'signature', fail, { nonEmpty: true, maxLength: 200 }),
      contentHash: readString(sig, 'contentHash', 'signature', fail, { pattern: HASH_PATTERN }),
      name: readString(sig, 'name', 'signature', fail, { maxLength: 500 }),
    },
    settings: {
      title: readString(s, 'title', 'settings', fail, { maxLength: 500 }),
      trackCount: readNumber(s, 'trackCount', 'settings', fail, {
        integer: true,
        min: ALBUM_LIMITS.minTracks,
        max: ALBUM_LIMITS.maxTracks,
      }),
      masterSeed: readNumber(s, 'masterSeed', 'settings', fail, {
        integer: true,
        min: 0,
        max: SEED_SPACE - 1,
      }),
      visualPool: readPool(s, 'visualPool', fail),
      soundPool: readPool(s, 'soundPool', fail),
      openCount: readNumber(s, 'openCount', 'settings', fail, { integer: true, min: 1, max: 3 }),
      strategy: readChoice(s, 'strategy', 'settings', fail, ['chance', 'grid'] as const),
      chooseValues: readBoolean(s, 'chooseValues', 'settings', fail),
    },
    note: note as string | null,
    compositionIds: readIdList(o, 'compositionIds', fail),
    renders: readRenders(o.renders, fail),
  };
}

/** Migrate and validate an already-parsed JSON value. */
export function albumFromJson(raw: unknown): Album {
  return validateAlbum(migrateAlbum(raw));
}

/** Read a `.spalbum.json` file's text. Throws FileFormatError with a plain-language message. */
export function parseAlbum(text: string): Album {
  return albumFromJson(parseJson(text));
}

/** The file contents for an album, keys in format order. */
export function serializeAlbum(album: Album): string {
  const s = album.settings;
  return formatJson({
    format: album.format,
    version: album.version,
    id: album.id,
    title: album.title,
    createdAt: album.createdAt,
    updatedAt: album.updatedAt,
    signature: {
      id: album.signature.id,
      contentHash: album.signature.contentHash,
      name: album.signature.name,
    },
    settings: {
      title: s.title,
      trackCount: s.trackCount,
      masterSeed: s.masterSeed,
      visualPool: [...s.visualPool],
      soundPool: [...s.soundPool],
      openCount: s.openCount,
      strategy: s.strategy,
      chooseValues: s.chooseValues,
    },
    note: album.note,
    compositionIds: [...album.compositionIds],
    renders: { ...album.renders },
  });
}

/** A stored record as an album, or undefined for a placeholder or a damaged record. */
export function readStoredAlbum(record: StoredAlbum | undefined): Album | undefined {
  if (record === undefined) return undefined;
  try {
    return validateAlbum(record);
  } catch {
    return undefined;
  }
}

/**
 * An album entry from a backup (src/library/backup.ts). Current albums are validated in
 * full (FileFormatError when damaged or from a newer app). A record with no version is a
 * placeholder from before albums had a format: it comes back exactly as it was stored.
 */
export function albumFromBackupEntry(raw: unknown): StoredAlbum {
  if (!isJsonObject(raw)) {
    throw new FileFormatError('damaged', ALBUM_MESSAGES.damaged, 'not an object');
  }
  if (raw.version === undefined) {
    if (typeof raw.id !== 'string' || raw.id === '') {
      throw new FileFormatError('damaged', ALBUM_MESSAGES.damaged, 'id: missing');
    }
    return { ...raw, id: raw.id };
  }
  return albumFromJson(raw);
}

/** Backup file contents for a stored record (placeholders are written as they are). */
export function serializeStoredAlbum(record: StoredAlbum): string {
  const album = readStoredAlbum(record);
  return album ? serializeAlbum(album) : `${JSON.stringify(record, null, 2)}\n`;
}

// ---------------------------------------------------------------------------------------
// Planning and drafts (pure)

/** The signature an album is drawn from: a whole signature, or just these fields. */
export type AlbumSource = Pick<KineticSignature, 'id' | 'contentHash' | 'name' | 'preferredSpeed'>;

export interface AlbumMaterials {
  visual: readonly MaterialMeta[];
  sound: readonly MaterialMeta[];
}

/** What chance needs to know about a material: its id and the shared properties it uses. */
export function materialChoiceInfo(meta: MaterialMeta): MaterialChoiceInfo {
  return { id: meta.id, sharedIds: meta.properties.filter((p) => p.shared).map((p) => p.id) };
}

/** Every installed material, in picker order. */
export function installedMaterials(): AlbumMaterials {
  return {
    visual: listVisualMaterials().map((entry) => entry.meta),
    sound: listSoundMaterials().map((entry) => entry.meta),
  };
}

/**
 * The materials an album may use unless the person changes it: every one, except the
 * Signature view (a plain diagnostic view of the movement, not one of the materials).
 */
export function defaultPools(materials: AlbumMaterials): {
  visualPool: string[];
  soundPool: string[];
} {
  return {
    visualPool: materials.visual.map((m) => m.id).filter((id) => id !== SIGNATURE_VIEW_ID),
    soundPool: materials.sound.map((m) => m.id),
  };
}

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * Settings as the album records them: title cleaned, numbers in range, and pools limited
 * to installed materials (in picker order, each once).
 */
export function normalizeAlbumSettings(
  settings: AlbumSettings,
  materials: AlbumMaterials,
): AlbumSettings {
  const pick = (pool: readonly string[], metas: readonly MaterialMeta[]) =>
    metas.map((m) => m.id).filter((id) => pool.includes(id));
  return {
    title: cleanName(settings.title, UNTITLED_ALBUM),
    trackCount: clampInt(
      settings.trackCount,
      ALBUM_LIMITS.minTracks,
      ALBUM_LIMITS.maxTracks,
      ALBUM_LIMITS.defaultTracks,
    ),
    masterSeed: clampInt(Math.trunc(settings.masterSeed), 0, SEED_SPACE - 1, 0),
    visualPool: pick(settings.visualPool, materials.visual),
    soundPool: pick(settings.soundPool, materials.sound),
    openCount: clampInt(settings.openCount, 1, 3, 2),
    strategy: settings.strategy === 'chance' ? 'chance' : 'grid',
    chooseValues: settings.chooseValues === true,
  };
}

/** How many visual × sound pairings the eligible materials make. */
export function pairingCount(settings: Pick<AlbumSettings, 'visualPool' | 'soundPool'>): number {
  return settings.visualPool.length * settings.soundPool.length;
}

/** Chance's values for the open properties, applied where this material has them. */
function withChosenValues(
  properties: PropertyValues,
  meta: MaterialMeta,
  values: Readonly<Record<string, number>> | null,
): PropertyValues {
  if (!values) return properties;
  const out = { ...properties };
  for (const def of meta.properties) {
    const value = values[def.id];
    if (def.shared && typeof value === 'number') out[def.id] = value;
  }
  return out;
}

export interface AlbumDraftInput {
  albumId: string;
  /** Makes each draft composition's id (library code: a new uuid each call). */
  newId: () => string;
  /** ISO date/time for every record. */
  now: string;
  signature: AlbumSource;
  settings: AlbumSettings;
  materials: AlbumMaterials;
  /** Render size and rate every draft starts with. */
  render: RenderSettings;
}

export interface AlbumDrafts {
  album: Album;
  /** In album order. */
  compositions: Composition[];
}

/**
 * Plan an album and build its records (no storage). Everything that shapes a draft comes
 * from the settings and the seeded plan, so the same master seed and settings give
 * identical drafts on any machine; only ids and dates differ.
 */
export function buildAlbumDrafts(input: AlbumDraftInput): AlbumDrafts {
  const settings = normalizeAlbumSettings(input.settings, input.materials);
  const byId = (metas: readonly MaterialMeta[], id: string) => metas.find((m) => m.id === id);
  let plan: AlbumPlan;
  try {
    plan = planAlbum(settings, {
      visual: input.materials.visual.map(materialChoiceInfo),
      sound: input.materials.sound.map(materialChoiceInfo),
    });
  } catch (err) {
    throw new LibraryError(ALBUM_MESSAGES.noMaterials, errorDetail(err));
  }
  const signature = { id: input.signature.id, contentHash: input.signature.contentHash };
  const compositions = plan.tracks.map((track) => {
    const visual = byId(input.materials.visual, track.visualId);
    const sound = byId(input.materials.sound, track.soundId);
    if (!visual || !sound) throw new LibraryError(ALBUM_MESSAGES.noMaterials, 'unknown material');
    const draft = createComposition({
      id: input.newId(),
      now: input.now,
      name: track.name,
      signature: {
        ...signature,
        name: input.signature.name,
        preferredSpeed: input.signature.preferredSpeed,
      },
      seed: track.seed,
      visual,
      sound,
      render: input.render,
    });
    return {
      ...draft,
      visual: {
        ...draft.visual,
        properties: withChosenValues(draft.visual.properties, visual, track.values),
      },
      sound: {
        ...draft.sound,
        properties: withChosenValues(draft.sound.properties, sound, track.values),
      },
      chance: {
        albumId: input.albumId,
        index: track.index,
        masterSeed: settings.masterSeed,
        openProperties: [...track.openProperties],
        overrides: [],
      },
    };
  });
  const album: Album = {
    format: ALBUM_FORMAT,
    version: ALBUM_VERSION,
    id: input.albumId,
    title: settings.title,
    createdAt: input.now,
    updatedAt: input.now,
    signature: { ...signature, name: input.signature.name },
    settings,
    note: plan.note,
    compositionIds: compositions.map((c) => c.id),
    renders: {},
  };
  return { album, compositions };
}

// ---------------------------------------------------------------------------------------
// Working the album (pure)

export const TRACK_STATUSES: readonly CompositionStatus[] = ['draft', 'kept', 'set-aside'];

export function isTrackStatus(value: unknown): value is CompositionStatus {
  return (TRACK_STATUSES as readonly unknown[]).includes(value);
}

/** Longest notes a track keeps (the composition format's limit). */
export const MAX_NOTES_LENGTH = 200_000;

/** A track with a new status. Any status can follow any other; nothing is removed. */
export function withTrackStatus(
  c: Composition,
  status: CompositionStatus,
  now: string,
): Composition {
  if (!isTrackStatus(status)) throw new LibraryError(MESSAGES.generic, `status ${String(status)}`);
  return { ...c, status, updatedAt: now };
}

/** A track with new notes (the research record: discoveries, failures, revisions). */
export function withTrackNotes(c: Composition, notes: string, now: string): Composition {
  return { ...c, notes: notes.slice(0, MAX_NOTES_LENGTH), updatedAt: now };
}

export interface TrackCounts {
  draft: number;
  kept: number;
  setAside: number;
  /** Tracks whose composition is no longer in the library. */
  missing: number;
}

export function countTracks(
  tracks: ReadonlyArray<Pick<Composition, 'status'> | undefined>,
): TrackCounts {
  const counts: TrackCounts = { draft: 0, kept: 0, setAside: 0, missing: 0 };
  for (const t of tracks) {
    if (!t) counts.missing++;
    else if (t.status === 'kept') counts.kept++;
    else if (t.status === 'set-aside') counts.setAside++;
    else counts.draft++;
  }
  return counts;
}

export interface AlbumSummary {
  album: Album;
  counts: TrackCounts;
  /** The latest change to the album or to any of its tracks (ISO 8601). */
  lastChanged: string;
  /** A still of a track's wake: the first kept track that has one, else any track's. */
  thumbnail?: string;
}

export function summarizeAlbum(
  album: Album,
  tracks: ReadonlyArray<Composition | undefined>,
): AlbumSummary {
  let lastChanged = album.updatedAt;
  for (const t of tracks) if (t && t.updatedAt > lastChanged) lastChanged = t.updatedAt;
  const withStill = tracks.filter((t): t is Composition => Boolean(t?.thumbnail));
  const still = withStill.find((t) => t.status === 'kept') ?? withStill[0];
  return {
    album,
    counts: countTracks(tracks),
    lastChanged,
    ...(still?.thumbnail ? { thumbnail: still.thumbnail } : {}),
  };
}

/** Newest change first; ties by title, then id, so the order is stable. */
export function byLastChangedDesc(a: AlbumSummary, b: AlbumSummary): number {
  if (a.lastChanged !== b.lastChanged) return a.lastChanged < b.lastChanged ? 1 : -1;
  const byTitle = a.album.title.localeCompare(b.album.title);
  if (byTitle !== 0) return byTitle;
  return a.album.id < b.album.id ? -1 : a.album.id > b.album.id ? 1 : 0;
}

// ---------------------------------------------------------------------------------------
// Names and the log (pure)

/** A material's display name; the id when it isn't installed (any more). */
export function materialName(kind: MaterialKind, id: string): string {
  const entry = kind === 'visual' ? getVisualMaterial(id) : getSoundMaterial(id);
  return entry?.meta.name ?? id;
}

/** A property's label: from the shared vocabulary, else from an installed material. */
export function propertyLabel(id: string): string {
  if (isSharedPropertyId(id)) return SHARED_PROPERTIES[id].label;
  for (const entry of [...listVisualMaterials(), ...listSoundMaterials()]) {
    const def = entry.meta.properties.find((p) => p.id === id);
    if (def) return def.label;
  }
  return id;
}

/** The album log (`ALBUM_LOG.md`) for an album and its tracks, in album order. */
export function albumLogText(
  album: Album,
  tracks: ReadonlyArray<Composition | undefined>,
  generatedAt: string,
): string {
  return formatAlbumLog({
    album,
    compositions: [...tracks],
    materialName,
    propertyLabel,
    generatedAt,
  });
}

/** `Wink-album.spalbum.json` */
export function albumFileName(album: Pick<Album, 'title'>): string {
  return fileNameFor(album.title, ALBUM_FILE_EXTENSION);
}

// ---------------------------------------------------------------------------------------
// Storage

async function defaultRenderSettings(): Promise<RenderSettings> {
  const settings = await getSettings();
  const size = RENDER_RESOLUTIONS[settings.renderResolution];
  return { width: size.width, height: size.height, fps: settings.renderFps };
}

const OUT_OF_RANGE = "This album couldn't be made because some of its settings are out of range.";

function checked<T>(check: (value: T) => T, value: T): T {
  try {
    return check(value);
  } catch (err) {
    throw new LibraryError(OUT_OF_RANGE, errorDetail(err));
  }
}

/**
 * Plan an album from a signature and write its draft compositions and its record in one
 * transaction. Drafts start with the app's default render size unless `render` is given.
 */
export async function createAlbumFromPlan(
  signature: AlbumSource,
  settings: AlbumSettings,
  options: { render?: RenderSettings; materials?: AlbumMaterials } = {},
): Promise<Album> {
  const { album, compositions } = buildAlbumDrafts({
    albumId: newId(),
    newId,
    now: nowIso(),
    signature,
    settings,
    materials: options.materials ?? installedMaterials(),
    render: options.render ?? (await defaultRenderSettings()),
  });
  const drafts = compositions.map((c) => checked(validateComposition, c));
  const record = checked(validateAlbum, album);
  const db = await openLibraryDb();
  const tx = db.transaction(['compositions', 'albums'], 'readwrite');
  await Promise.all([
    ...drafts.map((c) => tx.objectStore('compositions').put(c)),
    tx.objectStore('albums').put(record),
    tx.done,
  ]);
  void requestPersistenceOnce();
  return record;
}

export async function getAlbum(id: string): Promise<Album | undefined> {
  return readStoredAlbum(await (await openLibraryDb()).get('albums', id));
}

export interface AlbumWithTracks {
  album: Album;
  /** In album order; undefined where a track's composition is no longer in the library. */
  tracks: Array<Composition | undefined>;
  /** The library has the album's signature (by id, or the same movement under another id). */
  signatureAvailable: boolean;
}

/** An album with its track compositions, read together. */
export async function getAlbumWithTracks(id: string): Promise<AlbumWithTracks | undefined> {
  const db = await openLibraryDb();
  const tx = db.transaction(['albums', 'compositions', 'signatures', 'signatureMeta']);
  const album = readStoredAlbum(await tx.objectStore('albums').get(id));
  if (!album) {
    await tx.done;
    return undefined;
  }
  const compositions = tx.objectStore('compositions');
  const [tracks, byId, twins] = await Promise.all([
    Promise.all(album.compositionIds.map((cid) => compositions.get(cid))),
    tx.objectStore('signatures').getKey(album.signature.id),
    tx.objectStore('signatureMeta').index('byContentHash').count(album.signature.contentHash),
  ]);
  await tx.done;
  return { album, tracks, signatureAvailable: byId !== undefined || twins > 0 };
}

/** Every album with its counts, the most recently changed first. Placeholders are skipped. */
export async function listAlbums(): Promise<AlbumSummary[]> {
  const db = await openLibraryDb();
  const tx = db.transaction(['albums', 'compositions']);
  const [records, compositions] = await Promise.all([
    tx.objectStore('albums').getAll(),
    tx.objectStore('compositions').getAll(),
  ]);
  await tx.done;
  const byId = new Map(compositions.map((c) => [c.id, c]));
  const summaries: AlbumSummary[] = [];
  for (const record of records) {
    const album = readStoredAlbum(record);
    if (!album) continue;
    summaries.push(
      summarizeAlbum(
        album,
        album.compositionIds.map((id) => byId.get(id)),
      ),
    );
  }
  return summaries.sort(byLastChangedDesc);
}

async function updateAlbum(id: string, change: (album: Album) => Album): Promise<Album> {
  const db = await openLibraryDb();
  const tx = db.transaction('albums', 'readwrite');
  const album = readStoredAlbum(await tx.store.get(id));
  if (!album) throw new LibraryError(MESSAGES.notFound, `album ${id}`);
  const next = change(album);
  await tx.store.put(next);
  await tx.done;
  return next;
}

export async function renameAlbum(id: string, title: string): Promise<Album> {
  return updateAlbum(id, (album) => {
    const next = cleanName(title, album.title);
    return {
      ...album,
      title: next,
      settings: { ...album.settings, title: next },
      updatedAt: nowIso(),
    };
  });
}

/**
 * Delete an album's record. Its compositions stay in the library as ordinary
 * compositions, unless `deleteCompositions` is true (the person chose that explicitly).
 */
export async function deleteAlbum(
  id: string,
  options: { deleteCompositions?: boolean } = {},
): Promise<{ deletedCompositions: number }> {
  const db = await openLibraryDb();
  const tx = db.transaction(['albums', 'compositions'], 'readwrite');
  const albums = tx.objectStore('albums');
  const album = readStoredAlbum(await albums.get(id));
  if (!album) throw new LibraryError(MESSAGES.notFound, `album ${id}`);
  let deletedCompositions = 0;
  if (options.deleteCompositions === true) {
    const compositions = tx.objectStore('compositions');
    for (const cid of album.compositionIds) {
      if ((await compositions.getKey(cid)) === undefined) continue;
      await compositions.delete(cid);
      deletedCompositions++;
    }
  }
  await albums.delete(id);
  await tx.done;
  return { deletedCompositions };
}

async function updateTrack(
  compositionId: string,
  change: (c: Composition) => Composition,
): Promise<Composition> {
  const db = await openLibraryDb();
  const tx = db.transaction('compositions', 'readwrite');
  const current = await tx.store.get(compositionId);
  if (!current) throw new LibraryError(MESSAGES.notFound, `composition ${compositionId}`);
  const next = change(current);
  await tx.store.put(next);
  await tx.done;
  return next;
}

/** Mark a track draft, kept or set aside (saved at once). */
export async function setTrackStatus(
  compositionId: string,
  status: CompositionStatus,
): Promise<Composition> {
  return updateTrack(compositionId, (c) => withTrackStatus(c, status, nowIso()));
}

/** Replace a track's notes (saved at once). */
export async function setTrackNotes(compositionId: string, notes: string): Promise<Composition> {
  return updateTrack(compositionId, (c) => withTrackNotes(c, notes, nowIso()));
}

/** Record the file a track was last rendered to (shown in the album and its log). */
export async function setAlbumRender(
  albumId: string,
  compositionId: string,
  fileName: string,
): Promise<Album> {
  return updateAlbum(albumId, (album) => {
    if (!album.compositionIds.includes(compositionId)) {
      throw new LibraryError(ALBUM_MESSAGES.notInAlbum, `composition ${compositionId}`);
    }
    return {
      ...album,
      renders: { ...album.renders, [compositionId]: fileName },
      updatedAt: nowIso(),
    };
  });
}

/**
 * Download the album log (`ALBUM_LOG.md`) and the album file (`<title>.spalbum.json`),
 * from the library's current record. Returns the file names. Main thread only.
 */
export async function exportAlbumFiles(
  album: Album,
): Promise<{ logFileName: string; albumFileName: string }> {
  const current = (await getAlbumWithTracks(album.id)) ?? { album, tracks: [] };
  const log = albumLogText(current.album, current.tracks, nowIso());
  const fileName = albumFileName(current.album);
  downloadText(log, ALBUM_LOG_FILE_NAME, 'text/markdown');
  downloadText(serializeAlbum(current.album), fileName);
  return { logFileName: ALBUM_LOG_FILE_NAME, albumFileName: fileName };
}

export interface AlbumImportResult {
  kind: 'album';
  /** 'already-present': an identical album (same id and contents) was already here. */
  status: 'added' | 'already-present';
  album: Album;
  /** Tracks whose compositions aren't in the library (import those, or a backup). */
  missingTracks: number;
}

/**
 * Add a parsed album to the library. It keeps its id unless that id holds a different
 * record (then it gets a new id; nothing is overwritten). An album file holds only
 * composition ids, so tracks whose compositions aren't here are counted as missing.
 */
export async function importParsedAlbum(album: Album): Promise<AlbumImportResult> {
  const db = await openLibraryDb();
  const tx = db.transaction(['albums', 'compositions'], 'readwrite');
  const albums = tx.objectStore('albums');
  const stored = await albums.get(album.id);
  const existing = readStoredAlbum(stored);
  const compositions = tx.objectStore('compositions');
  const keys = await Promise.all(album.compositionIds.map((id) => compositions.getKey(id)));
  const missingTracks = keys.filter((key) => key === undefined).length;
  if (existing && serializeAlbum(existing) === serializeAlbum(album)) {
    await tx.done;
    return { kind: 'album', status: 'already-present', album: existing, missingTracks };
  }
  const record: Album = stored === undefined ? album : { ...album, id: newId() };
  await albums.put(record);
  await tx.done;
  void requestPersistenceOnce();
  return { kind: 'album', status: 'added', album: record, missingTracks };
}

/** Read a `.spalbum.json` file and add it to the library (see importParsedAlbum). */
export async function importAlbumFile(file: File): Promise<AlbumImportResult> {
  return importParsedAlbum(parseAlbum(await file.text()));
}

/** Labels for the pairing strategies, for the album screens and the Library. */
export const PAIRING_LABELS: Readonly<Record<PairingStrategy, string>> = {
  chance: 'Pure chance',
  grid: 'Every pairing once',
};
