/**
 * Library state (Zustand): the signature and composition lists the Library screen shows,
 * and actions that call the library API and then refresh the lists.
 *
 * Actions throw on failure (with LibraryError / FileFormatError carrying plain-language
 * messages; see userMessage()); the screen decides how to show them.
 */
import { create } from 'zustand';
import type { Composition } from '../engine/composition';
import {
  LibraryError,
  deleteComposition,
  deleteSignature,
  downloadBackup,
  duplicateComposition,
  duplicateSignature,
  errorDetail,
  exportCompositionFile,
  exportSignatureFile,
  getComposition,
  getSettings,
  getSignature,
  importLibraryFile,
  importSignatureFile,
  listCompositions,
  listSignatureMeta,
  renameComposition,
  renameSignature,
  restoreBackup,
  userMessage,
  type LibraryImportResult,
  type PersistenceState,
  type RestoreSummary,
  type SignatureImportResult,
  type SignatureMeta,
} from '../library';
import { MESSAGES } from '../library/errors';

export interface CompositionEntry {
  composition: Composition;
  /** The library has its signature (by id, or the same movement under another id). */
  signatureAvailable: boolean;
}

export type LibraryStatus = 'idle' | 'loading' | 'ready' | 'error';

export type ImportOutcome =
  | { ok: true; fileName: string; result: LibraryImportResult }
  | { ok: false; fileName: string; message: string };

export interface LibraryState {
  status: LibraryStatus;
  /** Why the library couldn't be read (plain language), when status is 'error'. */
  error: string | null;
  /** Most recently changed first. */
  signatures: SignatureMeta[];
  /** Most recently changed first. */
  compositions: CompositionEntry[];
  /** Signature id → number of compositions that reference it. */
  usage: Readonly<Record<string, number>>;
  persistence: PersistenceState;

  /** Reload the lists from the library. */
  refresh: () => Promise<void>;
  renameSignature: (id: string, name: string) => Promise<SignatureMeta>;
  duplicateSignature: (id: string) => Promise<SignatureMeta>;
  /** Returns how many compositions moved to an identical copy of the signature. */
  deleteSignature: (id: string) => Promise<{ moved: number }>;
  /** Download the signature file; returns its file name. */
  exportSignature: (id: string) => Promise<string>;
  renameComposition: (id: string, name: string) => Promise<Composition>;
  duplicateComposition: (id: string) => Promise<Composition>;
  deleteComposition: (id: string) => Promise<void>;
  /** Download the composition file; returns its file name. */
  exportComposition: (id: string) => Promise<string>;
  /** Import signature and composition files one by one; never throws. */
  importFiles: (files: readonly File[]) => Promise<ImportOutcome[]>;
  /** Import the signature a composition is waiting for (must hold the same movement). */
  importSignatureFor: (
    file: File,
    needed: Composition['signature'],
  ) => Promise<SignatureImportResult>;
  backUp: () => Promise<{ fileName: string; bytes: number }>;
  restore: (file: File) => Promise<RestoreSummary>;
}

let refreshToken = 0;

export const useLibraryStore = create<LibraryState>()((set, get) => {
  /** Run a change, then refresh the lists whether or not it worked. */
  const change = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } finally {
      await get().refresh();
    }
  };

  return {
    status: 'idle',
    error: null,
    signatures: [],
    compositions: [],
    usage: {},
    persistence: 'not-asked',

    async refresh() {
      const token = ++refreshToken;
      if (get().status !== 'ready') set({ status: 'loading', error: null });
      try {
        const [signatures, compositions, settings] = await Promise.all([
          listSignatureMeta(),
          listCompositions(),
          getSettings(),
        ]);
        if (token !== refreshToken) return;
        const ids = new Set(signatures.map((s) => s.id));
        const hashes = new Set(signatures.map((s) => s.contentHash));
        const usage: Record<string, number> = {};
        for (const c of compositions) usage[c.signature.id] = (usage[c.signature.id] ?? 0) + 1;
        set({
          status: 'ready',
          error: null,
          signatures,
          compositions: compositions.map((composition) => ({
            composition,
            signatureAvailable:
              ids.has(composition.signature.id) || hashes.has(composition.signature.contentHash),
          })),
          usage,
          persistence: settings.persistence,
        });
      } catch (err) {
        if (token !== refreshToken) return;
        console.error('Library refresh failed:', errorDetail(err));
        set({ status: 'error', error: userMessage(err) });
      }
    },

    renameSignature: (id, name) => change(() => renameSignature(id, name)),
    duplicateSignature: (id) => change(() => duplicateSignature(id)),
    deleteSignature: (id) => change(() => deleteSignature(id)),
    async exportSignature(id) {
      const sig = await getSignature(id);
      if (!sig) throw new LibraryError(MESSAGES.notFound, `signature ${id}`);
      return exportSignatureFile(sig);
    },

    renameComposition: (id, name) => change(() => renameComposition(id, name)),
    duplicateComposition: (id) => change(() => duplicateComposition(id)),
    deleteComposition: (id) => change(() => deleteComposition(id)),
    async exportComposition(id) {
      const c = await getComposition(id);
      if (!c) throw new LibraryError(MESSAGES.notFound, `composition ${id}`);
      return exportCompositionFile(c);
    },

    importFiles: (files) =>
      change(async () => {
        const outcomes: ImportOutcome[] = [];
        // Signatures first, so compositions imported alongside them find them.
        const isSignature = (f: File) => /\.sig\.json$/i.test(f.name);
        const ordered = [...files.filter(isSignature), ...files.filter((f) => !isSignature(f))];
        for (const file of ordered) {
          try {
            outcomes.push({ ok: true, fileName: file.name, result: await importLibraryFile(file) });
          } catch (err) {
            console.warn(`Import of ${file.name} failed:`, errorDetail(err));
            outcomes.push({ ok: false, fileName: file.name, message: userMessage(err) });
          }
        }
        return outcomes;
      }),
    importSignatureFor: (file, needed) =>
      change(() => importSignatureFile(file, { expectContentHash: needed.contentHash })),

    backUp: () => downloadBackup(),
    restore: (file) => change(() => restoreBackup(file)),
  };
});
