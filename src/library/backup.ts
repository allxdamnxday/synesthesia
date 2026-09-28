/**
 * Back up everything / Restore from backup (SPEC 6.1, 11.3): one `.spbackup.zip` holding
 *
 *   manifest.json                     format, version, date, and what's inside
 *   signatures/<id>.sig.json          every signature
 *   compositions/<id>.spcomp.json     every composition
 *   albums/<id>.spalbum.json          every album record
 *
 * Restoring validates everything first (formats, each signature's content hash, and each
 * album record; a placeholder album from before albums had a format comes back as it
 * was) and writes nothing if any item is damaged. Then it merges by id in one transaction:
 * new ids are added, existing ids are replaced by the backed-up version, and nothing
 * else in the library changes. Settings and working state are not part of a backup.
 */
import { strFromU8, strToU8, unzip, zip, type Unzipped } from 'fflate';
import type { Composition } from '../engine/composition';
import { parseComposition, serializeComposition } from '../engine/compositionSerialize';
import {
  FileFormatError,
  failWith,
  formatJson,
  isJsonObject,
  parseJson,
  parseSignature,
  readObject,
  readString,
  runMigrations,
  serializeSignature,
  verifySignatureHash,
  type JsonObject,
  type Migration,
} from '../signature/serialize';
import type { KineticSignature } from '../signature/types';
import { albumFromBackupEntry, serializeStoredAlbum } from './albums';
import { downloadBlob } from './download';
import { openLibraryDb } from './db';
import { LibraryError, errorDetail } from './errors';
import { signatureMetaOf } from './signatures';
import { requestPersistenceOnce } from './storage';
import { tryThumbnail } from './thumbnails';
import type { StoredAlbum } from './types';
import { nowIso } from './util';

export const BACKUP_FORMAT = 'sp-backup';
export const BACKUP_VERSION = 1;
export const BACKUP_FILE_EXTENSION = '.spbackup.zip';
const MANIFEST = 'manifest.json';

/** Upgrades from older backup manifests, keyed by the version they upgrade from. */
export const BACKUP_MIGRATIONS: Readonly<Record<number, Migration>> = {};

export const BACKUP_MESSAGES = {
  notBackup: "This file isn't a Synesthesia backup.",
  newer:
    'This backup was made with a newer version of Synesthesia. Update the app, then try again.',
  damaged: 'This backup is damaged, so nothing was restored.',
} as const;

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  createdAt: string;
  signatures: { id: string; name: string; contentHash: string; updatedAt: string; file: string }[];
  compositions: { id: string; name: string; file: string }[];
  albums: { id: string; file: string }[];
}

export interface BackupContents {
  manifest: BackupManifest;
  signatures: { signature: KineticSignature; updatedAt: string }[];
  compositions: Composition[];
  albums: StoredAlbum[];
}

export interface RestoreCounts {
  added: number;
  replaced: number;
}

export interface RestoreSummary {
  signatures: RestoreCounts;
  compositions: RestoreCounts;
  albums: RestoreCounts;
}

function zipAsync(files: Record<string, Uint8Array>): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(files, { level: 6 }, (err, data) => (err ? reject(err) : resolve(data)));
  });
}

function unzipAsync(bytes: Uint8Array): Promise<Unzipped> {
  return new Promise((resolve, reject) => {
    unzip(bytes, (err, data) => (err ? reject(err) : resolve(data)));
  });
}

/** A zip path for an id (ids from imported files could contain any characters). */
function pathFor(folder: string, id: string, extension: string): string {
  return `${folder}/${encodeURIComponent(id)}${extension}`;
}

/** The whole library as a `.spbackup.zip` blob. */
export async function createBackup(): Promise<Blob> {
  const db = await openLibraryDb();
  const tx = db.transaction(['signatures', 'signatureMeta', 'compositions', 'albums']);
  const [signatures, metas, compositions, albums] = await Promise.all([
    tx.objectStore('signatures').getAll(),
    tx.objectStore('signatureMeta').getAll(),
    tx.objectStore('compositions').getAll(),
    tx.objectStore('albums').getAll(),
  ]);
  await tx.done;
  const updatedAt = new Map(metas.map((m) => [m.id, m.updatedAt]));

  const files: Record<string, Uint8Array> = {};
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: nowIso(),
    signatures: [],
    compositions: [],
    albums: [],
  };
  for (const sig of signatures) {
    const file = pathFor('signatures', sig.id, '.sig.json');
    files[file] = strToU8(serializeSignature(sig));
    manifest.signatures.push({
      id: sig.id,
      name: sig.name,
      contentHash: sig.contentHash,
      updatedAt: updatedAt.get(sig.id) ?? sig.createdAt,
      file,
    });
  }
  for (const c of compositions) {
    const file = pathFor('compositions', c.id, '.spcomp.json');
    files[file] = strToU8(serializeComposition(c));
    manifest.compositions.push({ id: c.id, name: c.name, file });
  }
  for (const album of albums) {
    const file = pathFor('albums', album.id, '.spalbum.json');
    files[file] = strToU8(serializeStoredAlbum(album));
    manifest.albums.push({ id: album.id, file });
  }
  files[MANIFEST] = strToU8(formatJson(manifest));
  const bytes = await zipAsync(files);
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
}

