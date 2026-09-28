/**
 * Signatures in the library (SPEC 6.1, 11.1). A signature record and its lightweight
 * `signatureMeta` entry are always written together in one transaction.
 *
 * Compositions reference a signature by id and content hash. Two signatures with the
 * same hash hold identical movement data (a duplicate, or a re-import), so:
 * - deleting a signature re-points its compositions to an identical copy if one exists
 *   (otherwise they stay, waiting for the signature to come back);
 * - saving or importing a signature re-connects compositions that were waiting for that
 *   movement (same hash, missing signature id).
 */
import {
  SIGNATURE_FILE_EXTENSION,
  parseSignature,
  serializeSignature,
  validateSignature,
  verifySignatureHash,
} from '../signature/serialize';
import type { KineticSignature } from '../signature/types';
import { downloadText } from './download';
import { openLibraryDb, type LibraryDatabase } from './db';
import { LibraryError, MESSAGES, errorDetail } from './errors';
import { requestPersistenceOnce } from './storage';
import { tryThumbnail } from './thumbnails';
import type { SignatureMeta } from './types';
import { byUpdatedDesc, cleanName, copyName, fileNameFor, newId, nowIso } from './util';

export const UNTITLED_SIGNATURE = 'Untitled signature';

const SIGNATURE_STORES = ['signatures', 'signatureMeta', 'compositions'] as const;

/**
 * Give a freshly extracted signature its identity: a new id, a name, and the creation
 * time. Keys come out in file-format order.
 */
export function finalizeSignature(
  body: Omit<KineticSignature, 'id' | 'name' | 'createdAt'>,
  name: string,
): KineticSignature {
  return {
    format: body.format,
    version: body.version,
    id: newId(),
    name: cleanName(name, UNTITLED_SIGNATURE),
    createdAt: nowIso(),
    contentHash: body.contentHash,
    source: body.source,
    preferredSpeed: body.preferredSpeed,
    extraction: body.extraction,
    frameRate: body.frameRate,
    frameCount: body.frameCount,
    grid: body.grid,
    field: body.field,
    features: body.features,
    stats: body.stats,
  };
}

/** The list entry for a signature. */
export function signatureMetaOf(
  sig: KineticSignature,
  updatedAt: string,
  thumbnail: string,
): SignatureMeta {
  return {
    id: sig.id,
    name: sig.name,
    createdAt: sig.createdAt,
    updatedAt,
    contentHash: sig.contentHash,
    frameCount: sig.frameCount,
    frameRate: sig.frameRate,
    durationSec: sig.frameCount / sig.frameRate,
    grid: { cols: sig.grid.cols, rows: sig.grid.rows },
    thumbnail,
  };
}

/** A structurally sound signature whose hash matches its movement data, or an error. */
async function checkForSave(sig: KineticSignature): Promise<KineticSignature> {
  let clean: KineticSignature;
  try {
    clean = validateSignature(sig);
  } catch (err) {
    throw new LibraryError(
      "This signature couldn't be saved because some of its data is missing or unreadable. Try extracting it again.",
      errorDetail(err),
    );
  }
  if (!(await verifySignatureHash(clean))) {
    throw new LibraryError(
      "This signature couldn't be saved because its data is inconsistent. Try extracting it again.",
      `contentHash ${clean.contentHash} does not match the field and features`,
    );
  }
  return clean;
}

/**
 * Write a signature and its meta, and point compositions that wait for this movement
 * (same hash, missing signature id) at it. Returns how many compositions could not play
 * before this write and can now.
 */
async function writeSignature(
  db: LibraryDatabase,
  sig: KineticSignature,
  meta: SignatureMeta,
): Promise<number> {
  const tx = db.transaction(SIGNATURE_STORES, 'readwrite');
  const signatures = tx.objectStore('signatures');
  const compositions = tx.objectStore('compositions');
  // Before this write, could compositions with this movement already play?
  const existed = (await signatures.getKey(sig.id)) !== undefined;
  const twins = await tx
    .objectStore('signatureMeta')
    .index('byContentHash')
    .getAll(sig.contentHash);
  const playable = existed || twins.some((m) => m.id !== sig.id);

  await signatures.put(sig);
  await tx.objectStore('signatureMeta').put(meta);

  let reconnected = 0;
  for (const c of await compositions.index('bySignatureHash').getAll(sig.contentHash)) {
    if (c.signature.id !== sig.id) {
      if ((await signatures.getKey(c.signature.id)) !== undefined) continue;
      await compositions.put({ ...c, signature: { ...c.signature, id: sig.id, name: sig.name } });
    }
    if (!playable) reconnected++;
  }
  await tx.done;
  return reconnected;
}

