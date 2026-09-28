/**
 * The library database (SPEC 11.1): IndexedDB via idb.
 *
 * Stores (database `synesthesia`, version 1):
 * - `signatures`     KineticSignature by id
 * - `signatureMeta`  SignatureMeta by id: name, dates, hash, size and thumbnail, so the
 *                    Library can list signatures without loading their fields
 * - `compositions`   Composition by id, indexed by signature id and signature hash
 * - `albums`         album records by id (Milestone 7)
 * - `clips`          optional source clips (unused in v0)
 * - `settings`       app settings, one entry per setting (see settings.ts)
 * - `workingState`   Studio autosave and other working state, by key
 *
 * A schema change bumps DB_VERSION and adds an `if (oldVersion < n)` step to `upgrade`.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Composition } from '../engine/composition';
import type { KineticSignature } from '../signature/types';
import { LibraryError, MESSAGES, errorDetail } from './errors';
import type { SignatureMeta, StoredAlbum, StoredClip } from './types';

export const DB_NAME = 'synesthesia';
export const DB_VERSION = 1;

export interface LibrarySchema extends DBSchema {
  signatures: { key: string; value: KineticSignature };
  signatureMeta: { key: string; value: SignatureMeta; indexes: { byContentHash: string } };
  compositions: {
    key: string;
    value: Composition;
    indexes: { bySignatureId: string; bySignatureHash: string };
  };
  albums: { key: string; value: StoredAlbum };
  clips: { key: string; value: StoredClip };
  settings: { key: string; value: unknown };
  workingState: { key: string; value: unknown };
}

export type LibraryDatabase = IDBPDatabase<LibrarySchema>;

export const STORE_NAMES = [
  'signatures',
  'signatureMeta',
  'compositions',
  'albums',
  'clips',
  'settings',
  'workingState',
] as const;

let dbPromise: Promise<LibraryDatabase> | null = null;

function open(): Promise<LibraryDatabase> {
  return openDB<LibrarySchema>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('signatures', { keyPath: 'id' });
        const meta = db.createObjectStore('signatureMeta', { keyPath: 'id' });
        meta.createIndex('byContentHash', 'contentHash');
        const compositions = db.createObjectStore('compositions', { keyPath: 'id' });
        compositions.createIndex('bySignatureId', 'signature.id');
        compositions.createIndex('bySignatureHash', 'signature.contentHash');
        db.createObjectStore('albums', { keyPath: 'id' });
        db.createObjectStore('clips', { keyPath: 'id' });
        db.createObjectStore('settings');
        db.createObjectStore('workingState');
      }
    },
    blocking() {
      // A newer version of the app wants to upgrade the database (another tab): let it.
      const current = dbPromise;
      dbPromise = null;
      void current?.then((db) => db.close());
    },
    terminated() {
      dbPromise = null;
    },
  });
}

/** The shared database connection (opened on first use). */
export function openLibraryDb(): Promise<LibraryDatabase> {
  if (!dbPromise) {
    dbPromise = open().catch((err: unknown) => {
      dbPromise = null;
      if (err instanceof DOMException && err.name === 'VersionError') {
        throw new LibraryError(MESSAGES.versionChanged, errorDetail(err));
      }
      throw new LibraryError(MESSAGES.unavailable, errorDetail(err));
    });
  }
  return dbPromise;
}

/** Close the shared connection (tests and harness pages). */
export async function closeLibraryDb(): Promise<void> {
  const current = dbPromise;
  dbPromise = null;
  if (current) (await current).close();
}
