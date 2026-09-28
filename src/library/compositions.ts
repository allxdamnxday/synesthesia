/**
 * Compositions in the library (SPEC 6.1, 11.2). A composition references its signature
 * by id and content hash; when the id is missing (the signature was deleted and imported
 * again under a new id), any signature with the same content hash plays it.
 */
import type { Composition } from '../engine/composition';
import {
  COMPOSITION_FILE_EXTENSION,
  parseComposition,
  serializeComposition,
  validateComposition,
} from '../engine/compositionSerialize';
import type { KineticSignature } from '../signature/types';
import { downloadText } from './download';
import { openLibraryDb } from './db';
import { LibraryError, MESSAGES, errorDetail } from './errors';
import { requestPersistenceOnce } from './storage';
import { byUpdatedDesc, cleanName, copyName, fileNameFor, newId, nowIso } from './util';

export const UNTITLED_COMPOSITION = 'Untitled composition';

function checkForSave(c: Composition): Composition {
  try {
    return validateComposition(c);
  } catch (err) {
    throw new LibraryError(
      "This composition couldn't be saved because some of its settings are missing or out of range.",
      errorDetail(err),
    );
  }
}

/** Save a composition (new or replacing the same id); sets `updatedAt`. Returns what was stored. */
export async function saveComposition(c: Composition): Promise<Composition> {
  const clean = checkForSave(c);
  const saved: Composition = {
    ...clean,
    name: cleanName(clean.name, UNTITLED_COMPOSITION),
    updatedAt: nowIso(),
  };
  await (await openLibraryDb()).put('compositions', saved);
  void requestPersistenceOnce();
  return saved;
}

export async function getComposition(id: string): Promise<Composition | undefined> {
  return (await openLibraryDb()).get('compositions', id);
}

/** Every composition, most recently changed first. */
export async function listCompositions(): Promise<Composition[]> {
  return (await (await openLibraryDb()).getAll('compositions')).sort(byUpdatedDesc);
}

/** Compositions that reference a signature id, most recently changed first. */
export async function listCompositionsBySignature(signatureId: string): Promise<Composition[]> {
  const db = await openLibraryDb();
  return (await db.getAllFromIndex('compositions', 'bySignatureId', signatureId)).sort(
    byUpdatedDesc,
  );
}

export async function renameComposition(id: string, name: string): Promise<Composition> {
  const db = await openLibraryDb();
  const tx = db.transaction('compositions', 'readwrite');
  const c = await tx.store.get(id);
  if (!c) throw new LibraryError(MESSAGES.notFound, `composition ${id}`);
  const renamed: Composition = { ...c, name: cleanName(name, c.name), updatedAt: nowIso() };
  await tx.store.put(renamed);
  await tx.done;
  return renamed;
}

/** Copy a composition under a new id, named "… copy". */
export async function duplicateComposition(id: string): Promise<Composition> {
  const db = await openLibraryDb();
  const c = await db.get('compositions', id);
  if (!c) throw new LibraryError(MESSAGES.notFound, `composition ${id}`);
  const now = nowIso();
  const copy: Composition = {
    ...c,
    id: newId(),
    name: copyName(c.name),
    createdAt: now,
    updatedAt: now,
  };
  await db.put('compositions', copy);
  return copy;
}

export async function deleteComposition(id: string): Promise<void> {
  await (await openLibraryDb()).delete('compositions', id);
}

export function compositionFileName(c: Pick<Composition, 'name'>): string {
  return fileNameFor(c.name, COMPOSITION_FILE_EXTENSION);
}

/** Download a composition as `<name>.spcomp.json`. Returns the file name. Main thread only. */
export function exportCompositionFile(c: Composition): string {
  const fileName = compositionFileName(c);
  downloadText(serializeComposition(c), fileName);
  return fileName;
}

/** The signature a composition plays: by id, else any signature with the same movement. */
export async function findSignatureForComposition(
  c: Pick<Composition, 'signature'>,
): Promise<KineticSignature | undefined> {
  const db = await openLibraryDb();
  const byId = await db.get('signatures', c.signature.id);
  if (byId) return byId;
  const twins = (
    await db.getAllFromIndex('signatureMeta', 'byContentHash', c.signature.contentHash)
  ).sort(byUpdatedDesc);
  return twins[0] ? db.get('signatures', twins[0].id) : undefined;
}

export interface CompositionImportResult {
  kind: 'composition';
  /** 'already-present': an identical composition (same id and contents) was already here. */
  status: 'added' | 'already-present';
  composition: Composition;
  /**
   * Set when the library has no signature for it: ask the person to import that
   * signature file (match it by `contentHash`, e.g. importSignatureFile with
   * `expectContentHash`). The composition is saved either way.
   */
  missingSignature: Composition['signature'] | null;
}

/**
 * Add a parsed composition to the library. It keeps its id unless that id holds a
 * different composition (then it gets a new id; nothing is overwritten). If the
 * library has its signature under another id (same content hash), it is re-pointed.
 */
export async function importParsedComposition(c: Composition): Promise<CompositionImportResult> {
  const db = await openLibraryDb();
  const existing = await db.get('compositions', c.id);
  if (existing && serializeComposition(existing) === serializeComposition(c)) {
    return {
      kind: 'composition',
      status: 'already-present',
      composition: existing,
      missingSignature: null,
    };
  }
  let record: Composition = existing ? { ...c, id: newId() } : c;
  let missingSignature: Composition['signature'] | null = null;
  if ((await db.getKey('signatures', c.signature.id)) === undefined) {
    const twin = (
      await db.getAllFromIndex('signatureMeta', 'byContentHash', c.signature.contentHash)
    ).sort(byUpdatedDesc)[0];
    if (twin) {
      record = { ...record, signature: { ...record.signature, id: twin.id, name: twin.name } };
    } else {
      missingSignature = { ...c.signature };
    }
  }
  await db.put('compositions', record);
  void requestPersistenceOnce();
  return { kind: 'composition', status: 'added', composition: record, missingSignature };
}

/** Read a `.spcomp.json` file and add it to the library (see importParsedComposition). */
export async function importCompositionFile(file: File): Promise<CompositionImportResult> {
  return importParsedComposition(parseComposition(await file.text()));
}
