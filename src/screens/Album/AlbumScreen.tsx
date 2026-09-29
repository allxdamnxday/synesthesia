import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { href, navigate } from '../../app/router';
import { trackName } from '../../chance/album';
import type { Composition, CompositionStatus } from '../../engine/composition';
import {
  countTracks,
  deleteAlbum,
  errorDetail,
  exportAlbumFiles,
  getAlbumWithTracks,
  renameAlbum,
  setTrackNotes,
  setTrackStatus,
  userMessage,
  type AlbumWithTracks,
} from '../../library';
import { ActionMenu } from '../../ui/ActionMenu';
import { Button } from '../../ui/Button';
import { GuideLink } from '../../ui/GuideLink';
import { InlineRename } from '../../ui/InlineRename';
import { Notice, type NoticeTone } from '../../ui/Notice';
import { signatureName } from '../Library/importSummary';
import { useBatchStore } from './batch/batchStore';
import { BatchRenderPanel, type BatchTrackEntry } from './batch/BatchRenderPanel';
import { renderOneTrack } from './batch/renderOne';
import { DeleteAlbumDialog } from './DeleteAlbumDialog';
import { albumRecipe, countsLine } from './format';
import { TrackRow } from './TrackRow';
import styles from './AlbumScreen.module.css';

type Loaded =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: AlbumWithTracks };

interface NoticeItem {
  id: number;
  tone: NoticeTone;
  text: string;
}

/**
 * An album (SPEC 6.4, 12.3): its recipe, its tracks to work through (status, notes,
 * open in the Studio), batch render, and the album log. Nothing is deleted by default:
 * set-aside tracks stay in the album and its log.
 */
export function AlbumScreen({ params }: { params?: Record<string, string> }) {
  const albumId = params?.albumId ?? '';
  // A fresh screen per album, so nothing from the previous one lingers.
  return <AlbumView key={albumId} albumId={albumId} />;
}