/** `synesthesia-backup-2026-09-28.spbackup.zip` (local date). */
export function backupFileName(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `synesthesia-backup-${day}${BACKUP_FILE_EXTENSION}`;
}

/** Build a backup and download it. Main thread only. */
export async function downloadBackup(): Promise<{ fileName: string; bytes: number }> {
  const blob = await createBackup();
  const fileName = backupFileName();
  downloadBlob(blob, fileName);
  return { fileName, bytes: blob.size };
}

function readManifest(text: string): BackupManifest {
  let raw: unknown;
  try {
    raw = parseJson(text);
  } catch (err) {
    throw new LibraryError(BACKUP_MESSAGES.damaged, errorDetail(err));
  }
  if (!isJsonObject(raw) || raw.format !== BACKUP_FORMAT) {
    throw new LibraryError(BACKUP_MESSAGES.notBackup, 'manifest format');
  }
  let current: JsonObject;
  try {
    current = runMigrations(raw, BACKUP_VERSION, BACKUP_MIGRATIONS, BACKUP_MESSAGES);
  } catch (err) {
    if (err instanceof FileFormatError) throw new LibraryError(err.message, err.detail);
    throw err;
  }
  const fail = failWith(BACKUP_MESSAGES.damaged);
  const list = (key: string): JsonObject[] => {
    const value = current[key];
    if (!Array.isArray(value)) return fail(`manifest.${key}`, 'expected a list');
    return value.map((item, i) => readObject(item, `manifest.${key}[${i}]`, fail));
  };
  const short = { maxLength: 1000 };
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: readString(current, 'createdAt', 'manifest', fail, short),
    signatures: list('signatures').map((o, i) => ({
      id: readString(o, 'id', `signatures[${i}]`, fail, { nonEmpty: true }),
      name: readString(o, 'name', `signatures[${i}]`, fail, short),
      contentHash: readString(o, 'contentHash', `signatures[${i}]`, fail),
      updatedAt: readString(o, 'updatedAt', `signatures[${i}]`, fail, short),
      file: readString(o, 'file', `signatures[${i}]`, fail, { nonEmpty: true }),
    })),
    compositions: list('compositions').map((o, i) => ({
      id: readString(o, 'id', `compositions[${i}]`, fail, { nonEmpty: true }),
      name: readString(o, 'name', `compositions[${i}]`, fail, short),
      file: readString(o, 'file', `compositions[${i}]`, fail, { nonEmpty: true }),
    })),
    albums: list('albums').map((o, i) => ({
      id: readString(o, 'id', `albums[${i}]`, fail, { nonEmpty: true }),
      file: readString(o, 'file', `albums[${i}]`, fail, { nonEmpty: true }),
    })),
  };
}

/**
 * Open and check a backup without changing the library. Throws LibraryError (with the
 * damaged item named in `detail`) if anything in it can't be restored.
 */
