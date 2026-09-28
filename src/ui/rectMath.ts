/**
 * Pure geometry for normalized rectangles: 0..1 of a frame, x right, y down, top-left
 * corner at (x, y). Used by FocusBox (drawing, moving and resizing a box) and tested in
 * tests/unit/rect-math.test.ts.
 */

export interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Smallest box allowed, as a fraction of the frame on each axis. */
export interface MinSize {
  w: number;
  h: number;
}

/** Edges and corners by compass point (n = top edge, se = bottom-right corner…). */
export type RectHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export const RECT_HANDLES: readonly RectHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const NO_MIN: MinSize = { w: 0, h: 0 };

function clampTo(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/** Make any rect valid: finite, inside the frame, at least `min` and at most 1 in size. */
export function clampRect(rect: NormRect, min: MinSize = NO_MIN): NormRect {
  const minW = clampTo(finiteOr(min.w, 0), 0, 1);
  const minH = clampTo(finiteOr(min.h, 0), 0, 1);
  const w = clampTo(finiteOr(rect.w, 1), minW, 1);
  const h = clampTo(finiteOr(rect.h, 1), minH, 1);
  return {
    x: clampTo(finiteOr(rect.x, 0), 0, 1 - w),
    y: clampTo(finiteOr(rect.y, 0), 0, 1 - h),
    w,
    h,
  };
}

/** Move without resizing; the box stops at the frame's edges. */
export function moveRect(rect: NormRect, dx: number, dy: number): NormRect {
  return {
    x: clampTo(rect.x + dx, 0, Math.max(0, 1 - rect.w)),
    y: clampTo(rect.y + dy, 0, Math.max(0, 1 - rect.h)),
    w: rect.w,
    h: rect.h,
  };
}

/**
 * Drag one edge or corner by (dx, dy). The opposite side stays put; the box never turns
 * inside out, never gets smaller than `min`, and never leaves the frame.
 */
export function resizeRect(
  rect: NormRect,
  handle: RectHandle,
  dx: number,
  dy: number,
  min: MinSize = NO_MIN,
): NormRect {
  let left = rect.x;
  let top = rect.y;
  let right = rect.x + rect.w;
  let bottom = rect.y + rect.h;
  if (handle.includes('w')) left = clampTo(left + dx, 0, Math.max(0, right - min.w));
  if (handle.includes('e')) right = clampTo(right + dx, Math.min(1, left + min.w), 1);
  if (handle.includes('n')) top = clampTo(top + dy, 0, Math.max(0, bottom - min.h));
  if (handle.includes('s')) bottom = clampTo(bottom + dy, Math.min(1, top + min.h), 1);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** The box spanned by a drag from (ax, ay) to (bx, by), clipped to the frame. */
export function rectFromPoints(ax: number, ay: number, bx: number, by: number): NormRect {
  const x0 = clampTo(Math.min(ax, bx), 0, 1);
  const x1 = clampTo(Math.max(ax, bx), 0, 1);
  const y0 = clampTo(Math.min(ay, by), 0, 1);
  const y1 = clampTo(Math.max(ay, by), 0, 1);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** True when the box is at least `min` on both axes (with a little float tolerance). */
export function meetsMinimum(rect: NormRect, min: MinSize): boolean {
  return rect.w >= min.w - 1e-9 && rect.h >= min.h - 1e-9;
}

/** A box of the given size, centred in the frame. */
export function centeredRect(w: number, h: number): NormRect {
  const cw = clampTo(w, 0, 1);
  const ch = clampTo(h, 0, 1);
  return { x: (1 - cw) / 2, y: (1 - ch) / 2, w: cw, h: ch };
}

/** Round to `decimals` places (0.0001 of a 1080p frame is a tenth of a pixel). */
export function roundRect(rect: NormRect, decimals = 4): NormRect {
  const k = 10 ** decimals;
  const r = (v: number) => Math.round(v * k) / k;
  return { x: r(rect.x), y: r(rect.y), w: r(rect.w), h: r(rect.h) };
}

/** Whether a point lies inside the box (edges included). */
export function containsPoint(rect: NormRect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}
