import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { href } from '../../app/router';
import type { ExtractionProgress } from '../../signature/extractClient';
import { noiseFloorLooksHigh } from '../../signature/noiseFloor';
import { MAX_CLIP_SECONDS } from '../../signature/types';
import {
  ANALYSIS_SIZES,
  GRID_COLUMNS,
  SMOOTHING_FRAMES,
  SPEED_RANGE,
  usePrepareStore,
} from '../../state/prepareStore';
import { Button } from '../../ui/Button';
import { FileButton } from '../../ui/FileButton';
import { describeFocusRect } from '../../ui/FocusBox';
import { Notice } from '../../ui/Notice';
import { ProgressBar } from '../../ui/ProgressBar';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { Slider } from '../../ui/Slider';
import { Toggle } from '../../ui/Toggle';
import { formatDuration } from '../Library/format';
import {
  describeOnsets,
  describeSeconds,
  formatClipTime,
  formatSpeed,
  MAX_NAME_LENGTH,
} from './format';
import { ROTATIONS } from './orientation';
import styles from './PreparePanel.module.css';
import { PHASE_WORDS, estimateRemainingSec, overallFraction, progressTimeText } from './progress';
import { describeFloor, floorFromSensitivity, formatSensitivity } from './sensitivity';
import { trimLength, trimTooLong } from './trim';

/** File types the clip picker offers. */
export const CLIP_ACCEPT = 'video/*,.mp4,.m4v,.mov,.webm,.mkv';

const SPEED_HELP = 'How fast the signature plays by default. It doesn’t change what’s captured.';