/**
 * Save a signature (new or replacing the same id). Validates it and checks its hash
 * first; draws the thumbnail unless one is given. Returns the list entry.
 */
export async function saveSignature(
  sig: KineticSignature,
  options: { thumbnail?: string } = {},
): Promise<SignatureMeta> {
  const clean = await checkForSave(sig);
  const meta = signatureMetaOf(clean, nowIso(), options.thumbnail ?? tryThumbnail(clean));
  await writeSignature(await openLibraryDb(), clean, meta);
  void requestPersistenceOnce();
  return meta;
}

export async function getSignature(id: string): Promise<KineticSignature | undefined> {
  return (await openLibraryDb()).get('signatures', id);
}

export async function getSignatureMeta(id: string): Promise<SignatureMeta | undefined> {
  return (await openLibraryDb()).get('signatureMeta', id);
}

/** Rebuild list entries for signatures written without one, and drop stray entries. */
async function repairMeta(db: LibraryDatabase): Promise<void> {
  const [sigKeys, metaKeys] = await Promise.all([
    db.getAllKeys('signatures'),
    db.getAllKeys('signatureMeta'),
  ]);
  const hasMeta = new Set(metaKeys);
  const hasSig = new Set(sigKeys);
  const missing = sigKeys.filter((id) => !hasMeta.has(id));
  const strays = metaKeys.filter((id) => !hasSig.has(id));
  if (missing.length === 0 && strays.length === 0) return;
  const rebuilt: SignatureMeta[] = [];
  for (const id of missing) {
    const sig = await db.get('signatures', id);
    if (sig) rebuilt.push(signatureMetaOf(sig, sig.createdAt, tryThumbnail(sig)));
  }
  const tx = db.transaction('signatureMeta', 'readwrite');
  await Promise.all([
    ...rebuilt.map((m) => tx.store.put(m)),
    ...strays.map((id) => tx.store.delete(id)),
    tx.done,
  ]);
}

/** Every signature's list entry, most recently changed first. */
export async function listSignatureMeta(): Promise<SignatureMeta[]> {
  const db = await openLibraryDb();
  await repairMeta(db);
  return (await db.getAll('signatureMeta')).sort(byUpdatedDesc);
}

/** Signatures holding this exact movement data (same content hash). */
export async function findSignatureMetaByHash(contentHash: string): Promise<SignatureMeta[]> {
  const db = await openLibraryDb();
  return (await db.getAllFromIndex('signatureMeta', 'byContentHash', contentHash)).sort(
    byUpdatedDesc,
  );
}

/** Rename a signature; compositions that use it show the new name too. */
export async function renameSignature(id: string, name: string): Promise<SignatureMeta> {
  const db = await openLibraryDb();
  const tx = db.transaction(SIGNATURE_STORES, 'readwrite');
  const sig = await tx.objectStore('signatures').get(id);
  if (!sig) throw new LibraryError(MESSAGES.notFound, `signature ${id}`);
  const nextName = cleanName(name, sig.name);
  const updatedAt = nowIso();
  const meta =
    (await tx.objectStore('signatureMeta').get(id)) ??
    signatureMetaOf(sig, updatedAt, tryThumbnail(sig));
  const nextMeta: SignatureMeta = { ...meta, name: nextName, updatedAt };
  await tx.objectStore('signatures').put({ ...sig, name: nextName });
  await tx.objectStore('signatureMeta').put(nextMeta);
  const compositions = tx.objectStore('compositions');
  for (const c of await compositions.index('bySignatureId').getAll(id)) {
    await compositions.put({ ...c, signature: { ...c.signature, name: nextName } });
  }
  await tx.done;
  return nextMeta;
}

