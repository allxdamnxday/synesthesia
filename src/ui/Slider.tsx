import { useCallback, useId, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent, PointerEvent } from 'react';
import styles from './Slider.module.css';
import {
  fineDragValue,
  fractionOf,
  keyboardValue,
  quantize,
  valueFromPosition,
} from './sliderMath';
import { isDoubleTap, touchIntent, type Tap } from './touchMath';

/** Where a change sits in a gesture, so callers can group one drag into one undo step. */
export type SliderPhase = 'start' | 'change' | 'end';

export interface SliderProps {
  label: string;
  value: number;
  onChange: (value: number, phase: SliderPhase) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Double-click (or Backspace/Delete) returns here; shown as a small mark on the track. */
  baseline?: number;
  /** Plain-language description, shown as a tooltip and to screen readers. */
  description?: string;
  /** How the value reads out, e.g. `v => v.toFixed(2)` or `v => `${v}×``. */
  format?: (value: number) => string;
  disabled?: boolean;
  /** Locked by chance: dimmed with a lock; `onUnlock` makes it playable again. */
  locked?: boolean;
  onUnlock?: () => void;
  /** Accent for linked shared properties. */
  accent?: 'honey' | 'water';
  /** Always show the value (e.g. Speed), not only on hover and focus. */
  showValue?: boolean;
}

const defaultFormat = (v: number) => v.toFixed(2);

/** Sideways travel (px) that turns a touch on the track into a drag. */
const TOUCH_SLOP_PX = 6;

/** A finger (or pen) on the track, not yet known to be a drag, a scroll or a tap. */
interface Press {
  pointerId: number;
  x: number;
  y: number;
  scrolling: boolean;
}

/**
 * Horizontal slider with a large hit area (SPEC 9.2, 13.1): double-click resets to the
 * baseline, Shift-drag for fine control, arrow keys nudge, value reads out on hover and
 * focus.
 *
 * Touch: a sideways drag moves it while the page stays put, an up or down swipe that starts
 * on it still scrolls the page, a tap jumps like a click, a double-tap resets, and a tap on
 * its name shows its description (there is no hover to show the tooltip).
 */
