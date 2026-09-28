import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { Composition, CompositionStatus } from '../../engine/composition';
import { materialName } from '../../library';
import { formatSeed } from '../../state/seed';
import { Button } from '../../ui/Button';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { STATUS_OPTIONS, notesPreview, propertyList } from './format';
import styles from './TrackRow.module.css';

export interface TrackRowProps {
  /** "01" */
  number: string;
  /** Undefined when the track's composition is no longer in the library. */
  composition: Composition | undefined;
  /** The file this track was last rendered to. */
  renderFile: string | undefined;
  onStatus: (status: CompositionStatus) => void;
  /** Save notes; rejects if they couldn't be saved. */
  onNotes: (notes: string) => Promise<void>;
  onOpen: () => void;
}

function PlaceholderWake() {
  return (
    <svg className={styles.placeholder} viewBox="0 0 160 90" aria-hidden="true" focusable="false">
      <path
        d="M14 56 C 46 26, 72 74, 100 43 S 140 38, 148 47"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Materials({ visual, sound }: { visual: string; sound: string }) {
  return (
    <span data-testid="track-materials">
      <span className={styles.kind}>Visual</span> {visual} <span aria-hidden="true">·</span>{' '}
      <span className={styles.kind}>Sound</span> {sound}
    </span>
  );
}

/**
 * One track of an album: its materials, open properties and seed, a status control
 * (saved at once), notes, its render, and the way into the Studio.
 */
export function TrackRow({
  number,
  composition: c,
  renderFile,
  onStatus,
  onNotes,
  onOpen,
}: TrackRowProps) {
  const [notesOpen, setNotesOpen] = useState(false);
  const notesId = useId();

  if (!c) {
    return (
      <li className={styles.row} data-status="missing">
        <span className={styles.number} aria-hidden="true">
          {number}
        </span>
        <div className={styles.thumb}>
          <PlaceholderWake />
        </div>
        <div className={styles.body}>
          <h3 className={styles.title}>
            <span className="visually-hidden">Track {number}: </span>No longer in your library
          </h3>
          <p className={styles.detail}>
            This track’s composition was deleted from the library. The album keeps its place in the
            record.
          </p>
        </div>
      </li>
    );
  }

  const visual = materialName('visual', c.visual.materialId);
  const sound = materialName('sound', c.sound.materialId);
  const customName = c.name.trim() !== '' && c.name !== number;
  const open = c.chance?.openProperties ?? [];
  const overrides = c.chance?.overrides ?? [];
  const preview = notesPreview(c.notes);
  const statusIndex = Math.max(
    0,
    STATUS_OPTIONS.findIndex((o) => o.value === c.status),
  );

  return (
    <li className={styles.row} data-status={c.status}>
      <span className={styles.number} aria-hidden="true">
        {number}
      </span>
      {/* A larger mouse target for opening; keyboard users have the Open button. */}
      <div className={styles.thumb} onClick={onOpen} aria-hidden="true">
        {c.thumbnail ? (
          <img src={c.thumbnail} alt="" draggable={false} className={styles.image} />
        ) : (
          <PlaceholderWake />
        )}
      </div>
      <div className={styles.body}>
        <h3 className={styles.title}>
          <span className="visually-hidden">Track {number}: </span>
          {customName ? c.name : <Materials visual={visual} sound={sound} />}
        </h3>
        {customName ? (
          <p className={styles.detail}>
            <Materials visual={visual} sound={sound} />
          </p>
        ) : null}
        <p className={styles.detail}>
          <span data-testid="track-open">
            Open: {open.length > 0 ? propertyList(open) : 'none'}
          </span>
          {overrides.length > 0 ? <span> · Unlocked: {propertyList(overrides)}</span> : null}
          <span aria-hidden="true"> · </span>
          <span data-testid="track-seed">Seed {formatSeed(c.seed)}</span>
        </p>
        {preview ? <p className={styles.notes}>“{preview}”</p> : null}
        <p className={styles.detail} data-testid="track-render">
          {renderFile ? `Rendered: ${renderFile}` : 'Not rendered'}
        </p>
      </div>
      <div className={styles.controls}>
        <SegmentedControl
          label={`Status of track ${number}`}
          hideLabel
          options={STATUS_OPTIONS.map((o) => o.label)}
          value={statusIndex}
          onChange={(i) => onStatus(STATUS_OPTIONS[i]?.value ?? 'draft')}
        />
        <div className={styles.buttons}>
          <Button
            variant="quiet"
            aria-label={`Notes for track ${number}`}
            aria-expanded={notesOpen}
            aria-controls={notesOpen ? notesId : undefined}
            onClick={() => setNotesOpen((o) => !o)}
          >
            Notes
          </Button>
          <Button onClick={onOpen} aria-label={`Open in Studio: track ${number}`}>
            Open in Studio
          </Button>
        </div>
      </div>
      {notesOpen ? (
        <div id={notesId} className={styles.notesEditor}>
          <NotesEditor label={`Notes for track ${number}`} initial={c.notes} onSave={onNotes} />
        </div>
      ) : null}
    </li>
  );
}

const SAVE_DELAY_MS = 700;

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const SAVE_TEXT: Record<SaveState, string> = {
  idle: '',
  saving: 'Saving…',
  saved: 'Saved',
  error:
    'Couldn’t save these notes. They’re still here; keep typing or click elsewhere to try again.',
};

/** Notes save a moment after typing stops, when the field loses focus, and when it closes. */
function NotesEditor({
  label,
  initial,
  onSave,
}: {
  label: string;
  initial: string;
  onSave: (notes: string) => Promise<void>;
}) {
  const [text, setText] = useState(initial);
  const [state, setState] = useState<SaveState>('idle');
  const pending = useRef<{ timer: number | null; latest: string; saved: string }>({
    timer: null,
    latest: initial,
    saved: initial,
  });
  const save = useRef(onSave);
  useEffect(() => {
    save.current = onSave;
  });

  const flush = useCallback(async () => {
    const p = pending.current;
    if (p.timer !== null) {
      window.clearTimeout(p.timer);
      p.timer = null;
    }
    if (p.latest === p.saved) return;
    const value = p.latest;
    const before = p.saved;
    p.saved = value;
    setState('saving');
    try {
      await save.current(value);
      setState('saved');
    } catch {
      p.saved = before;
      setState('error');
    }
  }, []);

  // Closing the notes (or leaving the album) saves what was typed.
  useEffect(() => () => void flush(), [flush]);

  return (
    <div className={styles.editor}>
      <textarea
        className={styles.textarea}
        aria-label={label}
        value={text}
        rows={4}
        placeholder="Discoveries, failures, rough places, revisions…"
        onChange={(event) => {
          const value = event.target.value;
          setText(value);
          const p = pending.current;
          p.latest = value;
          if (p.timer !== null) window.clearTimeout(p.timer);
          p.timer = window.setTimeout(() => void flush(), SAVE_DELAY_MS);
        }}
        onBlur={() => void flush()}
      />
      <p className={state === 'error' ? styles.saveError : styles.saveState}>{SAVE_TEXT[state]}</p>
    </div>
  );
}
