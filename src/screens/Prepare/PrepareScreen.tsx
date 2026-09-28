import { useCallback, useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { navigate } from '../../app/router';
import {
  errorDetail,
  finalizeSignature,
  saveSignature,
  signatureThumbnail,
  userMessage,
} from '../../library';
import {
  ClipFormatError,
  ClipTooLongError,
  ExtractionCancelled,
  ExtractionError,
  probeClip,
  startExtraction,
  type ExtractionJob,
} from '../../signature/extractClient';
import { CLIP_FORMAT_MESSAGE, EXTRACTION_FAILED_MESSAGE } from '../../signature/extractProtocol';
import { useLibraryStore } from '../../state/libraryStore';
import { extractionOptions, usePrepareStore } from '../../state/prepareStore';
import { centeredRect, type NormRect } from '../../ui/rectMath';
import type { SliderPhase } from '../../ui/Slider';
import type { TrimEdge } from '../../ui/TrimBar';
import { useKeyShortcuts } from '../../ui/useKeyShortcuts';
import {
  SignatureTransport,
  WakeCanvas,
  useSignaturePlayback,
} from '../Signature/SignaturePreview';
import { SignatureSparklines } from '../Signature/SignatureSparklines';
import { useClipFollower, useClipPlayer } from './clipPlayback';
import { ClipView } from './ClipView';
import { DropZone } from './DropZone';
import { PlayerBar } from './PlayerBar';
import { EmptyPanel, SetupPanel, SignaturePanel } from './PreparePanel';
import styles from './PrepareScreen.module.css';
import { frameDuration, safeFps, trimTooLong } from './trim';
import { useObjectUrl } from './useObjectUrl';
import { MAX_CLIP_SECONDS } from '../../signature/types';
import { takePendingClip } from '../../state/pendingClip';

const VIDEO_NAME = /\.(mp4|m4v|mov|webm|mkv|avi|3gp)$/i;

/** The first file that looks like a clip; otherwise the first file (so we can say why not). */
function pickClip(files: readonly File[]): File | null {
  return (
    files.find((f) => f.type.startsWith('video/') || VIDEO_NAME.test(f.name)) ?? files[0] ?? null
  );
}

/** The plain-language message an extraction or probe error carries, or `fallback`. */
function plainMessage(error: unknown, fallback: string): string {
  if (
    error instanceof ClipFormatError ||
    error instanceof ClipTooLongError ||
    error instanceof ExtractionError
  ) {
    return error.message;
  }
  return fallback;
}

/** Technical detail for the console (and Diagnostics). */
function technicalDetail(error: unknown): string {
  const detail =
    error && typeof error === 'object' && 'detail' in error && typeof error.detail === 'string'
      ? ` (${error.detail})`
      : '';
  return error instanceof Error ? `${error.name}: ${error.message}${detail}` : String(error);
}

/**
 * Prepare (SPEC 6.2): bring in a clip, shape it (trim, speed, rotate, mirror, focus area,
 * sensitivity), extract its signature, then name it and save it.
 *
 * The clip lives only here: the File and its object URL are component state, never stored,
 * and both are dropped when the screen closes (the URL is revoked, the <video> emptied).
 */
export function PrepareScreen(_props: { params?: Record<string, string> }) {
  const { status, clip, settings, body, saved, hideSource } = usePrepareStore(
    useShallow((s) => ({
      status: s.status,
      clip: s.clip,
      settings: s.settings,
      body: s.body,
      saved: s.saved,
      hideSource: s.hideSource,
    })),
  );
  const [file, setFile] = useState<File | null>(null);
  const url = useObjectUrl(file);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const jobRef = useRef<ExtractionJob | null>(null);
  const openToken = useRef(0);
  const savingRef = useRef(false);
  const focusBoxRef = useRef<HTMLDivElement>(null);

  const fps = safeFps(clip?.nativeFps ?? 0);
  const getTrim = useCallback(() => usePrepareStore.getState().settings.trim, []);
  const player = useClipPlayer(video, {
    enabled: status === 'ready',
    getTrim,
    fps,
    speed: settings.speed,
  });
  const playback = useSignaturePlayback(body, settings.speed);
  useClipFollower(video, {
    enabled: status === 'extracted' && !hideSource,
    clock: playback?.clock ?? null,
    trim: settings.trim,
    analysisFps: body?.frameRate ?? fps,
    nativeFps: fps,
    speed: settings.speed,
  });

  // A fresh start on arrival; on leaving, stop any extraction and forget everything.
  useEffect(() => {
    const token = openToken;
    usePrepareStore.getState().reset();
    return () => {
      const job = jobRef.current;
      jobRef.current = null;
      job?.cancel();
      token.current++;
      usePrepareStore.getState().reset();
    };
  }, []);

  // Let go of the clip's decoder as soon as the screen closes (not only when collected).
  useEffect(() => {
    if (!video) return;
    return () => {
      if (video.isConnected) return; // StrictMode's rehearsal: the element is still here
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [video]);

  // Closing the tab with an unsaved signature asks first.
  const unsaved = status === 'extracted' && saved === null;
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);

  const openFile = useCallback(async (candidate: File) => {
    if (usePrepareStore.getState().status === 'extracting') return;
    const token = ++openToken.current;
    usePrepareStore.getState().startOpening();
    try {
      const info = await probeClip(candidate);
      if (token !== openToken.current) return;
      if (!info.canDecode || !(info.nativeFps > 0) || !(info.durationSec > 0)) {
        throw new ClipFormatError(
          CLIP_FORMAT_MESSAGE,
          `codec ${info.codec ?? 'unknown'}, ${info.nativeFps} fps, ${info.durationSec} s`,
        );
      }
      setFile(candidate);
      usePrepareStore.getState().clipOpened(info);
    } catch (error) {
      if (token !== openToken.current) return;
      console.warn('The clip could not be opened:', technicalDetail(error));
      usePrepareStore.getState().openFailed(plainMessage(error, CLIP_FORMAT_MESSAGE));
    }
  }, []);

  const onFiles = useCallback(
    (files: File[]) => {
      const candidate = pickClip(files);
      if (candidate) void openFile(candidate);
    },
    [openFile],
  );

  // A clip dropped on another screen arrives here once. The ref keeps it across React's
  // development double-mount, which cancels the first open.
  const onFilesRef = useRef(onFiles);
  useEffect(() => {
    onFilesRef.current = onFiles;
  }, [onFiles]);
  const pendingRef = useRef<File | null | undefined>(undefined);
  useEffect(() => {
    if (pendingRef.current === undefined) pendingRef.current = takePendingClip();
    const pending = pendingRef.current;
    if (pending) onFilesRef.current([pending]);
  }, []);

  // Drop a clip anywhere on the screen (and never let the browser open the file itself).
  useEffect(() => {
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false;
    const busy = () => usePrepareStore.getState().status === 'extracting';
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = busy() ? 'none' : 'copy';
      setDragging(!busy());
    };
    const onDragLeave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDragging(false);
      if (!busy()) onFiles(Array.from(e.dataTransfer?.files ?? []));
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [onFiles]);

  const onVideoError = useCallback(() => {
    // The browser can't play this clip after all.
    const job = jobRef.current;
    jobRef.current = null;
    job?.cancel();
    openToken.current++;
    setFile(null);
    const store = usePrepareStore.getState();
    store.reset();
    store.openFailed(CLIP_FORMAT_MESSAGE);
  }, []);

  const extract = useCallback(() => {
    const state = usePrepareStore.getState();
    if (!file || state.status !== 'ready' || trimTooLong(state.settings.trim)) return;
    const options = extractionOptions(state.settings);
    state.extractionStarted();
    const job: ExtractionJob = startExtraction(
      { file, options, preferredSpeed: state.settings.speed },
      (progress) => {
        if (jobRef.current === job) usePrepareStore.getState().extractionProgressed(progress);
      },
    );
    jobRef.current = job;
    job.result.then(
      (result) => {
        if (jobRef.current !== job) return;
        jobRef.current = null;
        usePrepareStore.getState().extractionSucceeded(result);
      },
      (error: unknown) => {
        if (jobRef.current !== job) return;
        jobRef.current = null;
        if (error instanceof ExtractionCancelled) {
          usePrepareStore.getState().extractionCancelled();
          return;
        }
        console.warn('Extraction failed:', technicalDetail(error));
        usePrepareStore.getState().extractionFailed(plainMessage(error, EXTRACTION_FAILED_MESSAGE));
      },
    );
  }, [file]);

  const cancel = useCallback(() => jobRef.current?.cancel(), []);

  const save = useCallback(async (thenOpen: boolean) => {
    const state = usePrepareStore.getState();
    if (!state.body || savingRef.current) return;
    if (state.saved) {
      if (thenOpen) navigate(`/studio/new/${encodeURIComponent(state.saved.id)}`);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      const signature = finalizeSignature(
        { ...state.body, preferredSpeed: state.settings.speed },
        state.name,
      );
      let thumbnail = '';
      try {
        thumbnail = signatureThumbnail(signature);
      } catch (error) {
        console.warn('Could not draw the thumbnail now; the library will try again.', error);
      }
      const meta = await saveSignature(signature, thumbnail ? { thumbnail } : {});
      usePrepareStore.getState().signatureSaved(meta);
      void useLibraryStore.getState().refresh();
      if (thenOpen) navigate(`/studio/new/${encodeURIComponent(meta.id)}`);
    } catch (error) {
      console.error('Saving the signature failed:', errorDetail(error));
      setSaveError(userMessage(error));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, []);

  const openInStudio = useCallback(() => {
    const id = usePrepareStore.getState().saved?.id;
    if (id) navigate(`/studio/new/${encodeURIComponent(id)}`);
  }, []);

  const extractAgain = useCallback(() => {
    setSaveError(null);
    usePrepareStore.getState().extractAgain();
  }, []);

  const drawBox = useCallback(() => {
    usePrepareStore.getState().setFocusArea(centeredRect(0.4, 0.4));
    requestAnimationFrame(() => focusBoxRef.current?.focus());
  }, []);

  const onFocusChange = useCallback((rect: NormRect | null) => {
    usePrepareStore.getState().setFocusArea(rect);
  }, []);

  const startHere = () => {
    const s = usePrepareStore.getState();
    s.setTrim({ startSec: player.time.get(), endSec: s.settings.trim.endSec }, 'start');
  };
  const endHere = () => {
    const s = usePrepareStore.getState();
    s.setTrim(
      { startSec: s.settings.trim.startSec, endSec: player.time.get() + frameDuration(fps) },
      'end',
    );
  };

  const onTrim = (edge: TrimEdge, seconds: number, phase: SliderPhase) => {
    const s = usePrepareStore.getState();
    if (phase === 'start') player.pause();
    const current = s.settings.trim;
    s.setTrim(
      edge === 'start'
        ? { startSec: seconds, endSec: current.endSec }
        : { startSec: current.startSec, endSec: seconds },
      edge,
    );
    // Show the frame at the handle being moved.
    const next = usePrepareStore.getState().settings.trim;
    player.seek(edge === 'start' ? next.startSec : next.endSec - frameDuration(fps));
  };

  const onSeek = (seconds: number, phase: SliderPhase) => {
    if (phase === 'start') player.pause();
    player.seek(seconds);
  };

  useKeyShortcuts(
    {
      ' ': () => player.toggle(),
      ',': () => player.step(-1),
      '.': () => player.step(1),
    },
    status === 'ready',
  );
  useKeyShortcuts(
    {
      ' ': () => playback?.clock.toggle(),
      l: () => playback?.clock.setLoop(!playback.clock.isLooping()),
    },
    status === 'extracted' && playback !== null,
  );

  const mode: 'empty' | 'clip' | 'signature' =
    status === 'extracted' && body && playback ? 'signature' : clip && url ? 'clip' : 'empty';
  const showClip = mode === 'clip' || (mode === 'signature' && !hideSource);
  const split = mode === 'signature' && showClip;

  return (
    <section className={styles.screen} aria-labelledby="prepare-title">
      <div className={styles.layout}>
        <div className={styles.work}>
          <div className={styles.stage} data-layout={split ? 'split' : 'single'}>
            {clip && url ? (
              <div className={styles.pane} hidden={!showClip} data-testid="clip-pane">
                <ClipView
                  url={url}
                  clip={clip}
                  orientation={{ rotate: settings.rotate, mirror: settings.mirror }}
                  focusArea={settings.focusArea}
                  onFocusChange={status === 'ready' ? onFocusChange : undefined}
                  videoRef={setVideo}
                  focusBoxRef={focusBoxRef}
                  onVideoError={onVideoError}
                />
                {split ? <span className={styles.caption}>Clip</span> : null}
              </div>
            ) : null}
            {mode === 'signature' && playback ? (
              <div className={styles.pane} data-testid="wake-pane">
                <WakeCanvas
                  playback={playback}
                  label="The wake: a short stroke for each part of the movement, pointing the way it moves and brightening as it speeds up"
                />
                {split ? <span className={styles.caption}>Wake</span> : null}
              </div>
            ) : null}
            {mode === 'empty' ? (
              <DropZone onFiles={onFiles} dragging={dragging} opening={status === 'opening'} />
            ) : null}
            {dragging && mode !== 'empty' ? (
              <div className={styles.dropHint} aria-hidden="true">
                Drop to use this clip instead
              </div>
            ) : null}
          </div>

          {mode === 'clip' && clip ? (
            <PlayerBar
              player={player}
              durationSec={clip.durationSec}
              fps={fps}
              trim={settings.trim}
              maxLength={MAX_CLIP_SECONDS}
              disabled={status !== 'ready'}
              onTrim={onTrim}
              onSeek={onSeek}
            />
          ) : null}
          {mode === 'signature' && playback && body ? (
            <div className={styles.below}>
              <SignatureTransport playback={playback} />
              <SignatureSparklines signature={body} playback={playback} />
            </div>
          ) : null}
        </div>

        <aside className={styles.panel} aria-labelledby="prepare-title">
          <h1 id="prepare-title" className={styles.title}>
            Prepare
          </h1>
          {mode === 'empty' ? <EmptyPanel onFiles={onFiles} /> : null}
          {mode === 'clip' ? (
            <SetupPanel
              onFiles={onFiles}
              onExtract={extract}
              onCancel={cancel}
              onDrawBox={drawBox}
              onStartHere={startHere}
              onEndHere={endHere}
              playerReady={player.ready}
            />
          ) : null}
          {mode === 'signature' ? (
            <SignaturePanel
              onSave={(thenOpen) => void save(thenOpen)}
              onOpenInStudio={openInStudio}
              onExtractAgain={extractAgain}
              saving={saving}
              saveError={saveError}
            />
          ) : null}
        </aside>
      </div>
    </section>
  );
}
