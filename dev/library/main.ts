/**
 * Library storage harness: the library API on `window.lib`, for Playwright
 * (tests/e2e/library-storage.spec.ts). Everything returns plain, serializable data;
 * blobs (backups) stay in this page and are referred to indirectly.
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import {
  DEFAULT_RENDER_SETTINGS,
  defaultTimeline,
  type Composition,
} from '../../src/engine/composition';
import { serializeComposition } from '../../src/engine/compositionSerialize';
import * as lib from '../../src/library';
import { STORE_NAMES } from '../../src/library/db';
import { computeContentHash } from '../../src/signature/hash';
import { decodeField } from '../../src/signature/fieldCodec';
import {
  parseSignature,
  serializeSignature,
  verifySignatureHash,
} from '../../src/signature/serialize';

type Outcome<T> = { ok: true; value: T } | { ok: false; name: string; message: string };

async function attempt<T>(fn: () => Promise<T>): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    return { ok: false, name: e.name, message: e.message };
  }
}

function jsonFile(text: string, name: string): File {
  return new File([text], name, { type: 'application/json' });
}

async function mustGetSignature(id: string) {
  const sig = await lib.getSignature(id);
  if (!sig) throw new Error(`No signature ${id}`);
  return sig;
}

let keptBackup: Blob | null = null;

const harness = {
  /** Empty every store (a fresh library). */
  async reset(): Promise<void> {
    const db = await lib.openLibraryDb();
    const tx = db.transaction(STORE_NAMES, 'readwrite');
    await Promise.all([...STORE_NAMES.map((name) => tx.objectStore(name).clear()), tx.done]);
  },
  async snapshot() {
    const db = await lib.openLibraryDb();
    return {
      signatures: await lib.listSignatureMeta(),
      compositions: await lib.listCompositions(),
      albums: await db.getAll('albums'),
    };
  },
  saveSignatureText: (text: string) => lib.saveSignature(parseSignature(text)),
  getSignature: (id: string) => lib.getSignature(id),
  listSignatureMeta: () => lib.listSignatureMeta(),
  renameSignature: (id: string, name: string) => lib.renameSignature(id, name),
  duplicateSignature: (id: string) => lib.duplicateSignature(id),
  deleteSignature: (id: string) => lib.deleteSignature(id),
  countCompositionsForSignature: (id: string) => lib.countCompositionsForSignature(id),
  async verifyHash(id: string): Promise<boolean> {
    return verifySignatureHash(await mustGetSignature(id));
  },
  async exportSignatureById(id: string): Promise<string> {
    return lib.exportSignatureFile(await mustGetSignature(id));
  },
  importSignatureText: (text: string, name = 'import.sig.json', expectContentHash?: string) =>
    attempt(() => lib.importSignatureFile(jsonFile(text, name), { expectContentHash })),
  importLibraryText: (text: string, name = 'import.json') =>
    attempt(() => lib.importLibraryFile(jsonFile(text, name))),
  /** Same id, different movement, valid hash: a different signature claiming the id. */
  async forkSignatureText(text: string): Promise<string> {
    const sig = parseSignature(text);
    sig.features.energy = sig.features.energy.map((v) => v * 1.5);
    sig.contentHash = await computeContentHash({
      frameRate: sig.frameRate,
      frameCount: sig.frameCount,
      grid: sig.grid,
      field: decodeField(sig.field.data),
      features: sig.features,
    });
    return serializeSignature(sig);
  },

  async saveCompositionFor(signatureId: string, name: string): Promise<Composition> {
    const sig = await mustGetSignature(signatureId);
    const now = new Date().toISOString();
    return lib.saveComposition({
      format: 'sp-composition',
      version: 1,
      id: crypto.randomUUID(),
      name,
      createdAt: now,
      updatedAt: now,
      signature: { id: sig.id, contentHash: sig.contentHash, name: sig.name },
      seed: 271828,
      timeline: defaultTimeline(sig.preferredSpeed),
      linked: true,
      visual: { materialId: 'water', materialVersion: 1, properties: { viscosity: 0.4 } },
      sound: { materialId: 'water', materialVersion: 1, properties: { brightness: 0.7 } },
      mute: { visual: false, sound: false },
      chance: null,
      render: { ...DEFAULT_RENDER_SETTINGS },
      status: 'draft',
      notes: 'Harness composition.',
    });
  },
  getComposition: (id: string) => lib.getComposition(id),
  listCompositions: () => lib.listCompositions(),
  renameComposition: (id: string, name: string) => lib.renameComposition(id, name),
  duplicateComposition: (id: string) => lib.duplicateComposition(id),
  deleteComposition: (id: string) => lib.deleteComposition(id),
  async compositionText(id: string): Promise<string> {
    const c = await lib.getComposition(id);
    if (!c) throw new Error(`No composition ${id}`);
    return serializeComposition(c);
  },
  importCompositionText: (text: string, name = 'import.spcomp.json') =>
    attempt(() => lib.importCompositionFile(jsonFile(text, name))),
  async signatureIdForComposition(id: string): Promise<string | null> {
    const c = await lib.getComposition(id);
    if (!c) return null;
    return (await lib.findSignatureForComposition(c))?.id ?? null;
  },

  async putAlbum(album: lib.StoredAlbum): Promise<void> {
    await (await lib.openLibraryDb()).put('albums', album);
  },

  /** Build a backup and keep it in this page. */
  async createBackupKept(): Promise<{ bytes: number; entries: string[] }> {
    keptBackup = await lib.createBackup();
    const entries = Object.keys(unzipSync(new Uint8Array(await keptBackup.arrayBuffer())));
    return { bytes: keptBackup.size, entries: entries.sort() };
  },
  restoreKept: () =>
    attempt(async () => {
      if (!keptBackup) throw new Error('No backup kept');
      return lib.restoreBackup(keptBackup);
    }),
  /** The kept backup with one signature's movement data altered (hash no longer matches). */
  restoreTampered: () =>
    attempt(async () => {
      if (!keptBackup) throw new Error('No backup kept');
      const entries = unzipSync(new Uint8Array(await keptBackup.arrayBuffer()));
      const path = Object.keys(entries).find((p) => p.startsWith('signatures/'));
      if (!path) throw new Error('No signature in the kept backup');
      const text = strFromU8(entries[path]).replace(/"energy": \[(\d)/, '"energy": [1$1');
      entries[path] = strToU8(text);
      return lib.restoreBackup(new Blob([zipSync(entries)]));
    }),
  restoreNotABackup: () => attempt(() => lib.restoreBackup(new Blob(['not a zip']))),

  getSettings: () => lib.getSettings(),
  setSetting: <K extends keyof lib.AppSettings>(key: K, value: lib.AppSettings[K]) =>
    lib.setSetting(key, value),
  storageEstimate: () => lib.storageEstimate(),
};

declare global {
  interface Window {
    lib: typeof harness;
  }
}

window.lib = harness;
const status = document.getElementById('status');
if (status) status.textContent = 'Ready.';
document.body.dataset.ready = 'true';
