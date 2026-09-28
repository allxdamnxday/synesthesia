import { useEffect, useId, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { href } from '../../../app/router';
import type { Album } from '../../../chance/albumModel';
import type { Composition } from '../../../engine/composition';
import { errorDetail, getSetting, materialName, setSetting, userMessage } from '../../../library';
import type { KineticSignature } from '../../../signature/types';
import { Button } from '../../../ui/Button';
import { Checkbox } from '../../../ui/Checkbox';
import { Notice } from '../../../ui/Notice';
import { Toggle } from '../../../ui/Toggle';
import { countOf } from '../../Library/format';
import { formatElapsed, formatRemaining, statusLabel } from '../format';
import { useBatchStore, type BatchTrack } from './batchStore';
import { canChooseFolder, chooseRenderFolder, ensureWritable } from './folder';
import type { RenderDestination, RenderOneFn } from './renderTracks';
import styles from './BatchRenderPanel.module.css';

export interface BatchTrackEntry {
  /** "01" */
  number: string;
  composition: Composition;
}

export interface BatchRenderPanelProps {
  album: Album;
  /** The album's tracks that are still in the library, in album order. */
  tracks: readonly BatchTrackEntry[];
  /** Renders one track; null while MP4 rendering isn't available (the panel says so). */
  renderOne: RenderOneFn | null;
  onClose: () => void;
  /** Overrides for the harness page; the defaults use the File System Access API. */
  chooseFolder?: () => Promise<RenderDestination | null>;
  folderAvailable?: boolean;
  loadSignature?: (composition: Composition) => Promise<KineticSignature | undefined>;
  recordRender?: (albumId: string, compositionId: string, fileName: string) => Promise<unknown>;
}

function destinationText(destination: RenderDestination): string {
  return destination.kind === 'folder'
    ? `the folder “${destination.name}”`
    : 'your downloads folder';
}

/**
 * Batch render (SPEC 12.3 step 4): choose tracks and a folder, then render them one
 * after another with progress, pause and cancel, and a summary at the end.
 */
export function BatchRenderPanel({
  album,
  tracks,
  renderOne,
  onClose,
  chooseFolder = chooseRenderFolder,
  folderAvailable = canChooseFolder(),
  loadSignature,
  recordRender,
}: BatchRenderPanelProps) {
  const titleId = useId();
  const batch = useBatchStore(
    useShallow((s) => ({
      phase: s.phase,
      albumId: s.albumId,
      albumTitle: s.albumTitle,
      destination: s.destination,
    })),
  );
  const store = useBatchStore.getState;
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () =>
      new Set(tracks.filter((t) => t.composition.status === 'kept').map((t) => t.composition.id)),
  );
  const [normalize, setNormalize] = useState(true);
  const [sidecar, setSidecar] = useState(true);
  const [folderHint, setFolderHint] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  // Without folder access, everything goes to downloads; no choice to make.
  useEffect(() => {
    if (!folderAvailable && !store().destination) store().setDestination({ kind: 'downloads' });
  }, [folderAvailable, store]);

  useEffect(() => {
    let cancelled = false;
    void getSetting('renderFolderHint')
      .then((hint) => {
        if (!cancelled) setFolderHint(hint);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const busyElsewhere = batch.phase === 'running' && batch.albumId !== album.id;
  const mine = batch.albumId === album.id && batch.phase !== 'idle';

  if (busyElsewhere) {
    return (
      <section className={styles.panel} aria-labelledby={titleId}>
        <h2 id={titleId} className={styles.title}>
          Batch render
        </h2>
        <p className={styles.hint}>
          <a href={href(`/album/${encodeURIComponent(batch.albumId ?? '')}`)}>
            “{batch.albumTitle}”
          </a>{' '}
          is rendering. One album renders at a time; this one can start when it finishes.
        </p>
        <div className={styles.actions}>
          <Button variant="quiet" onClick={onClose}>
            Close
          </Button>
        </div>
      </section>
    );
  }

  if (mine) return <BatchProgress titleId={titleId} onClose={onClose} />;

  const setOne = (id: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const selectWhere = (keep: (entry: BatchTrackEntry) => boolean) =>
    setSelected(new Set(tracks.filter(keep).map((t) => t.composition.id)));
  const keptCount = tracks.filter((t) => t.composition.status === 'kept').length;
  const chosen = tracks.filter((t) => selected.has(t.composition.id));

  const pickFolder = async () => {
    setMessage(null);
    try {
      const destination = await chooseFolder();
      if (!destination) return;
      store().setDestination(destination);
      if (destination.kind === 'folder') {
        setFolderHint(destination.name);
        void setSetting('renderFolderHint', destination.name).catch(() => undefined);
      }
    } catch (err) {
      console.error(errorDetail(err));
      setMessage("That folder can't be used. Choose another one, such as a folder in Movies.");
    }
  };

  const start = async () => {
    const destination = store().destination;
    if (!renderOne || !destination || chosen.length === 0) return;
    setMessage(null);
    try {
      if (!(await ensureWritable(destination))) {
        setMessage(
          `Synesthesia isn't allowed to save in ${destinationText(destination)} any more. Choose the folder again.`,
        );
        return;
      }
    } catch (err) {
      console.error(errorDetail(err));
      setMessage(userMessage(err));
      return;
    }
    void store().start({
      albumId: album.id,
      albumTitle: album.title,
      tracks: chosen,
      options: { destination, normalize, sidecar },
      renderOne,
      loadSignature,
      recordRender,
    });
  };

  return (
    <section className={styles.panel} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles.title}>
        Batch render
      </h2>
      <p className={styles.hint}>
        Render the tracks you choose to MP4 video, one after another. You can leave it running, and
        pause or cancel at any time.
      </p>
      {renderOne ? null : (
        <Notice tone="info">
          Rendering to MP4 isn’t part of this version yet. You can choose tracks and a folder now;
          once rendering arrives, it starts from here.
        </Notice>
      )}

      <fieldset className={styles.group}>
        <legend className={styles.legend}>Tracks</legend>
        <div className={styles.selectRow}>
          <Button
            variant="quiet"
            onClick={() => selectWhere((t) => t.composition.status === 'kept')}
            disabled={keptCount === 0}
          >
            Select kept
          </Button>
          <Button variant="quiet" onClick={() => selectWhere(() => true)}>
            Select all
          </Button>
          <Button variant="quiet" onClick={() => setSelected(new Set())}>
            Select none
          </Button>
          <span className={styles.count} aria-live="polite">
            {chosen.length} of {countOf(tracks.length, 'track', 'tracks')} chosen
            {keptCount === 0 ? ' · none kept yet' : ''}
          </span>
        </div>
        <ul className={styles.checklist}>
          {tracks.map(({ number, composition: c }) => (
            <li key={c.id}>
              <Checkbox
                label={number}
                ariaLabel={`Render track ${number}`}
                description={`${statusLabel(c.status)} · ${materialName('visual', c.visual.materialId)} · ${materialName('sound', c.sound.materialId)}`}
                checked={selected.has(c.id)}
                onChange={(on) => setOne(c.id, on)}
              />
            </li>
          ))}
        </ul>
      </fieldset>

      <div className={styles.group}>
        <span className={styles.legend}>Save to</span>
        <div className={styles.folderRow}>
          <span className={styles.folder}>
            {batch.destination
              ? batch.destination.kind === 'folder'
                ? `“${batch.destination.name}”`
                : 'Your downloads folder'
              : folderHint
                ? `Choose a folder (last time: “${folderHint}”)`
                : 'Choose a folder for the videos'}
          </span>
          {folderAvailable ? (
            <Button onClick={() => void pickFolder()}>
              {batch.destination ? 'Change folder…' : 'Choose folder…'}
            </Button>
          ) : null}
        </div>
        {folderAvailable ? null : (
          <p className={styles.hint}>This browser saves the videos to your downloads folder.</p>
        )}
      </div>

      <div className={styles.options}>
        <Toggle
          label="Even out loudness"
          checked={normalize}
          onChange={setNormalize}
          description="Brings each track's sound to the same peak level. Off keeps quiet tracks quiet."
        />
        <Toggle
          label="Save a composition file next to each video"
          checked={sidecar}
          onChange={setSidecar}
          description="A .spcomp.json file with everything needed to make the video again."
        />
      </div>

      {message ? (
        <Notice tone="error" onDismiss={() => setMessage(null)}>
          {message}
        </Notice>
      ) : null}

      <div className={styles.actions}>
        <Button
          variant="primary"
          onClick={() => void start()}
          disabled={!renderOne || chosen.length === 0 || !batch.destination}
        >
          {chosen.length === 0 ? 'Render' : `Render ${countOf(chosen.length, 'track', 'tracks')}`}
        </Button>
        <Button variant="quiet" onClick={onClose}>
          Close
        </Button>
      </div>
    </section>
  );
}

function trackState(t: BatchTrack, holding: boolean): string {
  switch (t.status) {
    case 'waiting':
      return 'Waiting';
    case 'rendering':
      return `${holding ? 'Paused' : 'Rendering'} · ${Math.floor(t.progress * 100)}%`;
    case 'rendered':
      return `Saved as ${t.fileName ?? 'a video'}`;
    case 'failed':
      return t.message ?? 'Not rendered';
    case 'skipped':
      return 'Not rendered';
  }
}

/** The running (or finished) batch for this album. */
function BatchProgress({ titleId, onClose }: { titleId: string; onClose: () => void }) {
  const s = useBatchStore(
    useShallow((state) => ({
      phase: state.phase,
      albumTitle: state.albumTitle,
      tracks: state.tracks,
      current: state.current,
      pauseRequested: state.pauseRequested,
      holding: state.holding,
      cancelRequested: state.cancelRequested,
      etaMs: state.etaMs,
      summary: state.summary,
      destination: state.destination,
    })),
  );
  const store = useBatchStore.getState;
  const total = s.tracks.length;
  const running = s.phase === 'running';

  let status: string;
  if (s.summary) {
    status = `Rendered ${s.summary.rendered} of ${countOf(total, 'track', 'tracks')} in ${formatElapsed(s.summary.elapsedMs)}.`;
    if (s.destination && s.summary.rendered > 0) {
      status += ` The videos are in ${destinationText(s.destination)}.`;
    }
  } else if (s.cancelRequested) {
    status = 'Stopping…';
  } else if (s.holding) {
    status = 'Paused. Resume to carry on where it stopped.';
  } else if (s.pauseRequested) {
    status = 'Pausing…';
  } else {
    const n = Math.max(0, s.current) + 1;
    status = `Track ${n} of ${total}${s.etaMs !== null ? ` · ${formatRemaining(s.etaMs)}` : ''}`;
  }
  const failed = s.tracks.filter((t) => t.status === 'failed');

  return (
    <section className={styles.panel} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles.title}>
        {s.summary
          ? s.summary.cancelled
            ? 'Batch render cancelled'
            : 'Batch render finished'
          : `Rendering “${s.albumTitle}”`}
      </h2>
      <p className={styles.status} role="status">
        {status}
      </p>
      {s.summary && failed.length > 0 ? (
        <p className={styles.problem}>
          {countOf(failed.length, 'track', 'tracks')} couldn’t be rendered. The reasons are below;
          the rest of the album is unaffected.
        </p>
      ) : null}
      {s.summary && s.summary.cancelled && s.summary.skipped > 0 ? (
        <p className={styles.hint}>
          {countOf(s.summary.skipped, 'track wasn’t', 'tracks weren’t')} rendered because the batch
          was cancelled.
        </p>
      ) : null}

      <ol className={styles.progressList} aria-label="Tracks in this batch">
        {s.tracks.map((t) => (
          <li key={t.compositionId} className={styles.progressItem} data-status={t.status}>
            <span className={styles.number}>{t.number}</span>
            <span className={styles.state}>{trackState(t, s.holding)}</span>
            <span
              className={styles.bar}
              role="progressbar"
              aria-label={`Track ${t.number}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(t.progress * 100)}
            >
              <span className={styles.fill} style={{ width: `${Math.round(t.progress * 100)}%` }} />
            </span>
          </li>
        ))}
      </ol>

      <div className={styles.actions}>
        {running ? (
          <>
            {s.pauseRequested || s.holding ? (
              <Button onClick={() => store().resume()} disabled={s.cancelRequested}>
                Resume
              </Button>
            ) : (
              <Button onClick={() => store().pause()} disabled={s.cancelRequested}>
                Pause
              </Button>
            )}
            <Button
              className={styles.cancel}
              onClick={() => store().cancel()}
              disabled={s.cancelRequested}
            >
              Cancel
            </Button>
          </>
        ) : (
          <Button
            variant="primary"
            onClick={() => {
              store().dismiss();
              onClose();
            }}
          >
            Done
          </Button>
        )}
      </div>
    </section>
  );
}
