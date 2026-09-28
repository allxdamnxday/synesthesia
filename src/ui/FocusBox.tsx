import { useId, useRef } from 'react';
import type { KeyboardEvent, PointerEvent, Ref } from 'react';
import styles from './FocusBox.module.css';
import {
  RECT_HANDLES,
  clampRect,
  containsPoint,
  moveRect,
  rectFromPoints,
  resizeRect,
  type MinSize,
  type NormRect,
  type RectHandle,
} from './rectMath';
import type { SliderPhase } from './Slider';

export interface FocusBoxProps {
  /** The box, normalized to this layer (0..1); null when there is none. */
  rect: NormRect | null;
  onChange: (rect: NormRect | null, phase: SliderPhase) => void;
  /** Smallest box, as a fraction of the layer on each axis. */
  minSize: MinSize;
  disabled?: boolean;
  /** Show the box as an outline only (no drawing, moving or resizing). */
  readOnly?: boolean;
  /** The box element, so a "Draw a box" button can focus it. */
  boxRef?: Ref<HTMLDivElement>;
}

type Point = [number, number];

type Gesture =
  | {
      kind: 'draw';
      pointerId: number;
      origin: Point;
      client: Point;
      previous: NormRect | null;
      started: boolean;
    }
  | { kind: 'move'; pointerId: number; origin: Point; start: NormRect }
  | { kind: 'resize'; pointerId: number; origin: Point; start: NormRect; handle: RectHandle };

/** Pointer travel (px) before a press on empty picture starts drawing a new box. */
const DRAW_THRESHOLD_PX = 4;
/** Arrow keys move or resize by 1% of the frame (5% with Shift). */
const KEY_STEP = 0.01;
const KEY_STEP_LARGE = 0.05;

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** A plain description of the box for screen readers and the settings panel. */
export function describeFocusRect(rect: NormRect): string {
  return `${pct(rect.w)} wide and ${pct(rect.h)} tall, ${pct(rect.x)} from the left and ${pct(rect.y)} from the top`;
}

/**
 * A box drawn over a picture (the focus area, SPEC 6.2). Drag on the picture to draw it;
 * drag inside it to move it; drag its edges or corners to resize it. When it has keyboard
 * focus, arrow keys move it, Option/Alt + arrows resize it and Delete removes it.
 * Everything outside the box is dimmed.
 */
export function FocusBox({
  rect,
  onChange,
  minSize,
  disabled = false,
  readOnly = false,
  boxRef,
}: FocusBoxProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const boxEl = useRef<HTMLDivElement | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const hintId = useId();
  const inert = disabled || readOnly;

  const setBox = (el: HTMLDivElement | null) => {
    boxEl.current = el;
    if (typeof boxRef === 'function') boxRef(el);
    else if (boxRef) boxRef.current = el;
  };

  const pointAt = (e: PointerEvent<HTMLDivElement>): Point => {
    const r = layerRef.current?.getBoundingClientRect();
    if (!r || r.width <= 0 || r.height <= 0) return [0, 0];
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    return [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))];
  };

  const shaped = (g: Exclude<Gesture, { kind: 'draw' }>, [x, y]: Point): NormRect => {
    const dx = x - g.origin[0];
    const dy = y - g.origin[1];
    return g.kind === 'move'
      ? moveRect(g.start, dx, dy)
      : resizeRect(g.start, g.handle, dx, dy, minSize);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (inert || e.button !== 0) return;
    const layer = layerRef.current;
    if (!layer) return;
    e.preventDefault();
    layer.setPointerCapture(e.pointerId);
    const origin = pointAt(e);
    const handle = (e.target as HTMLElement).dataset.handle as RectHandle | undefined;
    if (rect && handle) {
      gesture.current = { kind: 'resize', pointerId: e.pointerId, origin, start: rect, handle };
      onChange(rect, 'start');
    } else if (rect && containsPoint(rect, origin[0], origin[1])) {
      gesture.current = { kind: 'move', pointerId: e.pointerId, origin, start: rect };
      onChange(rect, 'start');
    } else {
      gesture.current = {
        kind: 'draw',
        pointerId: e.pointerId,
        origin,
        client: [e.clientX, e.clientY],
        previous: rect,
        started: false,
      };
    }
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    const p = pointAt(e);
    if (g.kind !== 'draw') {
      onChange(shaped(g, p), 'change');
      return;
    }
    if (!g.started) {
      const travel = Math.hypot(e.clientX - g.client[0], e.clientY - g.client[1]);
      if (travel < DRAW_THRESHOLD_PX) return;
      g.started = true;
      onChange(rectFromPoints(g.origin[0], g.origin[1], p[0], p[1]), 'start');
      return;
    }
    onChange(rectFromPoints(g.origin[0], g.origin[1], p[0], p[1]), 'change');
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    gesture.current = null;
    const p = pointAt(e);
    if (g.kind !== 'draw') {
      onChange(shaped(g, p), 'end');
    } else if (g.started) {
      const drawn = rectFromPoints(g.origin[0], g.origin[1], p[0], p[1]);
      // A box much smaller than the minimum was probably a slip: keep what was there.
      const slip = drawn.w < minSize.w / 2 || drawn.h < minSize.h / 2;
      onChange(slip ? g.previous : clampRect(drawn, minSize), 'end');
    } else {
      return; // A click on the picture changes nothing.
    }
    requestAnimationFrame(() => boxEl.current?.focus({ preventScroll: true }));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!rect || inert) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      onChange(null, 'end');
      return;
    }
    const step = e.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
    let dx = 0;
    let dy = 0;
    if (e.key === 'ArrowLeft') dx = -step;
    else if (e.key === 'ArrowRight') dx = step;
    else if (e.key === 'ArrowUp') dy = -step;
    else if (e.key === 'ArrowDown') dy = step;
    else return;
    e.preventDefault();
    const next = e.altKey
      ? resizeRect(rect, dx !== 0 ? 'e' : 's', dx, dy, minSize)
      : moveRect(rect, dx, dy);
    onChange(next, 'end');
  };

  const classes = [styles.layer, readOnly ? styles.readOnly : '', disabled ? styles.disabled : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={layerRef}
      className={classes}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      data-testid="focus-layer"
    >
      {rect ? (
        <div
          ref={setBox}
          className={styles.box}
          style={{
            left: `${rect.x * 100}%`,
            top: `${rect.y * 100}%`,
            width: `${rect.w * 100}%`,
            height: `${rect.h * 100}%`,
          }}
          role="group"
          aria-roledescription="focus area"
          aria-label={`Focus area: ${describeFocusRect(rect)}`}
          aria-describedby={inert ? undefined : hintId}
          tabIndex={inert ? -1 : 0}
          onKeyDown={onKeyDown}
        >
          {inert
            ? null
            : RECT_HANDLES.map((h) => (
                <div
                  key={h}
                  data-handle={h}
                  className={`${styles.handle} ${styles[h]}`}
                  aria-hidden="true"
                />
              ))}
        </div>
      ) : null}
      {inert ? null : (
        <span id={hintId} className="visually-hidden">
          Arrow keys move the box. Hold Option or Alt with the arrow keys to resize it. Delete
          removes it.
        </span>
      )}
    </div>
  );
}
