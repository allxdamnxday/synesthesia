/**
 * Album harness, for Playwright (tests/e2e/album.spec.ts):
 * - `window.albumLib`: the album library API against this browser's real IndexedDB
 *   (plain, serializable results; errors come back as `{ ok: false, message }`);
 * - a Batch render panel driven by a stand-in renderer, so the batch UI (progress, pause,
 *   cancel, failures, summary, folder writes) can be tested before MP4 rendering lands.
 *   The "folder" is a directory in the origin-private file system.
 * It uses this browser's real Synesthesia library, so run it in a fresh profile.
 */
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import '../../src/app/tokens.css';
import '../../src/app/global.css';
import { trackName, type AlbumSettings } from '../../src/chance/album';
import type { CompositionStatus } from '../../src/engine/composition';
import * as lib from '../../src/library';
import { STORE_NAMES } from '../../src/library/db';
import { useBatchStore } from '../../src/screens/Album/batch/batchStore';
import { BatchRenderPanel } from '../../src/screens/Album/batch/BatchRenderPanel';
import { writeToFolder } from '../../src/screens/Album/batch/folder';
import {
  TrackRenderError,
  type RenderDestination,
  type RenderOneFn,
} from '../../src/screens/Album/batch/renderTracks';
import { parseSignature } from '../../src/signature/serialize';

type Outcome<T> = { ok: true; value: T } | { ok: false; name: string; message: string };

async function attempt<T>(fn: () => Promise<T>): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    return { ok: false, name: e.name, message: e.message };
  }
}

interface FakeRenderOptions {
  /** Frames per track, each `frameMs` long. */
  frames: number;
  frameMs: number;
  /** Track names ("03") whose render fails halfway. */
  fail: string[];
}

const FOLDER = 'album-renders';
const calls: string[] = [];
const recorded: Array<{ albumId: string; compositionId: string; fileName: string }> = [];

async function folderHandle(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(FOLDER, { create: true });
}

async function fakeFolder(): Promise<RenderDestination> {
  return { kind: 'folder', name: 'Album renders', handle: await folderHandle() };
}

