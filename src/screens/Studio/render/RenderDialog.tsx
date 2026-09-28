/**
 * Render MP4 dialog (SPEC 10.1). The Studio opens it with the current composition and its
 * signature (and should pause the preview first, SPEC 10.2 step 1); `onClose` reports the
 * rendered file's name, or null if nothing was rendered.
 *
 * Choices: size (720p, 1080p, square; sizes this computer can't make are disabled with the
 * reason), 30 or 60 frames per second, quality (High by default, independent of the
 * preview), "Even out loudness" (−1 dBFS peak normalization, on), "Also save the
 * composition file" (off), and where to save (a folder chosen once per session, or
 * downloads). While rendering: the phase in plain words, a progress bar, the time left once
 * the first frames are done, and Cancel. Afterwards: the file name and where it went.
 *
 * A native modal <dialog>: focus stays inside, Esc closes it when nothing is rendering.
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { Composition } from '../../../engine/composition';
import { DEFAULT_SETTINGS, getSettings, type RenderResolution } from '../../../library/settings';
import type { Quality } from '../../../materials/types';
import {
  EtaEstimator,
  RenderError,
  compositionDuration,
  formatLength,
  formatTimeLeft,
  isRenderCancelled,
  progressFraction,
  renderComposition,
  renderErrorMessage,
  describeError,
  type RenderDestination,
  type RenderProgress,
  type RenderResult,
} from '../../../render';
import { getRenderDefaults, type RenderDefaults } from '../../../render/capabilities';
import {
  FOLDER_MESSAGES,
  canSaveToFolder,
  chooseRenderFolder,
  ensureFolderPermission,
  forgetRenderFolder,
  loadRenderFolderHint,
  useRenderFolder,
} from '../../../state/renderFolder';
import type { KineticSignature } from '../../../signature/types';
import { Button } from '../../../ui/Button';
import { Toggle } from '../../../ui/Toggle';
import styles from './RenderDialog.module.css';
import {
  COPY,
  FPS_CHOICES,
  QUALITY_CHOICES,
  RESOLUTION_CHOICES,
  availabilityNotes,
  doneText,
  initialResolution,
  mutedNotes,
  phaseText,
  sidecarText,
  sizeOf,
} from './renderDialogModel';

export interface RenderDialogProps {
  composition: Composition;
  signature: KineticSignature;
  /** Called when the dialog closes, with the file name if a render finished. */
  onClose: (renderedFileName: string | null) => void;
}

type Mode = 'setup' | 'rendering' | 'done';
type DestinationChoice = 'folder' | 'download';

interface Notice {
  tone: 'info' | 'error';
  text: string;
  detail?: string;
}

/** Progress state updates at most this often (the bar still moves smoothly). */
const PROGRESS_UPDATE_MS = 100;
/** The time-left text changes at most this often, so it reads calmly. */
const ETA_UPDATE_MS = 1000;

/** A row of choices built on native radio buttons (so single options can be disabled). */
function RadioGroup<T extends string | number>({
  legend,
  name,
  value,
  options,
  onChange,
  hint,
}: {
  legend: string;
  name: string;
  value: T;
  options: readonly { value: T; label: string; detail?: string; disabled?: boolean }[];
  onChange: (value: T) => void;
  hint?: ReactNode;
}) {
  return (
    <fieldset className={styles.field}>
      <legend className={styles.legend}>{legend}</legend>
      <div className={styles.options}>
        {options.map((option) => (
          <label
            key={String(option.value)}
            className={`${styles.option} ${option.disabled ? styles.optionDisabled : ''}`}
          >
            <input
              type="radio"
              name={name}
              className={styles.radio}
              checked={option.value === value}
              disabled={option.disabled}
              onChange={() => onChange(option.value)}
            />
            <span>
              {option.label}
              {option.detail ? <span className={styles.optionDetail}> {option.detail}</span> : null}
            </span>
          </label>
        ))}
      </div>
      {hint ? <div className={styles.hint}>{hint}</div> : null}
    </fieldset>
  );
}