function AlbumView({ albumId }: { albumId: string }) {
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const [notices, setNotices] = useState<NoticeItem[]>([]);
  const [renaming, setRenaming] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const noticeCount = useRef(0);
  const batch = useBatchStore(
    useShallow((s) => ({ albumId: s.albumId, phase: s.phase, tracks: s.tracks })),
  );

  const load = useCallback(async () => {
    try {
      const data = await getAlbumWithTracks(albumId);
      setLoaded(data ? { status: 'ready', data } : { status: 'missing' });
    } catch (err) {
      console.error(errorDetail(err));
      setLoaded({ status: 'error', message: userMessage(err) });
    }
  }, [albumId]);

  // Load on arrival, and again when coming back to this window (the Studio or another
  // window may have changed a track meanwhile).
  useEffect(() => {
    void load();
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  const batchIsMine = batch.albumId === albumId && batch.phase !== 'idle';
  // When this album's batch finishes, show the files it recorded.
  useEffect(() => {
    if (batchIsMine && batch.phase === 'finished') void load();
  }, [batchIsMine, batch.phase, load]);

  const notify = (tone: NoticeTone, text: string) => {
    const id = ++noticeCount.current;
    setNotices((list) =>
      [{ id, tone, text }, ...list.filter((n) => n.tone === 'error')].slice(0, 3),
    );
  };
  const dismiss = (id: number) => setNotices((list) => list.filter((n) => n.id !== id));

  /** Put a saved (or restored) composition back into the list. */
  const replaceTrack = useCallback((next: Composition) => {
    setLoaded((current) =>
      current.status === 'ready'
        ? {
            ...current,
            data: {
              ...current.data,
              tracks: current.data.tracks.map((t) => (t?.id === next.id ? next : t)),
            },
          }
        : current,
    );
  }, []);

  const data = loaded.status === 'ready' ? loaded.data : null;

  const renders = useMemo(() => {
    const merged: Record<string, string> = { ...(data?.album.renders ?? {}) };
    if (batchIsMine) {
      for (const t of batch.tracks) if (t.fileName) merged[t.compositionId] = t.fileName;
    }
    return merged;
  }, [data, batchIsMine, batch.tracks]);

  if (loaded.status === 'loading') {
    return (
      <section className={styles.page}>
        <p className={styles.loading}>Opening the album…</p>
      </section>
    );
  }
  if (loaded.status === 'missing') {
    return (
      <section className={styles.page} aria-labelledby="album-title">
        <h1 id="album-title" className={styles.title}>
          Album not found
        </h1>
        <p className={styles.hint}>
          This album isn’t in your library. It may have been deleted in another window.{' '}
          <a href={href('/')}>Go to the library</a>.
        </p>
      </section>
    );
  }
  if (loaded.status === 'error') {
    return (
      <section className={styles.page}>
        <Notice tone="error" actions={<Button onClick={() => void load()}>Try again</Button>}>
          {loaded.message}
        </Notice>
      </section>
    );
  }

  const { album, tracks, signatureAvailable } = loaded.data;
  const total = album.compositionIds.length;
  const counts = countTracks(tracks);
  const present: BatchTrackEntry[] = [];
  tracks.forEach((c, i) => {
    if (c) present.push({ number: trackName(i + 1, total), composition: c });
  });
  const showBatch = batchOpen || batchIsMine;

  const changeStatus = async (track: Composition, status: CompositionStatus) => {
    if (track.status === status) return;
    replaceTrack({ ...track, status });
    try {
      replaceTrack(await setTrackStatus(track.id, status));
    } catch (err) {
      console.error(errorDetail(err));
      replaceTrack(track);
      notify('error', userMessage(err));
    }
  };

  const saveNotes = async (track: Composition, notes: string) => {
    try {
      replaceTrack(await setTrackNotes(track.id, notes));
    } catch (err) {
      console.error(errorDetail(err));
      throw err;
    }
  };

  const rename = async (title: string) => {
    try {
      const next = await renameAlbum(album.id, title);
      setLoaded((current) =>
        current.status === 'ready'
          ? { ...current, data: { ...current.data, album: next } }
          : current,
      );
    } catch (err) {
      console.error(errorDetail(err));
      notify('error', userMessage(err));
    }
  };

  const exportLog = async () => {
    setBusy('Exporting…');
    try {
      const files = await exportAlbumFiles(album);
      notify(
        'success',
        `Saved “${files.logFileName}” and “${files.albumFileName}” to your downloads.`,
      );
    } catch (err) {
      console.error(errorDetail(err));
      notify('error', userMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const confirmDelete = async (deleteCompositions: boolean) => {
    setBusy('Deleting…');
    try {
      await deleteAlbum(album.id, { deleteCompositions });
      setDeleting(false);
      navigate('/');
    } catch (err) {
      console.error(errorDetail(err));
      setDeleting(false);
      notify('error', userMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={styles.page} aria-labelledby="album-title">
      <div className={styles.topRow}>
        <nav className={styles.crumbs} aria-label="Breadcrumb">
          <a href={href('/')}>Library</a>
          <span aria-hidden="true"> / </span>
          <span>Album</span>
        </nav>
        <GuideLink section="albums" />
      </div>

      <header className={styles.header}>
        <div className={styles.heading}>
          <h1 id="album-title" className={styles.title}>
            {renaming ? (
              <InlineRename
                value={album.title}
                label={`New title for ${album.title}`}
                className={styles.renameInput}
                onCommit={(next) => {
                  setRenaming(false);
                  void rename(next);
                }}
                onCancel={() => setRenaming(false)}
              />
            ) : (
              album.title
            )}
          </h1>
          <p className={styles.recipe}>
            {albumRecipe(album, signatureName(album.signature.name)).join(' · ')}
          </p>
          <p className={styles.counts} data-testid="album-counts">
            {countsLine(counts)}
          </p>
          {album.note ? <p className={styles.note}>{album.note}</p> : null}
        </div>
        <div className={styles.actions}>
          {busy ? (
            <span className={styles.busy} role="status">
              {busy}
            </span>
          ) : null}
          <Button onClick={() => void exportLog()} disabled={busy !== null}>
            Export album log
          </Button>
          <Button onClick={() => setBatchOpen(true)} disabled={showBatch} aria-expanded={showBatch}>
            Batch render
          </Button>
          <ActionMenu
            label={`More actions for ${album.title}`}
            items={[
              { label: 'Rename', onSelect: () => setRenaming(true) },
              { label: 'Delete album', tone: 'danger', onSelect: () => setDeleting(true) },
            ]}
          />
        </div>
      </header>

      <ol className={styles.loop} aria-label="Working through the album">
        <li>
          Choose <strong>Open in Studio</strong> on a track and play its open properties. The rest
          stay at their baseline; unlocking one is recorded.
        </li>
        <li>
          Mark the track <strong>Kept</strong> or <strong>Set aside</strong>, with notes if you
          like. Set-aside tracks stay in the album and its log.
        </li>
        <li>
          <strong>Batch render</strong> makes videos of the tracks you choose (the kept ones to
          start with); <strong>Export album log</strong> saves the written record.
        </li>
      </ol>

      {signatureAvailable ? null : (
        <Notice tone="warning">
          This album’s signature, “{signatureName(album.signature.name)}”, isn’t in your library, so
          its tracks can’t play. Import that signature file in the Library to bring them back.
        </Notice>
      )}

      <div className={styles.notices} role="status" aria-live="polite">
        {notices.map((n) => (
          <Notice key={n.id} tone={n.tone} onDismiss={() => dismiss(n.id)}>
            {n.text}
          </Notice>
        ))}
      </div>

      {showBatch ? (
        <BatchRenderPanel
          album={album}
          tracks={present}
          renderOne={renderOneTrack}
          onClose={() => setBatchOpen(false)}
        />
      ) : null}

      <section className={styles.tracksSection} aria-labelledby="tracks-heading">
        <h2 id="tracks-heading" className={styles.tracksHeading}>
          Tracks
        </h2>
        <ol className={styles.tracks} aria-labelledby="tracks-heading">
          {album.compositionIds.map((id, i) => {
            const track = tracks[i];
            const number = trackName(i + 1, total);
            return (
              <TrackRow
                key={id}
                number={number}
                composition={track}
                renderFile={renders[id]}
                onStatus={(status) => {
                  if (track) void changeStatus(track, status);
                }}
                onNotes={(notes) => (track ? saveNotes(track, notes) : Promise.resolve())}
                onOpen={() => navigate(`/studio/${encodeURIComponent(id)}`)}
              />
            );
          })}
        </ol>
      </section>

      <DeleteAlbumDialog
        album={deleting ? { id: album.id, title: album.title, trackCount: present.length } : null}
        busy={busy !== null}
        onConfirm={(deleteCompositions) => void confirmDelete(deleteCompositions)}
        onCancel={() => setDeleting(false)}
      />
    </section>
  );
}