function Section({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <section className={[styles.section, className].filter(Boolean).join(' ')} aria-labelledby={id}>
      <h2 id={id} className={styles.heading}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function SpeedSlider({ disabled }: { disabled?: boolean }) {
  const speed = usePrepareStore((s) => s.settings.speed);
  const setSpeed = usePrepareStore((s) => s.setSpeed);
  return (
    <>
      <Slider
        label="Speed"
        value={speed}
        min={SPEED_RANGE.min}
        max={SPEED_RANGE.max}
        step={SPEED_RANGE.step}
        baseline={SPEED_RANGE.default}
        format={formatSpeed}
        description={SPEED_HELP}
        disabled={disabled}
        onChange={(v) => setSpeed(v)}
      />
      <p className={styles.help}>{SPEED_HELP}</p>
    </>
  );
}

// ---------------------------------------------------------------------------------------
// Before a clip is open

export function EmptyPanel({ onFiles }: { onFiles: (files: File[]) => void }) {
  const opening = usePrepareStore((s) => s.status === 'opening');
  const notice = usePrepareStore((s) => s.notice);
  const setNotice = usePrepareStore((s) => s.setNotice);
  return (
    <div className={styles.panelBody}>
      <Section title="Clip">
        <p>Bring in a short clip of a movement: a wink, a hand in water, a curtain in the wind.</p>
        <FileButton variant="primary" accept={CLIP_ACCEPT} onFiles={onFiles} disabled={opening}>
          Choose a clip…
        </FileButton>
        <p className={styles.help}>
          MP4, MOV or WebM. A signature holds up to a minute of movement.
        </p>
        <div role="status" aria-live="polite" className={styles.notice}>
          {notice ? (
            <Notice tone={notice.tone} onDismiss={() => setNotice(null)}>
              {notice.message}
            </Notice>
          ) : null}
        </div>
      </Section>
      <Section title="What happens next">
        <ol className={styles.steps}>
          <li>Trim the clip and choose how fast it plays.</li>
          <li>Turn or mirror it, and box the part that moves, if you like.</li>
          <li>Extract its signature: the movement, without the picture.</li>
        </ol>
        <p className={styles.help}>
          The clip stays on this screen. Only its movement is kept in your library.
        </p>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// Shaping the clip and extracting

export interface SetupPanelProps {
  onFiles: (files: File[]) => void;
  onExtract: () => void;
  onCancel: () => void;
  onDrawBox: () => void;
  onStartHere: () => void;
  onEndHere: () => void;
  playerReady: boolean;
}

export function SetupPanel({
  onFiles,
  onExtract,
  onCancel,
  onDrawBox,
  onStartHere,
  onEndHere,
  playerReady,
}: SetupPanelProps) {
  const status = usePrepareStore((s) => s.status);
  const clip = usePrepareStore((s) => s.clip);
  const settings = usePrepareStore((s) => s.settings);
  const progress = usePrepareStore((s) => s.progress);
  const notice = usePrepareStore((s) => s.notice);
  const store = usePrepareStore.getState;
  if (!clip) return null;

  const locked = status !== 'ready';
  const extracting = status === 'extracting';
  const { trim, focusArea } = settings;
  const length = trimLength(trim);
  const tooLong = trimTooLong(trim);
  const longClip = clip.durationSec > MAX_CLIP_SECONDS + 1e-3;
  const manual = settings.sensitivityMode === 'manual';

  return (
    <div className={styles.panelBody}>
      <Section title="Clip">
        <p className={styles.fileName} title={clip.fileName}>
          {clip.fileName}
        </p>
        <p className={styles.help}>{formatDuration(clip.durationSec)} long</p>
        <FileButton variant="quiet" accept={CLIP_ACCEPT} onFiles={onFiles} disabled={locked}>
          Choose another clip…
        </FileButton>
      </Section>

      <Section title="Trim and speed">
        <p className={styles.value} data-testid="trim-summary">
          {formatClipTime(trim.startSec)} to {formatClipTime(trim.endSec)}
          <span className={styles.muted}> · {formatDuration(length)}</span>
        </p>
        <div className={styles.buttonRow}>
          <Button
            onClick={onStartHere}
            disabled={locked || !playerReady}
            aria-label="Start the trim at the playhead"
          >
            Start here
          </Button>
          <Button
            onClick={onEndHere}
            disabled={locked || !playerReady}
            aria-label="End the trim after the frame at the playhead"
          >
            End here
          </Button>
        </div>
        <p className={styles.help}>
          Drag the handles under the clip, or step to a frame and use Start here and End here.
        </p>
        {longClip && !tooLong ? (
          <p className={styles.help}>
            This clip is {describeSeconds(clip.durationSec)} long and a signature holds up to a
            minute, so only part of it is selected. Move the handles to choose the part you want.
          </p>
        ) : null}
        {tooLong ? (
          <p className={styles.warning} role="alert">
            The selected part is {describeSeconds(length)} long. Trim it to 60 seconds or less to
            extract a signature.
          </p>
        ) : null}
        <SpeedSlider disabled={locked} />
      </Section>

      <Section title="Orientation">
        <SegmentedControl
          label="Rotate"
          options={ROTATIONS.map((r) => `${r}°`)}
          value={Math.max(0, ROTATIONS.indexOf(settings.rotate))}
          onChange={(i) => store().setRotate(ROTATIONS[i] ?? 0)}
          description="Turn the clip clockwise."
          disabled={locked}
        />
        <Toggle
          label="Mirror"
          checked={settings.mirror}
          onChange={(on) => store().setMirror(on)}
          description="Flip the clip left to right."
          disabled={locked}
        />
      </Section>

      <Section title="Focus area">
        <p className={styles.help}>
          For a wink, draw a box around the eye so only its movement is used. The box is stretched
          to fill the material.
        </p>
        <p className={styles.value} aria-live="polite">
          {focusArea
            ? `Using a box ${describeFocusRect(focusArea)}.`
            : 'Using the whole frame. Drag on the clip to draw a box.'}
        </p>
        <div className={styles.buttonRow}>
          {focusArea ? (
            <Button onClick={() => store().setFocusArea(null)} disabled={locked}>
              Clear box
            </Button>
          ) : (
            <Button onClick={onDrawBox} disabled={locked}>
              Draw a box
            </Button>
          )}
        </div>
        {focusArea ? (
          <p className={styles.help}>
            Drag the box or its edges. With the box selected, arrow keys move it and Option or Alt
            with the arrows resizes it.
          </p>
        ) : null}
      </Section>

      <Section title="Sensitivity">
        <p className={styles.value}>
          {manual ? `Set by hand: ${formatSensitivity(settings.sensitivity)}.` : 'Automatic.'}
        </p>
        <p className={styles.help}>
          {manual
            ? describeFloor(floorFromSensitivity(settings.sensitivity))
            : 'Tiny movements such as camera noise are left out, judged from the clip’s stillest moments. To set it by hand, open Advanced.'}
        </p>
      </Section>

      <details className={styles.advanced}>
        <summary className={styles.summary}>Advanced</summary>
        <div className={styles.advancedBody}>
          <Toggle
            label="Set sensitivity by hand"
            checked={manual}
            onChange={(on) => store().setSensitivityMode(on ? 'manual' : 'auto')}
            disabled={locked}
          />
          <Slider
            label="Sensitivity"
            value={settings.sensitivity}
            baseline={0.5}
            format={formatSensitivity}
            description="Higher picks up smaller, slower movements."
            disabled={locked || !manual}
            onChange={(v) => store().setSensitivity(v)}
          />
          <p className={styles.help}>{describeFloor(floorFromSensitivity(settings.sensitivity))}</p>
          <SegmentedControl
            label="Analysis size (pixels, longer side)"
            options={ANALYSIS_SIZES.map(String)}
            value={Math.max(
              0,
              (ANALYSIS_SIZES as readonly number[]).indexOf(settings.analysisSize),
            )}
            onChange={(i) => store().setAnalysisSize(ANALYSIS_SIZES[i] ?? 320)}
            description="The size the movement is measured at. Larger sees finer detail but takes longer."
            disabled={locked}
          />
          <SegmentedControl
            label="Grid columns"
            options={GRID_COLUMNS.map(String)}
            value={Math.max(0, (GRID_COLUMNS as readonly number[]).indexOf(settings.gridCols))}
            onChange={(i) => store().setGridCols(GRID_COLUMNS[i] ?? 32)}
            description="How many columns of cells the movement is gathered into. Rows follow the frame’s shape."
            disabled={locked}
          />
          <SegmentedControl
            label="Extraction smoothing (frames)"
            options={SMOOTHING_FRAMES.map(String)}
            value={Math.max(
              0,
              (SMOOTHING_FRAMES as readonly number[]).indexOf(settings.smoothingFrames),
            )}
            onChange={(i) => store().setSmoothingFrames(SMOOTHING_FRAMES[i] ?? 3)}
            description="Averages each moment with its neighbours to calm flicker. 1 means none."
            disabled={locked}
          />
        </div>
      </details>

      <div className={styles.extract}>
        {extracting ? (
          <ExtractionProgressView progress={progress} onCancel={onCancel} />
        ) : (
          <Button
            variant="primary"
            className={styles.extractButton}
            onClick={onExtract}
            disabled={locked || tooLong || !playerReady}
          >
            Extract signature
          </Button>
        )}
        <div role="status" aria-live="polite" className={styles.notice}>
          {notice && !extracting ? (
            <Notice tone={notice.tone} onDismiss={() => store().setNotice(null)}>
              {notice.message}
            </Notice>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ExtractionProgressView({
  progress,
  onCancel,
}: {
  progress: ExtractionProgress | null;
  onCancel: () => void;
}) {
  const [startedAt] = useState(() => performance.now());
  const [now, setNow] = useState(startedAt);
  const analyzingSince = useRef<number | null>(null);
  const phase = progress?.phase ?? 'loading';

  useEffect(() => {
    const id = window.setInterval(() => setNow(performance.now()), 500);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    if (phase === 'analyzing' && analyzingSince.current === null) {
      analyzingSince.current = performance.now();
    }
  }, [phase]);

  const fraction = overallFraction(progress);
  const percent = Math.round(fraction * 100);
  const since = analyzingSince.current;
  const remaining = estimateRemainingSec(progress, since === null ? 0 : (now - since) / 1000);
  return (
    <div className={styles.progress}>
      <p className={styles.phase}>
        {PHASE_WORDS[phase]} <span className={styles.muted}>{percent}%</span>
      </p>
      <ProgressBar
        value={fraction}
        label="Extracting the signature"
        valueText={`${PHASE_WORDS[phase]} ${percent}%`}
      />
      <p className={styles.help}>{progressTimeText((now - startedAt) / 1000, remaining)}</p>
      <Button onClick={onCancel}>Cancel</Button>
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// After extraction

export interface SignaturePanelProps {
  onSave: (thenOpen: boolean) => void;
  onOpenInStudio: () => void;
  onExtractAgain: () => void;
  saving: boolean;
  saveError: string | null;
}

export function SignaturePanel({
  onSave,
  onOpenInStudio,
  onExtractAgain,
  saving,
  saveError,
}: SignaturePanelProps) {
  const body = usePrepareStore((s) => s.body);
  const name = usePrepareStore((s) => s.name);
  const saved = usePrepareStore((s) => s.saved);
  const hideSource = usePrepareStore((s) => s.hideSource);
  const store = usePrepareStore.getState;
  const nameId = useId();
  if (!body) return null;

  const seconds = body.frameCount / body.frameRate;
  const looksHigh = noiseFloorLooksHigh(body);

  return (
    <div className={styles.panelBody}>
      <Section title="Signature">
        <label className={styles.fieldLabel} htmlFor={nameId}>
          Name
        </label>
        <input
          id={nameId}
          className={styles.nameInput}
          type="text"
          value={name}
          maxLength={MAX_NAME_LENGTH}
          spellCheck={false}
          autoComplete="off"
          readOnly={saved !== null}
          onChange={(e) => store().setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && saved === null && !saving) onSave(false);
          }}
        />
        {saved ? (
          <>
            <p className={styles.saved} role="status">
              Saved to your library.
            </p>
            <div className={styles.buttonRow}>
              <Button variant="primary" onClick={onOpenInStudio}>
                Open in Studio
              </Button>
              <a className={styles.link} href={href('/')}>
                Back to library
              </a>
            </div>
          </>
        ) : (
          <>
            <div className={styles.buttonRow}>
              <Button variant="primary" onClick={() => onSave(false)} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
              <Button onClick={() => onSave(true)} disabled={saving}>
                Save and open in Studio
              </Button>
            </div>
            <p className={styles.help}>Not saved yet.</p>
          </>
        )}
        {saveError ? <Notice tone="error">{saveError}</Notice> : null}
      </Section>

      <Section title="View">
        <Toggle
          label="Hide source"
          checked={hideSource}
          onChange={(on) => store().setHideSource(on)}
          description="Show only the wake. Turn it off to see the clip and its wake side by side."
        />
        <p className={styles.help}>
          {hideSource
            ? 'Only the wake is showing. Turn Hide source off to see the clip beside it.'
            : 'The clip and its wake play side by side.'}
        </p>
        <SpeedSlider disabled={saved !== null} />
      </Section>

      <Section title="What was found">
        <p className={styles.value} data-testid="signature-facts">
          {formatDuration(seconds)} of movement
          <span className={styles.muted}> · {describeOnsets(body.features.onsets.length)}</span>
        </p>
        {looksHigh ? (
          <Notice tone="info">
            Much of this clip keeps moving, so small movements may have been left out. If the wake
            looks too empty, choose Extract again, open Advanced and raise Sensitivity.
          </Notice>
        ) : null}
      </Section>

      <Section title="Change the clip">
        <p className={styles.help}>
          Go back to the clip to change the trim, focus area or sensitivity, then extract again.
        </p>
        <div className={styles.buttonRow}>
          <Button onClick={onExtractAgain}>Extract again</Button>
        </div>
      </Section>
    </div>
  );
}