export function RenderDialog({ composition, signature, onClose }: RenderDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const statusId = useId();

  const [mode, setMode] = useState<Mode>('setup');
  // Choices stay disabled until settings and the capability check are in, so a loaded
  // default never replaces something the person already chose.
  const [loaded, setLoaded] = useState(false);
  const [defaults, setDefaults] = useState<RenderDefaults | null>(null);
  const [resolution, setResolution] = useState<RenderResolution>(DEFAULT_SETTINGS.renderResolution);
  const [fps, setFps] = useState<30 | 60>(DEFAULT_SETTINGS.renderFps);
  const [quality, setQuality] = useState<Quality>('high');
  const [normalize, setNormalize] = useState(true);
  const [sidecar, setSidecar] = useState(false);
  const folderSaving = canSaveToFolder();
  const [destination, setDestination] = useState<DestinationChoice>(
    folderSaving ? 'folder' : 'download',
  );
  const folder = useRenderFolder((s) => s.handle);
  const folderHint = useRenderFolder((s) => s.hint);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [progress, setProgress] = useState<RenderProgress | null>(null);
  const [timeLeft, setTimeLeft] = useState<string | null>(null);
  const [result, setResult] = useState<RenderResult | null>(null);

  const controllerRef = useRef<AbortController | null>(null);
  const modeRef = useRef<Mode>('setup');
  modeRef.current = mode;
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  const length = compositionDuration(signature, composition.timeline);

  // Open as a modal, and load settings and what this computer can make.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    let live = true;
    void loadRenderFolderHint();
    void (async () => {
      const [settings, probed] = await Promise.all([
        getSettings().catch(() => DEFAULT_SETTINGS),
        getRenderDefaults().catch(() => null),
      ]);
      if (!live) return;
      // If the check itself failed, the render runs it again and explains any problem.
      setDefaults(probed);
      setResolution(initialResolution(settings.renderResolution, probed?.resolutions ?? null));
      setFps(settings.renderFps);
      setLoaded(true);
    })();
    return () => {
      live = false;
      // Leaving the Studio (or closing) mid-render cancels it.
      controllerRef.current?.abort();
    };
  }, []);

  // Keep focus on the one button that matters in each stage.
  useEffect(() => {
    if (mode === 'setup') return;
    dialogRef.current?.querySelector<HTMLButtonElement>('[data-focus-first]')?.focus();
  }, [mode]);

  const close = useCallback(() => {
    if (modeRef.current === 'rendering') return;
    onCloseRef.current(result?.fileName ?? null);
  }, [result]);

  /** Ready to render: choices loaded, and this browser can make MP4 video at all. */
  const canRender = mode === 'setup' && loaded && defaults?.largestResolution !== null;

  const pickFolder = async (): Promise<FileSystemDirectoryHandle | null> => {
    const choice = await chooseRenderFolder();
    if (choice.ok) {
      setNotice(null);
      return choice.handle;
    }
    setNotice({ tone: 'info', text: choice.message });
    if (choice.reason !== 'blocked') setDestination('download');
    return null;
  };

  const start = async () => {
    if (!canRender) return;
    setNotice(null);
    // The folder picker and permission prompt need this click, so they come first.
    let target: RenderDestination = { kind: 'download' };
    if (destination === 'folder') {
      let handle = folder;
      if (!handle) {
        handle = await pickFolder();
        if (!handle) return;
      } else if (!(await ensureFolderPermission(handle))) {
        forgetRenderFolder();
        setNotice({ tone: 'info', text: FOLDER_MESSAGES.permission });
        return;
      }
      target = { kind: 'folder', directory: handle };
    }

    const controller = new AbortController();
    controllerRef.current = controller;
    const eta = new EtaEstimator();
    let lastUpdate = -Infinity;
    let lastEta = -Infinity;
    let lastPhase: RenderProgress['phase'] | null = null;
    setProgress(null);
    setTimeLeft(null);
    setMode('rendering');
    try {
      const { width, height } = sizeOf(resolution);
      const rendered = await renderComposition({
        composition,
        signature,
        output: { width, height, fps, quality, normalize, sidecar },
        destination: target,
        signal: controller.signal,
        // Exactly what Diagnostics confirmed; without a check, the render runs one itself.
        encoding: defaults
          ? { audioCodec: defaults.audioCodec, audioBitrate: defaults.audioBitrate }
          : undefined,
        onProgress: (p) => {
          // Wall-clock time is fine here: it only shapes the estimate shown.
          const now = performance.now();
          if (p.phase === 'frames') eta.update(now, p.framesDone, p.frameCount);
          const phaseChanged = p.phase !== lastPhase;
          lastPhase = p.phase;
          if (phaseChanged || now - lastUpdate >= PROGRESS_UPDATE_MS) {
            lastUpdate = now;
            setProgress(p);
          }
          if (p.phase !== 'frames') {
            setTimeLeft(null);
          } else if (now - lastEta >= ETA_UPDATE_MS) {
            const ms = eta.remainingMs();
            if (ms !== null) {
              lastEta = now;
              setTimeLeft(formatTimeLeft(ms));
            }
          }
        },
      });
      setResult(rendered);
      setMode('done');
    } catch (error) {
      setMode('setup');
      if (isRenderCancelled(error)) {
        setNotice({ tone: 'info', text: COPY.cancelled });
      } else {
        const message = renderErrorMessage(error);
        setNotice({ tone: 'error', text: message, detail: describeError(error) });
        console.warn('Render failed:', describeError(error));
        if (
          error instanceof RenderError &&
          (error.code === 'folder-missing' || error.code === 'folder-permission')
        ) {
          forgetRenderFolder();
        }
      }
    } finally {
      controllerRef.current = null;
    }
  };

  const rendering = mode === 'rendering';
  const notes = [...availabilityNotes(defaults), ...mutedNotes(composition)];
  const available = defaults?.resolutions;
  const fraction = progress ? progressFraction(progress) : 0;
  const folderName = folder?.name ?? '';

  let body: ReactNode;
  if (mode === 'done' && result) {
    body = (
      <div className={styles.done}>
        <p className={styles.doneText}>{doneText(result)}</p>
        {sidecarText(result) ? <p className={styles.hint}>{sidecarText(result)}</p> : null}
        {result.warnings.map((w) => (
          <p key={w} className={styles.hint}>
            {w}
          </p>
        ))}
      </div>
    );
  } else if (rendering) {
    body = (
      <div className={styles.progressBlock}>
        <p className={styles.phase}>{phaseText(progress)}</p>
        <progress
          className={styles.progress}
          value={Math.round(fraction * 1000)}
          max={1000}
          aria-label="Render progress"
        />
        <p className={styles.timeLeft}>{timeLeft ?? ' '}</p>
      </div>
    );
  } else {
    body = (
      <form
        id={`${titleId}-form`}
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          void start();
        }}
      >
        <fieldset className={styles.choices} disabled={!loaded}>
          <RadioGroup
            legend={COPY.size}
            name={`${titleId}-size`}
            value={resolution}
            onChange={setResolution}
            options={RESOLUTION_CHOICES.map((c) => ({
              ...c,
              disabled: available ? !available[c.value] : false,
            }))}
          />
          <RadioGroup
            legend={COPY.fps}
            name={`${titleId}-fps`}
            value={fps}
            onChange={setFps}
            options={FPS_CHOICES.map((v) => ({ value: v, label: String(v) }))}
          />
          <RadioGroup
            legend={COPY.quality}
            name={`${titleId}-quality`}
            value={quality}
            onChange={setQuality}
            options={QUALITY_CHOICES}
            hint={COPY.qualityHint}
          />
          <div className={styles.field}>
            <Toggle label={COPY.loudness} checked={normalize} onChange={setNormalize} />
            <p className={styles.hint}>{COPY.loudnessHint}</p>
          </div>
          <div className={styles.field}>
            <Toggle label={COPY.sidecar} checked={sidecar} onChange={setSidecar} />
            <p className={styles.hint}>{COPY.sidecarHint}</p>
          </div>
          {folderSaving ? (
            <RadioGroup
              legend={COPY.saveTo}
              name={`${titleId}-dest`}
              value={destination}
              onChange={(v) => {
                setDestination(v);
                setNotice(null);
              }}
              options={[
                {
                  value: 'folder',
                  label: COPY.folder,
                  detail: folder ? `“${folderName}”` : undefined,
                },
                { value: 'download', label: COPY.downloads },
              ]}
              hint={
                destination === 'folder' ? (
                  <div className={styles.folderRow}>
                    <span>
                      {folder
                        ? `Renders go into “${folderName}”.`
                        : folderHint
                          ? `${COPY.noFolderYet} Last time it was “${folderHint}”.`
                          : `${COPY.noFolderYet} ${COPY.folderTip}`}
                    </span>
                    <Button variant="quiet" onClick={() => void pickFolder()}>
                      {folder ? COPY.changeFolder : COPY.chooseFolder}
                    </Button>
                  </div>
                ) : undefined
              }
            />
          ) : (
            <div className={styles.field}>
              <p className={styles.legend}>{COPY.saveTo}</p>
              <p className={styles.hint}>{COPY.downloadsOnly}</p>
            </div>
          )}
        </fieldset>
      </form>
    );
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        // Esc: close when idle; never in the middle of a render (use Cancel render).
        event.preventDefault();
        close();
      }}
    >
      <h2 id={titleId} className={styles.title}>
        {mode === 'done' ? COPY.finished : rendering ? COPY.rendering : COPY.title}
      </h2>
      <p className={styles.subtitle}>
        “{composition.name || 'Untitled'}” · {formatLength(length)}
      </p>

      {mode === 'setup' && !loaded ? <p className={styles.checking}>{COPY.checking}</p> : null}
      {mode === 'setup' && notes.length > 0 ? (
        <ul className={styles.notes}>
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}

      {body}

      <div id={statusId} role="status" aria-live="polite" className={styles.status}>
        {notice ? (
          <p className={notice.tone === 'error' ? styles.error : styles.info}>{notice.text}</p>
        ) : null}
        {notice?.detail ? (
          <details className={styles.details}>
            <summary>Details for Braden</summary>
            <code>{notice.detail}</code>
          </details>
        ) : null}
        {rendering ? (
          <span className="visually-hidden">{phaseLabelForAnnouncement(progress)}</span>
        ) : null}
        {mode === 'done' ? <span className="visually-hidden">{COPY.finished}</span> : null}
      </div>

      <div className={styles.buttons}>
        {mode === 'setup' ? (
          <>
            <Button onClick={close}>{COPY.cancel}</Button>
            <Button variant="primary" type="submit" form={`${titleId}-form`} disabled={!canRender}>
              {COPY.render}
            </Button>
          </>
        ) : null}
        {rendering ? (
          <Button data-focus-first onClick={() => controllerRef.current?.abort()}>
            {COPY.cancelRender}
          </Button>
        ) : null}
        {mode === 'done' ? (
          <Button data-focus-first variant="primary" onClick={close}>
            {COPY.close}
          </Button>
        ) : null}
      </div>
    </dialog>
  );
}

/** Screen readers hear each phase once, not every frame. */
function phaseLabelForAnnouncement(progress: RenderProgress | null): string {
  if (!progress || progress.phase === 'frames') return 'Drawing frames…';
  return phaseText(progress);
}
