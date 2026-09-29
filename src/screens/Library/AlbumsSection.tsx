import { useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { navigate } from '../../app/router';
import { errorDetail, userMessage, type AlbumSummary } from '../../library';
import { useAlbumStore } from '../../state/albumStore';
import { useLibraryStore } from '../../state/libraryStore';
import { Button } from '../../ui/Button';
import { Notice, type NoticeTone } from '../../ui/Notice';
import { DeleteAlbumDialog } from '../Album/DeleteAlbumDialog';
import { countOf, formatChanged } from './format';
import { signatureName } from './importSummary';
import { LibraryCard } from './LibraryCard';
import styles from './LibraryScreen.module.css';

export interface AlbumsSectionProps {
  /** Show a notice in the Library's notice area. */
  notify: (tone: NoticeTone, text: string) => void;
  /** Run an action under the Library's busy label; failures become a notice. */
  run: <T>(label: string, task: () => Promise<T>) => Promise<T | undefined>;
  busy: boolean;
}

const albumTitle = (title: string) => title || 'Untitled album';

/**
 * The Library's Albums list (SPEC 6.1): each album's title, signature, track and kept
 * counts, and when it last changed (the album or any of its tracks). The Library screen
 * keeps the album store fresh.
 */
export function AlbumsSection({ notify, run, busy }: AlbumsSectionProps) {
  const { status, error, albums } = useAlbumStore(
    useShallow((s) => ({ status: s.status, error: s.error, albums: s.albums })),
  );
  const refresh = useAlbumStore((s) => s.refresh);
  const store = useAlbumStore.getState;
  const signatures = useLibraryStore((s) => s.signatures);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [pending, setPending] = useState<AlbumSummary | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const thumbnailFor = (summary: AlbumSummary): string | undefined => {
    if (summary.thumbnail) return summary.thumbnail;
    const { id, contentHash } = summary.album.signature;
    const sig =
      signatures.find((m) => m.id === id) ?? signatures.find((m) => m.contentHash === contentHash);
    return sig?.thumbnail || undefined;
  };

  const rename = (id: string, title: string) => {
    store()
      .rename(id, title)
      .catch((err: unknown) => {
        console.error(errorDetail(err));
        notify('error', userMessage(err));
      });
  };

  const exportLog = async (id: string) => {
    const files = await run('Exporting…', () => store().exportFiles(id));
    if (files) {
      notify(
        'success',
        `Saved “${files.logFileName}” and “${files.albumFileName}” to your downloads.`,
      );
    }
  };

  const confirmDelete = async (deleteCompositions: boolean) => {
    if (!pending) return;
    const title = albumTitle(pending.album.title);
    const result = await run('Deleting…', () =>
      store().remove(pending.album.id, deleteCompositions),
    );
    setPending(null);
    if (!result) return;
    await useLibraryStore.getState().refresh();
    notify(
      'info',
      deleteCompositions
        ? `Deleted the album “${title}” and ${countOf(result.deletedCompositions, 'composition', 'compositions')}.`
        : `Deleted the album “${title}”. Its compositions are still in your library.`,
    );
    headingRef.current?.focus();
  };

  return (
    <section className={styles.section} aria-labelledby="albums-heading">
      <div className={styles.sectionHead}>
        <h2 id="albums-heading" ref={headingRef} tabIndex={-1}>
          Albums
        </h2>
        <span className={styles.count}>{albums.length}</span>
      </div>
      {status === 'error' ? (
        <Notice tone="error" actions={<Button onClick={() => void refresh()}>Try again</Button>}>
          {error}
        </Notice>
      ) : null}
      {albums.length === 0 ? (
        status === 'ready' ? (
          <p className={styles.sectionEmpty}>
            No albums yet. Choose New album on a signature to let chance draw a set of compositions
            from it.
          </p>
        ) : null
      ) : (
        <ul className={styles.grid} aria-labelledby="albums-heading">
          {albums.map((summary) => {
            const { album, counts } = summary;
            const title = albumTitle(album.title);
            return (
              <LibraryCard
                key={album.id}
                name={title}
                thumbnail={thumbnailFor(summary)}
                details={[
                  `From “${signatureName(album.signature.name)}” · ${countOf(album.compositionIds.length, 'track', 'tracks')}`,
                  `${counts.kept} kept · Changed ${formatChanged(summary.lastChanged)}`,
                ]}
                renaming={renaming === album.id}
                onOpen={() => navigate(`/album/${encodeURIComponent(album.id)}`)}
                onRename={(next) => rename(album.id, next)}
                onRenameEnd={() => setRenaming(null)}
                menu={[
                  { label: 'Rename', onSelect: () => setRenaming(album.id) },
                  { label: 'Export album log', onSelect: () => void exportLog(album.id) },
                  { label: 'Delete', tone: 'danger', onSelect: () => setPending(summary) },
                ]}
              />
            );
          })}
        </ul>
      )}
      <DeleteAlbumDialog
        album={
          pending
            ? {
                id: pending.album.id,
                title: albumTitle(pending.album.title),
                trackCount: pending.album.compositionIds.length - pending.counts.missing,
              }
            : null
        }
        busy={busy}
        onConfirm={(deleteCompositions) => void confirmDelete(deleteCompositions)}
        onCancel={() => setPending(null)}
      />
    </section>
  );
}
