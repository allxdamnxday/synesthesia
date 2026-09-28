/**
 * Synthetic signatures for developing and testing materials before (and independently
 * of) real extraction. `createSyntheticSampler('wink')` plays an analytic wink: an eyelid
 * closes (downward motion), holds, then opens (upward motion), with clear onsets.
 *
 * Only the movement is made up. The analytic velocity field goes through the same stages
 * as a clip's signature, minus optical flow: a tiny manual noise floor, features and stats
 * (src/signature/pipeline.ts), and it plays through the real sampler
 * (src/signature/sampler.ts). So materials see what a real signature of the same movement
 * would give them.
 *
 * `contentHash` is a fixed label (`synthetic-<kind>`), since hashing is asynchronous. It
 * is not a SHA-256, so these signatures don't pass `parseSignature()`: they are for
 * harness pages, benchmarks and tests, and are never saved.
 */
import { clamp01, lerp } from '../lib/math';
import { buildSignatureBody } from './assemble';
import { processRawField } from './pipeline';
import { createSampler } from './sampler';
import { DEFAULT_FARNEBACK, type KineticSignature, type SignatureSampler } from './types';

export type SyntheticKind = 'wink' | 'sweep' | 'still' | 'swirl';

export interface SyntheticOptions {
  /** Frames per second (default 30). */
  fps?: number;
  /** Grid columns (default 32). */
  cols?: number;
  /** Grid rows (default 18). */
  rows?: number;
}

/** Manual noise floor for synthetic signatures: tiny, so the analytic field passes intact. */
export const SYNTHETIC_NOISE_FLOOR = 1e-4;
/**
 * Extraction smoothing for synthetic signatures: none. It exists to calm optical-flow
 * noise, and the analytic field has none (smoothing would also blunt the wink's onsets).
 */
export const SYNTHETIC_SMOOTHING_FRAMES = 1;

/** A fixed timestamp: synthetic signatures are the same on every run. */
const CREATED_AT = '2026-09-28T00:00:00.000Z';

const NAMES: Record<SyntheticKind, string> = {
  wink: 'Synthetic wink',
  sweep: 'Synthetic sweep',
  still: 'Synthetic stillness',
  swirl: 'Synthetic swirl',
};

const DURATIONS: Record<SyntheticKind, number> = {
  wink: 2.2,
  sweep: 2.8,
  still: 2,
  swirl: 3,
};

/** Smooth 0→1→0 bump over [start, end]. */
function bump(t: number, start: number, end: number): number {
  if (t <= start || t >= end) return 0;
  const x = (t - start) / (end - start);
  const s = Math.sin(Math.PI * x);
  return s * s;
}

function gaussian(dx: number, dy: number, radius: number): number {
  return Math.exp(-(dx * dx + dy * dy) / (2 * radius * radius));
}

/** Velocity (u, v) at field point (x, y) and time t, in field diagonals per second. */
function velocityAt(kind: SyntheticKind, x: number, y: number, t: number): [number, number] {
  switch (kind) {
    case 'still':
      return [0, 0];
    case 'sweep': {
      // A soft blob crossing left to right, then rising.
      const cx = lerp(0.15, 0.85, clamp01((t - 0.3) / 1.4));
      const w = gaussian(x - cx, y - 0.55, 0.12) * bump(t, 0.3, 1.7);
      const rise = gaussian(x - 0.7, y - 0.5, 0.15) * bump(t, 1.8, 2.6);
      return [1.2 * w, -1.4 * rise];
    }
    case 'swirl': {
      // Clockwise rotation (as seen on screen) that swells and fades.
      const dx = x - 0.5;
      const dy = y - 0.5;
      const a = bump(t, 0.2, 2.8) * gaussian(dx, dy, 0.22) * 6;
      return [-dy * a, dx * a];
    }
    case 'wink': {
      // Eyelid closes (down), holds, opens (up); the cheek lifts slightly as it closes.
      const lid = gaussian(x - 0.5, (y - 0.42) * 1.6, 0.16);
      const close = bump(t, 0.6, 0.9);
      const open = bump(t, 1.15, 1.45);
      const cheek = gaussian(x - 0.5, y - 0.72, 0.14) * bump(t, 0.62, 0.95);
      const v = lid * (1.8 * close - 1.7 * open) - 0.35 * cheek;
      const u = lid * 0.12 * (close - open) * (x - 0.5) * 4;
      return [u, v];
    }
  }
}

/** The analytic field, frame f at time f / fps, sampled at cell centers. */
function analyticField(
  kind: SyntheticKind,
  fps: number,
  cols: number,
  rows: number,
): { field: Float32Array; frameCount: number } {
  const frameCount = Math.max(1, Math.round(DURATIONS[kind] * fps));
  const cells = cols * rows;
  const field = new Float32Array(frameCount * cells * 2);
  for (let f = 0; f < frameCount; f++) {
    const t = f / fps;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const [u, v] = velocityAt(kind, (c + 0.5) / cols, (r + 0.5) / rows, t);
        const i = (f * cells + r * cols + c) * 2;
        field[i] = u;
        field[i + 1] = v;
      }
    }
  }
  return { field, frameCount };
}

/** A complete KineticSignature of an analytic movement, built by the real pipeline. */
export function createSyntheticSignature(
  kind: SyntheticKind = 'wink',
  options: SyntheticOptions = {},
): KineticSignature {
  const fps = options.fps ?? 30;
  const cols = options.cols ?? 32;
  const rows = options.rows ?? 18;
  const { field, frameCount } = analyticField(kind, fps, cols, rows);
  const processed = processRawField(
    { field, frameCount, cols, rows, fps },
    {
      noiseFloorMode: 'manual',
      manualNoiseFloor: SYNTHETIC_NOISE_FLOOR,
      temporalSmoothingFrames: SYNTHETIC_SMOOTHING_FRAMES,
    },
  );
  const width = 320;
  const height = Math.round((width * rows) / cols);
  const { format, version, ...body } = buildSignatureBody(
    {
      source: {
        fileName: `synthetic-${kind}`,
        nativeFps: fps,
        width,
        height,
        trim: { startSec: 0, endSec: frameCount / fps },
        rotate: 0,
        mirror: false,
        focusArea: null,
      },
      preferredSpeed: 1,
      options: { noiseFloorMode: 'manual', farneback: DEFAULT_FARNEBACK },
      analysisWidth: width,
      temporalSmoothingFrames: processed.window,
      noiseFloor: processed.floor,
      frameRate: fps,
      grid: { cols, rows },
      field: processed.field,
      features: processed.features,
    },
    `synthetic-${kind}`,
  );
  return {
    format,
    version,
    id: `synthetic-${kind}`,
    name: NAMES[kind],
    createdAt: CREATED_AT,
    ...body,
  };
}

/** A sampler (src/signature/sampler.ts) playing a synthetic signature. */
export function createSyntheticSampler(
  kind: SyntheticKind = 'wink',
  options: SyntheticOptions = {},
): SignatureSampler {
  return createSampler(createSyntheticSignature(kind, options));
}