function fakeRenderer(options: FakeRenderOptions): RenderOneFn {
  return async (request) => {
    const { composition } = request;
    calls.push(composition.name);
    for (let f = 0; f < options.frames; f++) {
      await request.checkpoint();
      await new Promise((resolve) => setTimeout(resolve, options.frameMs));
      if (request.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      if (options.fail.includes(composition.name) && f === Math.floor(options.frames / 2)) {
        throw new TrackRenderError('The video encoder stopped. Try the 720p size.', 'stand-in');
      }
      request.onProgress((f + 1) / options.frames);
    }
    const seed = String(composition.seed).padStart(6, '0');
    const fileName = `SP_Sample-wink_${composition.name}_${seed}.mp4`;
    if (request.destination.kind === 'folder') {
      await writeToFolder(request.destination.handle, fileName, new Blob(['not really a video']));
    }
    return { fileName };
  };
}

const DEFAULT_SETTINGS: Omit<AlbumSettings, 'visualPool' | 'soundPool'> = {
  title: 'Harness album',
  trackCount: 5,
  masterSeed: 314159,
  openCount: 2,
  strategy: 'grid',
  chooseValues: false,
};

let showPanel: (view: { albumId: string; options: FakeRenderOptions } | null) => void = () =>
  undefined;

const albumLib = {
  /** Empty every store, the stand-in folder and any finished batch. */
  async reset(): Promise<void> {
    const db = await lib.openLibraryDb();
    const tx = db.transaction(STORE_NAMES, 'readwrite');
    await Promise.all([...STORE_NAMES.map((name) => tx.objectStore(name).clear()), tx.done]);
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(FOLDER, { recursive: true }).catch(() => undefined);
    calls.length = 0;
    recorded.length = 0;
    useBatchStore.getState().dismiss();
    useBatchStore.getState().setDestination(null);
    showPanel(null);
  },
  saveSignatureText: (text: string) => lib.saveSignature(parseSignature(text)),
  async createAlbum(signatureId: string, settings: Partial<AlbumSettings> = {}) {
    const signature = await lib.getSignature(signatureId);
    if (!signature) throw new Error(`No signature ${signatureId}`);
    const pools = lib.defaultPools(lib.installedMaterials());
    return lib.createAlbumFromPlan(signature, { ...DEFAULT_SETTINGS, ...pools, ...settings });
  },
  getAlbumWithTracks: (id: string) => lib.getAlbumWithTracks(id),
  listAlbums: () => lib.listAlbums(),
  setTrackStatus: (id: string, status: CompositionStatus) => lib.setTrackStatus(id, status),
  setAlbumRender: (albumId: string, compositionId: string, fileName: string) =>
    attempt(() => lib.setAlbumRender(albumId, compositionId, fileName)),
  async albumText(id: string): Promise<string> {
    const album = await lib.getAlbum(id);
    if (!album) throw new Error(`No album ${id}`);
    return lib.serializeAlbum(album);
  },
  importAlbumText: (text: string) =>
    attempt(() =>
      lib.importAlbumFile(new File([text], 'album.spalbum.json', { type: 'application/json' })),
    ),
  deleteAlbum: (id: string, deleteCompositions: boolean) =>
    lib.deleteAlbum(id, { deleteCompositions }),
  async compositionCount(): Promise<number> {
    return (await lib.listCompositions()).length;
  },
  /** Back up, empty the library, restore: what comes back. */
  async backupAndRestore() {
    const backup = await lib.createBackup();
    const entries = Object.keys(unzipSync(new Uint8Array(await backup.arrayBuffer()))).sort();
    const db = await lib.openLibraryDb();
    const tx = db.transaction(STORE_NAMES, 'readwrite');
    await Promise.all([...STORE_NAMES.map((name) => tx.objectStore(name).clear()), tx.done]);
    const summary = await lib.restoreBackup(backup);
    return { entries, summary };
  },
  /** A backup whose album has an impossible master seed: refused, nothing written. */
  async restoreDamagedAlbum() {
    const backup = await lib.createBackup();
    const files = unzipSync(new Uint8Array(await backup.arrayBuffer()));
    const path = Object.keys(files).find((p) => p.startsWith('albums/'));
    if (!path) throw new Error('No album in the backup');
    const album = JSON.parse(strFromU8(files[path])) as { settings: { masterSeed: unknown } };
    album.settings.masterSeed = 'lots';
    files[path] = strToU8(JSON.stringify(album));
    const before = (await lib.listCompositions()).length;
    const outcome = await attempt(() => lib.restoreBackup(new Blob([zipSync(files)])));
    return { outcome, unchanged: (await lib.listCompositions()).length === before };
  },
  /** Show the Batch render panel for an album, rendering with the stand-in renderer. */
  show(albumId: string, options: FakeRenderOptions): void {
    showPanel({ albumId, options });
  },
  calls: () => [...calls],
  recorded: () => [...recorded],
  async folderFiles(): Promise<string[]> {
    const handle = (await folderHandle()) as unknown as { keys(): AsyncIterable<string> };
    const names: string[] = [];
    for await (const name of handle.keys()) names.push(name);
    return names.sort();
  },
};

declare global {
  interface Window {
    albumLib: typeof albumLib;
  }
}

function Harness() {
  const [view, setView] = useState<{ albumId: string; options: FakeRenderOptions } | null>(null);
  const [data, setData] = useState<lib.AlbumWithTracks | null>(null);

  useEffect(() => {
    showPanel = setView;
    return () => {
      showPanel = () => undefined;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!view) {
      setData(null);
      return;
    }
    void lib.getAlbumWithTracks(view.albumId).then((loaded) => {
      if (!cancelled) setData(loaded ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [view]);

  if (!view || !data) return <p style={{ color: 'var(--color-mist)' }}>No panel shown.</p>;
  const total = data.album.compositionIds.length;
  const tracks = data.tracks.flatMap((composition, i) =>
    composition ? [{ number: trackName(i + 1, total), composition }] : [],
  );
  return (
    <BatchRenderPanel
      album={data.album}
      tracks={tracks}
      renderOne={fakeRenderer(view.options)}
      onClose={() => setView(null)}
      chooseFolder={fakeFolder}
      folderAvailable
      recordRender={async (albumId, compositionId, fileName) => {
        recorded.push({ albumId, compositionId, fileName });
        return lib.setAlbumRender(albumId, compositionId, fileName);
      }}
    />
  );
}

window.albumLib = albumLib;
const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');
createRoot(root).render(
  <StrictMode>
    <main style={{ padding: 32, maxWidth: 960, margin: '0 auto', display: 'grid', gap: 16 }}>
      <h1>Album harness</h1>
      <p style={{ color: 'var(--color-mist)' }}>
        Exposes the album library as <code>window.albumLib</code> and a Batch render panel with a
        stand-in renderer for <code>tests/e2e/album.spec.ts</code>. Uses this browser&apos;s real
        library: run it in a fresh profile.
      </p>
      <Harness />
    </main>
  </StrictMode>,
);
document.body.dataset.ready = 'true';