export function Slider({
  label,
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.01,
  baseline,
  description,
  format = defaultFormat,
  disabled = false,
  locked = false,
  onUnlock,
  accent = 'honey',
  showValue = false,
}: SliderProps) {
  const id = useId();
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startValue: number;
    fine: boolean;
  } | null>(null);
  const press = useRef<Press | null>(null);
  const lastPointer = useRef<string>('mouse');
  const lastTap = useRef<Tap | null>(null);
  /** A touch drag just ended: the click the browser may still send isn't a tap. */
  const dragged = useRef(false);
  const [active, setActive] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const inert = disabled || locked;

  const emit = useCallback(
    (next: number, phase: SliderPhase) => onChange(quantize(next, step / 10, min, max), phase),
    [onChange, step, min, max],
  );

  const positionValue = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    return rect ? valueFromPosition(clientX - rect.left, rect.width, min, max) : value;
  };

  const startDrag = (e: PointerEvent<HTMLDivElement>, fine: boolean) => {
    const track = trackRef.current;
    if (!track) return;
    track.setPointerCapture(e.pointerId);
    track.focus({ preventScroll: true });
    drag.current = { pointerId: e.pointerId, startX: e.clientX, startValue: value, fine };
    setActive(true);
    emit(fine ? value : positionValue(e.clientX), 'start');
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    lastPointer.current = e.pointerType;
    dragged.current = false;
    if (inert || e.button !== 0) return;
    if (e.pointerType === 'mouse') {
      e.preventDefault();
      startDrag(e, e.shiftKey);
      return;
    }
    // A finger: wait to see whether it moves sideways (a drag), up or down (the page
    // scrolls: touch-action pan-y) or not at all (a tap, handled on click).
    press.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, scrolling: false };
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (p && p.pointerId === e.pointerId) {
      if (p.scrolling) return;
      const intent = touchIntent(e.clientX - p.x, e.clientY - p.y, TOUCH_SLOP_PX);
      if (intent === 'scroll') {
        p.scrolling = true;
      } else if (intent === 'drag') {
        press.current = null;
        dragged.current = true;
        startDrag(e, false);
      }
      return;
    }
    const d = drag.current;
    const track = trackRef.current;
    if (!d || !track || d.pointerId !== e.pointerId) return;
    const rect = track.getBoundingClientRect();
    if (e.shiftKey !== d.fine) {
      // Switching modes mid-drag: continue from the current value without a jump.
      drag.current = { ...d, startX: e.clientX, startValue: value, fine: e.shiftKey };
      return;
    }
    const next = d.fine
      ? fineDragValue(d.startValue, e.clientX - d.startX, rect.width, min, max)
      : valueFromPosition(e.clientX - rect.left, rect.width, min, max);
    emit(next, 'change');
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (press.current?.pointerId === e.pointerId) press.current = null;
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    setActive(false);
    emit(value, 'end');
  };

  /** Taps by finger or pen: jump there, or reset on a second tap (mouse acts on press). */
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if (lastPointer.current === 'mouse' || inert) return;
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    const tap = { time: e.timeStamp, x: e.clientX, y: e.clientY };
    if (baseline !== undefined && isDoubleTap(lastTap.current, tap)) {
      lastTap.current = null;
      onChange(baseline, 'end');
      return;
    }
    lastTap.current = tap;
    trackRef.current?.focus({ preventScroll: true });
    const next = positionValue(e.clientX);
    emit(next, 'start');
    emit(next, 'end');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (inert) return;
    if ((e.key === 'Backspace' || e.key === 'Delete') && baseline !== undefined) {
      e.preventDefault();
      onChange(baseline, 'end');
      return;
    }
    const next = keyboardValue(e.key, e.shiftKey, value, step, min, max);
    if (next === null) return;
    e.preventDefault();
    onChange(next, 'end');
  };

  const onDoubleClick = () => {
    // Touch double-taps are counted in onClick.
    if (lastPointer.current !== 'mouse') return;
    if (!inert && baseline !== undefined) onChange(baseline, 'end');
  };

  /** Touch screens have no tooltip: a tap on the name shows the description instead. */
  const onLabelClick = () => {
    if (description && lastPointer.current !== 'mouse') setNoteOpen((open) => !open);
  };

  const fraction = fractionOf(value, min, max);
  const baselineFraction = baseline === undefined ? null : fractionOf(baseline, min, max);
  const classes = [
    styles.slider,
    active ? styles.active : '',
    inert ? styles.inert : '',
    accent === 'water' ? styles.water : '',
    showValue ? styles.showValue : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={classes}
      title={description}
      onPointerDownCapture={(e) => {
        lastPointer.current = e.pointerType;
      }}
    >
      <div className={styles.header}>
        <label
          className={`${styles.label} ${description ? styles.described : ''}`}
          id={`${id}-label`}
          htmlFor={id}
          onClick={onLabelClick}
        >
          {label}
        </label>
        {locked && onUnlock ? (
          <button
            type="button"
            className={styles.lock}
            onClick={onUnlock}
            aria-label={`Unlock ${label}`}
            title="Locked by chance. Unlock to change it (this is recorded)."
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path
                d="M4.5 7V5a3.5 3.5 0 1 1 7 0v2M3.5 7h9v7h-9z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
              />
            </svg>
          </button>
        ) : null}
        <output className={styles.readout} htmlFor={id} aria-hidden="true">
          {format(value)}
        </output>
      </div>
      <div
        ref={trackRef}
        id={id}
        className={styles.track}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-labelledby={`${id}-label`}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={format(value)}
        aria-disabled={inert || undefined}
        aria-description={description}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={onClick}
        onKeyDown={onKeyDown}
        onDoubleClick={onDoubleClick}
      >
        <div className={styles.rail}>
          <div className={styles.fill} style={{ width: `${fraction * 100}%` }} />
          {baselineFraction !== null ? (
            <div className={styles.baseline} style={{ left: `${baselineFraction * 100}%` }} />
          ) : null}
        </div>
        <div className={styles.thumb} style={{ left: `${fraction * 100}%` }} />
      </div>
      {noteOpen && description ? (
        <p className={styles.note} aria-hidden="true">
          {description}
        </p>
      ) : null}
    </div>
  );
}
