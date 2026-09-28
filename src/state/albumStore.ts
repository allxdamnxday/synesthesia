/**
 * Album list state (Zustand): the albums the Library shows, with their counts, and the
 * actions that change them. Actions throw on failure (LibraryError carries a
 * plain-language message; see userMessage()); the screen decides how to show them.
 */
import { create } from 'zustand';
import {
  LibraryError,
  deleteAlbum,
  errorDetail,
  exportAlbumFiles,
  getAlbum,
  listAlbums,
  renameAlbum,
  userMessage,
  type Album,
  type AlbumSummary,
} from '../library';
import { MESSAGES } from '../library/errors';

export type AlbumListStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface AlbumListState {
  status: AlbumListStatus;
  error: string | null;
  /** Most recently changed first (the album or any of its tracks). */
  albums: AlbumSummary[];
  refresh: () => Promise<void>;
  rename: (id: string, title: string) => Promise<Album>;
  /** Compositions stay unless `deleteCompositions` (the person chose it explicitly). */
  remove: (id: string, deleteCompositions: boolean) => Promise<{ deletedCompositions: number }>;
  /** Download ALBUM_LOG.md and the .spalbum.json file; returns their names. */
  exportFiles: (id: string) => Promise<{ logFileName: string; albumFileName: string }>;
}

let refreshToken = 0;

export const useAlbumStore = create<AlbumListState>()((set, get) => {
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
    albums: [],

    async refresh() {
      const token = ++refreshToken;
      if (get().status !== 'ready') set({ status: 'loading', error: null });
      try {
        const albums = await listAlbums();
        if (token !== refreshToken) return;
        set({ status: 'ready', error: null, albums });
      } catch (err) {
        if (token !== refreshToken) return;
        console.error('Album list refresh failed:', errorDetail(err));
        set({ status: 'error', error: userMessage(err) });
      }
    },

    rename: (id, title) => change(() => renameAlbum(id, title)),
    remove: (id, deleteCompositions) => change(() => deleteAlbum(id, { deleteCompositions })),
    async exportFiles(id) {
      const album = await getAlbum(id);
      if (!album) throw new LibraryError(MESSAGES.notFound, `album ${id}`);
      return exportAlbumFiles(album);
    },
  };
});