export async function readBackup(file: Blob): Promise<BackupContents> {
  let entries: Unzipped;
  try {
    entries = await unzipAsync(new Uint8Array(await file.arrayBuffer()));
  } catch (err) {
    throw new LibraryError(BACKUP_MESSAGES.notBackup, errorDetail(err));
  }
  const manifestBytes = entries[MANIFEST];
  if (!manifestBytes) throw new LibraryError(BACKUP_MESSAGES.notBackup, 'no manifest.json');
  let manifest: BackupManifest;
  try {
    manifest = readManifest(strFromU8(manifestBytes));
  } catch (err) {
    if (err instanceof LibraryError) throw err;
    throw new LibraryError(BACKUP_MESSAGES.damaged, errorDetail(err));
  }

  const entryText = (path: string, label: string): string => {
    const bytes = entries[path];
    if (!bytes) throw new LibraryError(BACKUP_MESSAGES.damaged, `${label}: ${path} is missing`);
    return strFromU8(bytes);
  };
  const damaged = (label: string, err: unknown): LibraryError =>
    new LibraryError(BACKUP_MESSAGES.damaged, `${label}: ${errorDetail(err)}`);

  const signatures: BackupContents['signatures'] = [];
  for (const entry of manifest.signatures) {
    const label = `signature "${entry.name}"`;
    let sig: KineticSignature;
    try {
      sig = parseSignature(entryText(entry.file, label));
    } catch (err) {
      throw err instanceof LibraryError ? err : damaged(label, err);
    }
    if (sig.id !== entry.id) throw damaged(label, `id ${sig.id} ≠ ${entry.id}`);
    if (!(await verifySignatureHash(sig))) throw damaged(label, 'content hash does not match');
    signatures.push({ signature: sig, updatedAt: entry.updatedAt });
  }

  const compositions: Composition[] = [];
  for (const entry of manifest.compositions) {
    const label = `composition "${entry.name}"`;
    let c: Composition;
    try {
      c = parseComposition(entryText(entry.file, label));
    } catch (err) {
      throw err instanceof LibraryError ? err : damaged(label, err);
    }
    if (c.id !== entry.id) throw damaged(label, `id ${c.id} ≠ ${entry.id}`);
    compositions.push(c);
  }

  const albums: StoredAlbum[] = [];
  for (const entry of manifest.albums) {
    const label = `album ${entry.id}`;
    let album: StoredAlbum;
    try {
      album = albumFromBackupEntry(parseJson(entryText(entry.file, label)));
    } catch (err) {
      throw err instanceof LibraryError ? err : damaged(label, err);
    }
    if (album.id !== entry.id) throw damaged(label, 'id does not match');
    albums.push(album);
  }

  return { manifest, signatures, compositions, albums };
}

/** Restore a backup into the library (see the file comment). Returns what changed. */
export async function restoreBackup(file: Blob): Promise<RestoreSummary> {
  const contents = await readBackup(file);
  // Draw thumbnails before the transaction: it must not wait on anything but the database.
  const metas = contents.signatures.map(({ signature, updatedAt }) =>
    signatureMetaOf(signature, updatedAt, tryThumbnail(signature)),
  );

  const db = await openLibraryDb();
  const tx = db.transaction(['signatures', 'signatureMeta', 'compositions', 'albums'], 'readwrite');
  const [sigKeys, compositionKeys, albumKeys] = await Promise.all([
    tx.objectStore('signatures').getAllKeys(),
    tx.objectStore('compositions').getAllKeys(),
    tx.objectStore('albums').getAllKeys(),
  ]);
  const summary: RestoreSummary = {
    signatures: { added: 0, replaced: 0 },
    compositions: { added: 0, replaced: 0 },
    albums: { added: 0, replaced: 0 },
  };
  const count = (counts: RestoreCounts, existing: Set<string>, id: string) => {
    if (existing.has(id)) counts.replaced++;
    else counts.added++;
    existing.add(id);
  };
  const writes: Promise<unknown>[] = [];
  const hasSig = new Set(sigKeys);
  contents.signatures.forEach(({ signature }, i) => {
    count(summary.signatures, hasSig, signature.id);
    writes.push(tx.objectStore('signatures').put(signature));
    writes.push(tx.objectStore('signatureMeta').put(metas[i]));
  });
  const hasComposition = new Set(compositionKeys);
  for (const c of contents.compositions) {
    count(summary.compositions, hasComposition, c.id);
    writes.push(tx.objectStore('compositions').put(c));
  }
  const hasAlbum = new Set(albumKeys);
  for (const album of contents.albums) {
    count(summary.albums, hasAlbum, album.id);
    writes.push(tx.objectStore('albums').put(album));
  }
  await Promise.all([...writes, tx.done]);
  void requestPersistenceOnce();
  return summary;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** A plain-language account of a restore, for the Library. */
export function describeRestore(summary: RestoreSummary): string {
  const parts: string[] = [];
  const kinds: [RestoreCounts, string, string][] = [
    [summary.signatures, 'signature', 'signatures'],
    [summary.compositions, 'composition', 'compositions'],
    [summary.albums, 'album', 'albums'],
  ];
  for (const [{ added, replaced }, one, many] of kinds) {
    if (added > 0 && replaced > 0) {
      parts.push(`${plural(added + replaced, one, many)} (${added} added, ${replaced} replaced)`);
    } else if (added > 0) {
      parts.push(`${plural(added, one, many)} added`);
    } else if (replaced > 0) {
      parts.push(`${plural(replaced, one, many)} replaced`);
    }
  }
  if (parts.length === 0) return 'The backup was empty, so nothing changed.';
  return `Backup restored: ${parts.join('; ')}.`;
}
