/**
 * Pure geometry and timing for turning a clip into analysis frames (SPEC 8.1 steps 2–4).
 *
 * Orientation model (matches Mediabunny): a frame is rotated clockwise by `rotation`
 * degrees, then optionally flipped horizontally. The container's rotation metadata is
 * applied first, then the user's Rotate and Mirror from the Prepare screen. The focus
 * area is normalized to the frame as displayed after all of that.
 */
import type { FocusArea, Rotation } from './types';

export interface Orientation {
  /** Clockwise degrees, applied first. */
  rotation: Rotation;
  /** Horizontal flip, applied after the rotation. */
  flip: boolean;
}

export interface PixelRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function toRotation(degrees: number): Rotation {
  const r = (((Math.round(degrees / 90) * 90) % 360) + 360) % 360;
  return r as Rotation;
}

/**
 * The single orientation equal to applying `container` and then `user`.
 * Uses R(a)·F = F·R(−a): a flip turns a later rotation around.
 */
export function composeOrientation(
  container: Orientation,
  user: { rotate: Rotation; mirror: boolean },
): Orientation {
  const rotation = container.flip
    ? toRotation(container.rotation - user.rotate)
    : toRotation(container.rotation + user.rotate);
  return { rotation, flip: container.flip !== user.mirror };
}

/** Size of a width × height frame after rotating it. */
export function orientedSize(
  width: number,
  height: number,
  rotation: Rotation,
): { width: number; height: number } {
  return rotation === 90 || rotation === 270 ? { width: height, height: width } : { width, height };
}

/**
 * Where a point (continuous pixel coordinates, 0..width × 0..height, y down) of the raw
 * frame lands after `orientation`. Used by tests to check composition.
 */
export function orientPoint(
  x: number,
  y: number,
  width: number,
  height: number,
  orientation: Orientation,
): [number, number] {
  let px: number;
  let py: number;
  switch (orientation.rotation) {
    case 90:
      px = height - y;
      py = x;
      break;
    case 180:
      px = width - x;
      py = height - y;
      break;
    case 270:
      px = y;
      py = width - x;
      break;
    default:
      px = x;
      py = y;
  }
  if (orientation.flip) px = orientedSize(width, height, orientation.rotation).width - px;
  return [px, py];
}

/** Smallest crop, in source pixels, that extraction accepts. */
export const MIN_CROP_PX = 8;

/**
 * The focus area as an integer pixel rectangle of the oriented frame (null = whole frame).
 * Clamped to the frame and at least MIN_CROP_PX on each side (or the frame size, if
 * smaller). Cropping happens at native resolution, before downscaling.
 */
export function focusCropPx(
  focus: FocusArea | null,
  frameWidth: number,
  frameHeight: number,
): PixelRect {
  if (!focus) return { left: 0, top: 0, width: frameWidth, height: frameHeight };
  const axis = (start: number, size: number, total: number): [number, number] => {
    const s = Number.isFinite(start) ? start : 0;
    const z = Number.isFinite(size) ? size : 1;
    let a = Math.round(Math.min(1, Math.max(0, s)) * total);
    let b = Math.round(Math.min(1, Math.max(0, s + z)) * total);
    const min = Math.min(MIN_CROP_PX, total);
    if (b - a < min) {
      const mid = (a + b) / 2;
      a = Math.round(Math.min(Math.max(0, mid - min / 2), total - min));
      b = a + min;
    }
    return [a, b - a];
  };
  const [left, width] = axis(focus.x, focus.w, frameWidth);
  const [top, height] = axis(focus.y, focus.h, frameHeight);
  return { left, top, width, height };
}

export const MIN_ANALYSIS_WIDTH = 32;
export const MAX_ANALYSIS_WIDTH = 1920;
/** Shortest analysis side, so extreme focus boxes stay workable for optical flow. */
export const MIN_ANALYSIS_SIDE = 16;

/**
 * Analysis frame size (SPEC 8.1 step 4, adjusted; see DECISIONS): the `analysisWidth`
 * option sets the **longer side** of the oriented, cropped frame, and the other side
 * keeps the crop's aspect ratio (at least 16 px). Landscape is unchanged (1920×1080 →
 * 320×180); portrait costs the same (1080×1920 → 180×320) instead of 3× as much.
 */
export function analysisSize(
  cropWidth: number,
  cropHeight: number,
  analysisWidth: number,
): { width: number; height: number } {
  const long = Math.round(
    Math.min(
      MAX_ANALYSIS_WIDTH,
      Math.max(MIN_ANALYSIS_WIDTH, Number.isFinite(analysisWidth) ? analysisWidth : 320),
    ),
  );
  const valid = cropWidth > 0 && cropHeight > 0;
  const landscape = !valid || cropWidth >= cropHeight;
  const ratio = valid ? Math.min(cropWidth, cropHeight) / Math.max(cropWidth, cropHeight) : 9 / 16;
  const short = Math.round(Math.max(MIN_ANALYSIS_SIDE, long * ratio));
  return landscape ? { width: long, height: short } : { width: short, height: long };
}

/** Analysis frame rate: the clip's own rate, capped at `maxFps` (SPEC 8.1 step 2). */
export function analysisFrameRate(nativeFps: number, maxFps: number): number {
  return Math.min(nativeFps, maxFps);
}

/**
 * Times (seconds) at which analysis frames are taken from [startSec, endSec): the middle
 * of each 1/fps interval, so a clip at its own frame rate yields every frame exactly once
 * even with float rounding, and variable-frame-rate clips become constant-rate.
 */
export function sampleTimestamps(startSec: number, endSec: number, fps: number): Float64Array {
  const count = Math.max(0, Math.floor((endSec - startSec) * fps + 1e-6));
  const times = new Float64Array(count);
  for (let i = 0; i < count; i++) times[i] = startSec + (i + 0.5) / fps;
  return times;
}

/**
 * RGBA → 8-bit luma (BT.601 weights 77/150/29 of 256, rounded). Integer maths, so the
 * result is identical on every machine for the same pixels.
 */
export function rgbaToGray(rgba: ArrayLike<number>, out: Uint8Array): Uint8Array {
  const n = out.length;
  if (rgba.length < n * 4) throw new Error('RGBA buffer is smaller than the gray frame');
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    out[i] = (77 * rgba[j] + 150 * rgba[j + 1] + 29 * rgba[j + 2] + 128) >> 8;
  }
  return out;
}
