import { useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import styles from './ScrubBar.module.css';
import type { SliderPhase } from './Slider';
import { clampTo, fractionOf, valueFromPosition } from './sliderMath';

export interface ScrubBarProps {
  /** Playhead in seconds of composition time. */
  position: number;
  duration: number;
  onSeek: (seconds: number, phase: SliderPhase) => void;
  /** Composition times of onsets: moments where the movement gathers. */
  markers?: readonly number[];
  /** When the movement ends and the wake settles (start of the tail). */
  tailStart?: number;
  label?: string;
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const minutes = Math.floor(s / 60);
  const secs = Math.floor(s % 60);
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

/** The transport's timeline: scrub to any point; onsets and the tail are marked. */
export function ScrubBar({
  position,
  duration,
  onSeek,
  markers = [],
  tailStart,
  label = 'Playhead',
}: ScrubBarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const timeAt = (clientX: number): number => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return position;
    return valueFromPosition(clientX - rect.left, rect.width, 0, duration);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || duration <= 0) return;
    e.preventDefault();
    ref.current?.setPointerCapture(e.pointerId);
    ref.current?.focus();
    setDragging(true);
    onSeek(timeAt(e.clientX), 'start');
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging) onSeek(timeAt(e.clientX), 'change');
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    onSeek(timeAt(e.clientX), 'end');
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const stepSec = e.shiftKey ? 5 : 1;
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = position + stepSec;
    if (e.key === 'ArrowLeft') next = position - stepSec;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = duration;
    if (next === null) return;
    e.preventDefault();
    onSeek(clampTo(next, 0, duration), 'end');
  };

  const played = fractionOf(position, 0, duration) * 100;
  const tail =
    tailStart !== undefined && duration > 0 ? fractionOf(tailStart, 0, duration) * 100 : null;

  return (
    <div
      ref={ref}
      className={`${styles.scrub} ${dragging ? styles.dragging : ''}`}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Number(duration.toFixed(2))}
      aria-valuenow={Number(position.toFixed(2))}
      aria-valuetext={`${formatTime(position)} of ${formatTime(duration)}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    >
      <div className={styles.rail}>
        {tail !== null && tail < 100 ? (
          <div className={styles.tail} style={{ left: `${tail}%` }} title="The wake settling" />
        ) : null}
        <div className={styles.played} style={{ width: `${played}%` }} />
        {markers.map((t, i) => (
          <div
            key={i}
            className={styles.marker}
            style={{ left: `${fractionOf(t, 0, duration) * 100}%` }}
          />
        ))}
      </div>
      <div className={styles.head} style={{ left: `${played}%` }} />
    </div>
  );
}
