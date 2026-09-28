/**
 * V0 Signature view: pure layout and stroke mapping (unit tested). Everything is scaled
 * to the canvas, so a small Prepare preview, a Retina Studio canvas and a 1080p render
 * look alike, and strokes stay crisp at any device pixel ratio.
 */
import { projectField } from '../shared/fluid/projection';

/** Seconds of travel a stroke shows: its length is the distance covered in this time. */
export const STROKE_TRAVEL_SEC = 0.12;
/** Longest stroke, in cells (saturates softly). */
export const STROKE_MAX_CELLS = 1.35;
/** Speed (field diagonals per second) at which a stroke reaches ~63% brightness. */
export const STROKE_BRIGHT_SPEED = 0.15;
/** Brightness of a still cell's dot, so the field's extent stays visible. */
export const REST_BRIGHTNESS = 0.14;

export interface FieldLayout {
  /** Projected field in canvas pixels, origin bottom-left (y up). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Cell size in pixels (the smaller of the two axes). */
  cellPx: number;
  /** The field's diagonal in pixels (converts field units to pixels per second). */
  diagonalPx: number;
  /** Stroke width at the head, in pixels. */
  strokePx: number;
}

/** Fit the field grid into the canvas (Range 0.5: aspect kept, centered, no cropping). */
export function fieldLayout(
  cols: number,
  rows: number,
  canvasWidth: number,
  canvasHeight: number,
): FieldLayout {
  const c = Math.max(1, cols);
  const r = Math.max(1, rows);
  const w = Math.max(1, canvasWidth);
  const h = Math.max(1, canvasHeight);
  const rect = projectField(0.5, c / r, w / h);
  const width = rect.width * w;
  const height = rect.height * h;
  const cellPx = Math.min(width / c, height / r);
  return {
    x: rect.x * w,
    y: rect.y * h,
    width,
    height,
    cellPx,
    diagonalPx: Math.hypot(width, height),
    strokePx: Math.max(1.5, Math.min(0.0032 * Math.min(w, h), cellPx * 0.3)),
  };
}

/** Stroke length in pixels for a speed (field diagonals per second). */
export function strokeLength(speed: number, layout: FieldLayout): number {
  const max = layout.cellPx * STROKE_MAX_CELLS;
  const raw = Math.max(0, speed) * layout.diagonalPx * STROKE_TRAVEL_SEC;
  return max * (1 - Math.exp(-raw / max));
}

/** Stroke brightness 0..1 for a speed; still cells keep a faint dot. */
export function strokeBrightness(speed: number): number {
  return (
    REST_BRIGHTNESS +
    (1 - REST_BRIGHTNESS) * (1 - Math.exp(-Math.max(0, speed) / STROKE_BRIGHT_SPEED))
  );
}

export interface ReadoutLayout {
  /** Panel in canvas pixels, origin bottom-left. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Pixels per layout unit (1 unit = 1 px on a 720 px tall canvas). */
  unit: number;
}

/** The readout panel sits in the bottom-left corner, scaled with the canvas size. */
export function readoutLayout(canvasWidth: number, canvasHeight: number): ReadoutLayout {
  const unit = Math.max(0.6, 1.2 * Math.min(canvasWidth / 1280, canvasHeight / 720));
  const width = Math.round(236 * unit);
  const height = Math.round(212 * unit);
  const margin = Math.round(16 * unit);
  return { x: margin, y: margin, width, height, unit };
}