/** Copy a signature under a new id, named "… copy". Same movement, same content hash. */
export async function duplicateSignature(id: string): Promise<SignatureMeta> {
  const db = await openLibraryDb();
  const sig = await db.get('signatures', id);
  if (!sig) throw new LibraryError(MESSAGES.notFound, `signature ${id}`);
  const original = await db.get('signatureMeta', id);
  const now = nowIso();
  const copy: KineticSignature = { ...sig, id: newId(), name: copyName(sig.name), createdAt: now };
  const meta = signatureMetaOf(copy, now, original?.thumbnail || tryThumbnail(copy));
  await writeSignature(db, copy, meta);
  return meta;
}

/** How many compositions reference this signature (ask before deleting it). */
export async function countCompositionsForSignature(id: string): Promise<number> {
  return (await openLibraryDb()).countFromIndex('compositions', 'bySignatureId', id);
}

/**
 * Delete a signature. Its compositions are kept: they move to an identical copy of the
 * signature if the library has one; otherwise they wait until the signature is
 * imported again. Returns how many compositions moved.
 */
export async function deleteSignature(id: string): Promise<{ moved: number }> {
  const db = await openLibraryDb();
  const tx = db.transaction(SIGNATURE_STORES, 'readwrite');
  const metas = tx.objectStore('signatureMeta');
  const hash =
    (await metas.get(id))?.contentHash ?? (await tx.objectStore('signatures').get(id))?.contentHash;
  await tx.objectStore('signatures').delete(id);
  await metas.delete(id);
  let moved = 0;
  if (hash) {
    const twin = (await metas.index('byContentHash').getAll(hash))
      .filter((m) => m.id !== id)
      .sort(byUpdatedDesc)[0];
    if (twin) {
      const compositions = tx.objectStore('compositions');
      for (const c of await compositions.index('bySignatureId').getAll(id)) {
        await compositions.put({
          ...c,
          signature: { id: twin.id, contentHash: c.signature.contentHash, name: twin.name },
        });
        moved++;
      }
    }
  }
  await tx.done;
  return { moved };
}

export function signatureFileName(sig: Pick<KineticSignature, 'name'>): string {
  return fileNameFor(sig.name, SIGNATURE_FILE_EXTENSION);
}

/** Download a signature as `<name>.sig.json`. Returns the file name. Main thread only. */
export function exportSignatureFile(sig: KineticSignature): string {
  const fileName = signatureFileName(sig);
  downloadText(serializeSignature(sig), fileName);
  return fileName;
}

export interface SignatureImportResult {
  kind: 'signature';
  /** 'already-present': the same signature (same id and movement) was already here. */
  status: 'added' | 'already-present';
  meta: SignatureMeta;
  /** Compositions that were waiting for this signature and can play again. */
  reconnected: number;
}

export interface SignatureImportOptions {
  /** Refuse the file unless it holds this movement (importing a composition's signature). */
  expectContentHash?: string;
}

/**
 * Add a parsed signature to the library. Refuses it if its movement data doesn't match
 * its content hash. Keeps its id unless that id is already taken by a different
 * signature, in which case it gets a new one.
 */
export async function importParsedSignature(
  sig: KineticSignature,
  options: SignatureImportOptions = {},
): Promise<SignatureImportResult> {
  if (options.expectContentHash !== undefined && sig.contentHash !== options.expectContentHash) {
    throw new LibraryError(MESSAGES.wrongSignature, `contentHash ${sig.contentHash}`);
  }
  if (!(await verifySignatureHash(sig))) {
    throw new LibraryError(MESSAGES.tampered, `contentHash ${sig.contentHash} does not match`);
  }
  const db = await openLibraryDb();
  const existingMeta = await db.get('signatureMeta', sig.id);
  if (existingMeta && existingMeta.contentHash === sig.contentHash) {
    return { kind: 'signature', status: 'already-present', meta: existingMeta, reconnected: 0 };
  }
  const idTaken =
    existingMeta !== undefined || (await db.getKey('signatures', sig.id)) !== undefined;
  const record: KineticSignature = idTaken ? { ...sig, id: newId() } : sig;
  const meta = signatureMetaOf(record, nowIso(), tryThumbnail(record));
  const reconnected = await writeSignature(db, record, meta);
  void requestPersistenceOnce();
  return { kind: 'signature', status: 'added', meta, reconnected };
}

/** Read a `.sig.json` file and add it to the library (see importParsedSignature). */
export async function importSignatureFile(
  file: File,
  options: SignatureImportOptions = {},
): Promise<SignatureImportResult> {
  return importParsedSignature(parseSignature(await file.text()), options);
}
