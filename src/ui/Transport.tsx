import type { ReactNode } from 'react';
import { formatTime, ScrubBar, wantsTenths, type ScrubBarProps } from './ScrubBar';
import styles from './Transport.module.css';

export interface TransportProps extends Pick<ScrubBarProps, 'markers' | 'tailStart'> {
  playing: boolean;
  onPlayPause: () => void;
  loop: boolean;
  onLoopChange: (loop: boolean) => void;
  position: number;
  duration: number;
  onSeek: ScrubBarProps['onSeek'];
  /** Shown while the wake fast-forwards after a seek. */
  catchingUp?: boolean;
  /** Extra controls on the right (snapshots, Draw by chance). */
  children?: ReactNode;
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <path d="M6 4l10 6-10 6z" fill="currentColor" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <path d="M5 4h3.5v12H5zM11.5 4H15v12h-3.5z" fill="currentColor" />
    </svg>
  );
}

function LoopIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <path
        d="M4 8a4 4 0 0 1 4-4h6l-2-2M16 12a4 4 0 0 1-4 4H6l2 2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Play/pause, loop, scrub bar and time (SPEC 6.3, 13.3). */
export function Transport({
  playing,
  onPlayPause,
  loop,
  onLoopChange,
  position,
  duration,
  onSeek,
  markers,
  tailStart,
  catchingUp = false,
  children,
}: TransportProps) {
  return (
    <div className={styles.transport}>
      <button
        type="button"
        className={`${styles.round} ${styles.play}`}
        onClick={onPlayPause}
        aria-label={playing ? 'Pause' : 'Play'}
        title={playing ? 'Pause (Space)' : 'Play (Space)'}
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <button
        type="button"
        className={`${styles.round} ${loop ? styles.on : ''}`}
        onClick={() => onLoopChange(!loop)}
        aria-pressed={loop}
        aria-label="Loop"
        title="Loop (L)"
      >
        <LoopIcon />
      </button>
      <ScrubBar
        position={position}
        duration={duration}
        onSeek={onSeek}
        markers={markers}
        tailStart={tailStart}
      />
      <span className={styles.time} aria-live="off">
        {formatTime(position, wantsTenths(duration))} /{' '}
        {formatTime(duration, wantsTenths(duration))}
      </span>
      {/* The smallest phones show only the playhead's time (the scrub bar says the rest). */}
      <span className={styles.timeShort} aria-hidden="true">
        {formatTime(position, wantsTenths(duration))}
      </span>
      {catchingUp ? (
        <span className={styles.catching} role="status">
          Catching up…
        </span>
      ) : null}
      {children ? <div className={styles.extra}>{children}</div> : null}
    </div>
  );
}
