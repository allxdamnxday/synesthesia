/**
 * Signature thumbnails: a small "vector-field sketch" of the whole movement, in the same
 * visual language as the Signature view (V0): one short stroke per grid cell, brighter
 * where there was more motion, on the Deep background.
 *
 * Each cell's stroke summarizes the movement over time. A stroke has no arrowhead, so it
 * shows an axis rather than a direction; the axis is averaged with doubled angles, which
 * keeps back-and-forth motion (an eyelid closing then opening) from cancelling out the
 * way a plain average of the vectors would. Brightness follows the mean speed.
 *
 * `computeFieldSketch` is pure (tested in Node); drawing needs a DOM canvas, so
 * `signatureThumbnail` runs on the main thread only.
 */
import { percentile } from '../lib/math';
import { decodeField } from '../signature/fieldCodec';
import type { KineticSignature } from '../signature/types';

export const THUMBNAIL_WIDTH = 240;
export const THUMBNAIL_HEIGHT = 135;

export interface FieldSketch {
  cols: number;
  rows: number;
  /** Per cell, row-major: stroke axis in radians, image coordinates (x right, y down). */
  angle: Float32Array;
  /** Per cell: 0..1, mean speed relative to the busiest cells. */
  strength: Float32Array;
}

/** Summarize `frameCount` frames of a (u, v) field into one stroke per cell. */
export function computeFieldSketch(
  field: Float32Array,
  frameCount: number,
  cols: number,
  rows: number,
): FieldSketch {
  const cells = cols * rows;
  const speed = new Float64Array(cells);
  const axisX = new Float64Array(cells);
  const axisY = new Float64Array(cells);
  for (let f = 0; f < frameCount; f++) {
    const base = f * cells * 2;
    for (let c = 0; c < cells; c++) {
      const u = field[base + c * 2] ?? 0;
      const v = field[base + c * 2 + 1] ?? 0;
      const m = Math.sqrt(u * u + v * v);
      if (!(m > 0)) continue;
      speed[c] += m;
      // m · (cos 2θ, sin 2θ): the axis, weighted by speed.
      axisX[c] += (u * u - v * v) / m;
      axisY[c] += (2 * u * v) / m;
    }
  }
  const reference = percentile(speed, 98);
  const angle = new Float32Array(cells);
  const strength = new Float32Array(cells);
  for (let c = 0; c < cells; c++) {
    angle[c] = 0.5 * Math.atan2(axisY[c], axisX[c]);
    const s = reference > 0 ? Math.min(1, speed[c] / reference) : 0;
    // A gentle curve so quieter regions of the wake still read.
    strength[c] = Math.pow(s, 0.6);
  }
  return { cols, rows, angle, strength };
}

const DEEP = '#0E1A24';
const PEARL = [232, 228, 218] as const;
const WATER = [127, 183, 201] as const;

function mix(a: readonly number[], b: readonly number[], t: number): string {
  const c = a.map((x, i) => Math.round(x + ((b[i] ?? 0) - x) * t));
  return `${c[0]}, ${c[1]}, ${c[2]}`;
}

/** Draw a sketch to a PNG data URL ('' if no 2D canvas is available). Main thread only. */
export function drawFieldSketch(
  sketch: FieldSketch,
  width = THUMBNAIL_WIDTH,
  height = THUMBNAIL_HEIGHT,
): string {
  if (typeof document === 'undefined') return '';
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.fillStyle = DEEP;
  ctx.fillRect(0, 0, width, height);

  const { cols, rows, angle, strength } = sketch;
  const cw = width / cols;
  const ch = height / rows;
  ctx.lineCap = 'round';
  // Two passes: a soft halo, then the stroke itself.
  for (const pass of ['halo', 'stroke'] as const) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const x = (c + 0.5) * cw;
        const y = (r + 0.5) * ch;
        const s = strength[i] ?? 0;
        if (s < 0.04) {
          if (pass === 'stroke') {
            ctx.fillStyle = 'rgba(154, 171, 181, 0.14)';
            ctx.fillRect(x - 0.5, y - 0.5, 1, 1);
          }
          continue;
        }
        const a = angle[i] ?? 0;
        const reach = 0.46 * (0.35 + 0.65 * s);
        const dx = Math.cos(a) * cw * reach;
        const dy = Math.sin(a) * ch * reach;
        ctx.beginPath();
        ctx.moveTo(x - dx, y - dy);
        ctx.lineTo(x + dx, y + dy);
        if (pass === 'halo') {
          ctx.strokeStyle = `rgba(${mix(WATER, PEARL, s)}, ${0.1 * s})`;
          ctx.lineWidth = Math.max(2.5, 0.35 * Math.min(cw, ch));
        } else {
          ctx.strokeStyle = `rgba(${mix(WATER, PEARL, s)}, ${0.25 + 0.75 * s})`;
          ctx.lineWidth = 1.25;
        }
        ctx.stroke();
      }
    }
  }
  return canvas.toDataURL('image/png');
}

/** The Library thumbnail for a signature ('' outside a browser window). */
export function signatureThumbnail(sig: KineticSignature): string {
  if (typeof document === 'undefined') return '';
  const field = decodeField(sig.field.data);
  return drawFieldSketch(computeFieldSketch(field, sig.frameCount, sig.grid.cols, sig.grid.rows));
}

/** Like signatureThumbnail, but never throws: a missing thumbnail must not block a save. */
export function tryThumbnail(sig: KineticSignature): string {
  try {
    return signatureThumbnail(sig);
  } catch (err) {
    console.warn('Could not draw a signature thumbnail', err);
    return '';
  }
}
