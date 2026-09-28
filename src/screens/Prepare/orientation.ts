/**
 * Rotate and Mirror on the Prepare screen, in normalized coordinates (0..1, x right, y down).
 *
 * The model matches extraction (src/signature/frameGeometry.ts): the clip as the browser
 * shows it (its own rotation metadata already applied) is rotated clockwise by `rotate`,
 * then flipped horizontally when `mirror` is on. The focus area is a box in that final,
 * displayed frame, which is exactly what `ExtractionOptions.focusArea` expects.
 *
 * When the person changes Rotate or Mirror, the box is carried along with the picture
 * (`reorientRect`) so it keeps covering the same part of the clip.
 */
import type { Rotation } from '../../signature/types';
import type { NormRect } from '../../ui/rectMath';

export interface ViewOrientation {
  rotate: Rotation;
  mirror: boolean;
}

export const ROTATIONS: readonly Rotation[] = [0, 90, 180, 270];

/** Where a point of the unrotated clip lands after rotating (clockwise) and mirroring. */
export function orientPoint(x: number, y: number, o: ViewOrientation): [number, number] {
  let px: number;
  let py: number;
  switch (o.rotate) {
    case 90:
      px = 1 - y;
      py = x;
      break;
    case 180:
      px = 1 - x;
      py = 1 - y;
      break;
    case 270:
      px = y;
      py = 1 - x;
      break;
    default:
      px = x;
      py = y;
  }
  return [o.mirror ? 1 - px : px, py];
}

/** The inverse of orientPoint: a displayed point back in the unrotated clip. */
export function unorientPoint(x: number, y: number, o: ViewOrientation): [number, number] {
  const px = o.mirror ? 1 - x : x;
  switch (o.rotate) {
    case 90:
      return [y, 1 - px];
    case 180:
      return [1 - px, 1 - y];
    case 270:
      return [1 - y, px];
    default:
      return [px, y];
  }
}

function mapRect(rect: NormRect, f: (x: number, y: number) => [number, number]): NormRect {
  const [ax, ay] = f(rect.x, rect.y);
  const [bx, by] = f(rect.x + rect.w, rect.y + rect.h);
  return {
    x: Math.min(ax, bx),
    y: Math.min(ay, by),
    w: Math.abs(bx - ax),
    h: Math.abs(by - ay),
  };
}

/** A box in the unrotated clip, as it appears after `o`. */
export function orientRect(rect: NormRect, o: ViewOrientation): NormRect {
  return mapRect(rect, (x, y) => orientPoint(x, y, o));
}

/** A displayed box (under `o`) back in the unrotated clip. */
export function unorientRect(rect: NormRect, o: ViewOrientation): NormRect {
  return mapRect(rect, (x, y) => unorientPoint(x, y, o));
}

/** Carry a displayed box from one orientation to another, keeping it on the same content. */
export function reorientRect(rect: NormRect, from: ViewOrientation, to: ViewOrientation): NormRect {
  return orientRect(unorientRect(rect, from), to);
}

/** Size of a width × height picture after rotating it. */
export function orientedSize(
  width: number,
  height: number,
  rotate: Rotation,
): { width: number; height: number } {
  return rotate === 90 || rotate === 270 ? { width: height, height: width } : { width, height };
}

/**
 * The CSS transform that shows an element rotated and mirrored like extraction does.
 * CSS applies the rightmost function first: rotate, then mirror.
 */
export function orientationTransform(o: ViewOrientation): string {
  const parts: string[] = [];
  if (o.mirror) parts.push('scaleX(-1)');
  if (o.rotate !== 0) parts.push(`rotate(${o.rotate}deg)`);
  return parts.length > 0 ? parts.join(' ') : 'none';
}

/**
 * The largest box with the given aspect ratio (width / height) that fits, centred, in a
 * container (CSS "contain"). Values are in the container's pixels.
 */
export function fitRect(
  containerWidth: number,
  containerHeight: number,
  aspect: number,
): { x: number; y: number; width: number; height: number } {
  const cw = Math.max(0, containerWidth);
  const ch = Math.max(0, containerHeight);
  if (!(aspect > 0) || cw === 0 || ch === 0) return { x: 0, y: 0, width: cw, height: ch };
  let width = cw;
  let height = cw / aspect;
  if (height > ch) {
    height = ch;
    width = ch * aspect;
  }
  return { x: (cw - width) / 2, y: (ch - height) / 2, width, height };
}
