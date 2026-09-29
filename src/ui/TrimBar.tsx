import { useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, RefObject } from 'react';
import type { SliderPhase } from './Slider';
import { clampTo, fractionOf, valueFromPosition } from './sliderMath';
import styles from './TrimBar.module.css';

export type TrimEdge = 'start' | 'end';

export interface TrimBarProps {
  /** Length of the whole clip, seconds. */
  duration: number;
  start: number;
  end: number;
  /** Playhead, seconds. */
  position: number;
  /** One frame in seconds: arrow keys move by a frame, Shift+arrows by a second. */
  frameStep: number;
  /** A trim handle moved. The parent snaps and clamps, then passes the result back. */
  onTrim: (edge: TrimEdge, seconds: number, phase: SliderPhase) => void;
  /** The playhead moved (dragged, clicked on the bar, or keyed). The parent clamps it. */
  onSeek: (seconds: number, phase: SliderPhase) => void;
  format?: (seconds: number) => string;
  disabled?: boolean;
  /** A selection longer than this is drawn as too long. */
  maxLength?: number;
}

type DragKind = TrimEdge | 'head';

interface Drag {
  kind: DragKind;
  pointerId: number;
  /** Where the pointer grabbed the handle, relative to the handle's time. */
  offset: number;
  /** Where the drag last put it, for a touch the system cancels. */
  last: number;
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const defaultFormat = (s: number) => `${s.toFixed(2)} s`;

/**
 * A clip timeline with start and end trim handles and a playhead (SPEC 6.2). Drag the
 * handles to trim; click or drag anywhere else to move the playhead. Each of the three is a
 * keyboard slider: arrows move one frame, Shift+arrows (or Page keys) one second.
 */
export function TrimBar({
  duration,
  start,
  end,
  position,
  frameStep,
  onTrim,
  onSeek,
  format = defaultFormat,
  disabled = false,
  maxLength,
}: TrimBarProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [active, setActive] = useState<DragKind | null>(null);

  const timeAt = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return position;
    return valueFromPosition(clientX - rect.left, rect.width, 0, duration);
  };

  const emit = (kind: DragKind, seconds: number, phase: SliderPhase) => {
    const t = clampTo(seconds, 0, duration);
    if (kind === 'head') onSeek(t, phase);
    else onTrim(kind, t, phase);
  };

  const refFor = (kind: DragKind): RefObject<HTMLDivElement | null> =>
    kind === 'start' ? startRef : kind === 'end' ? endRef : headRef;

  const begin = (kind: DragKind, e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0 || duration <= 0) return;
    const track = trackRef.current;
    if (!track) return;
    e.preventDefault();
    e.stopPropagation();
    track.setPointerCapture(e.pointerId);
    refFor(kind).current?.focus({ preventScroll: true });
    const t = timeAt(e.clientX);
    const current = kind === 'start' ? start : kind === 'end' ? end : t;
    drag.current = { kind, pointerId: e.pointerId, offset: current - t, last: current };
    setActive(kind);
    emit(kind, t + (current - t), 'start');
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    d.last = timeAt(e.clientX) + d.offset;
    emit(d.kind, d.last, 'change');
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    setActive(null);
    emit(d.kind, e.type === 'pointerup' ? timeAt(e.clientX) + d.offset : d.last, 'end');
  };

  const onKeyDown = (kind: DragKind) => (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const current = kind === 'start' ? start : kind === 'end' ? end : position;
    let next: number;
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        next = current - (e.shiftKey ? 1 : frameStep);
        break;
      case 'ArrowRight':
      case 'ArrowUp':
        next = current + (e.shiftKey ? 1 : frameStep);
        break;
      case 'PageDown':
        next = current - 1;
        break;
      case 'PageUp':
        next = current + 1;
        break;
      case 'Home':
        next = kind === 'head' ? start : 0;
        break;
      case 'End':
        next = kind === 'head' ? end : duration;
        break;
      default:
        return;
    }
    e.preventDefault();
    emit(kind, next, 'end');
  };

  const pct = (t: number) => `${fractionOf(t, 0, duration) * 100}%`;
  const width = `${(fractionOf(end, 0, duration) - fractionOf(start, 0, duration)) * 100}%`;
  const tooLong = maxLength !== undefined && end - start > maxLength + 1e-3;
  const tabIndex = disabled ? -1 : 0;

  return (
    <div className={`${styles.trim} ${disabled ? styles.disabled : ''}`}>
      <div
        ref={trackRef}
        className={styles.track}
        onPointerDown={(e) => begin('head', e)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onLostPointerCapture={onPointerUp}
      >
        <div className={styles.rail} />
        <div className={styles.outside} style={{ left: 0, width: pct(start) }} />
        <div className={styles.outside} style={{ left: pct(end), right: 0 }} />
        <div
          className={`${styles.selection} ${tooLong ? styles.tooLong : ''}`}
          style={{ left: pct(start), width }}
        />
        <div
          ref={headRef}
          role="slider"
          aria-label="Playhead"
          tabIndex={tabIndex}
          aria-valuemin={round2(start)}
          aria-valuemax={round2(end)}
          aria-valuenow={round2(position)}
          aria-valuetext={format(position)}
          aria-disabled={disabled || undefined}
          className={`${styles.head} ${active === 'head' ? styles.activeHead : ''}`}
          style={{ left: pct(position) }}
          onPointerDown={(e) => begin('head', e)}
          onKeyDown={onKeyDown('head')}
        />
        <div
          ref={startRef}
          role="slider"
          aria-label="Trim start"
          tabIndex={tabIndex}
          aria-valuemin={0}
          aria-valuemax={round2(end)}
          aria-valuenow={round2(start)}
          aria-valuetext={format(start)}
          aria-disabled={disabled || undefined}
          className={`${styles.handle} ${styles.startHandle} ${active === 'start' ? styles.activeHandle : ''}`}
          style={{ left: pct(start) }}
          onPointerDown={(e) => begin('start', e)}
          onKeyDown={onKeyDown('start')}
        />
        <div
          ref={endRef}
          role="slider"
          aria-label="Trim end"
          tabIndex={tabIndex}
          aria-valuemin={round2(start)}
          aria-valuemax={round2(duration)}
          aria-valuenow={round2(end)}
          aria-valuetext={format(end)}
          aria-disabled={disabled || undefined}
          className={`${styles.handle} ${styles.endHandle} ${active === 'end' ? styles.activeHandle : ''}`}
          style={{ left: pct(end) }}
          onPointerDown={(e) => begin('end', e)}
          onKeyDown={onKeyDown('end')}
        />
      </div>
    </div>
  );
}
