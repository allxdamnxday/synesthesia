/**
 * Render a visual material offscreen for a fixed number of steps and read the result.
 * Used by the materials harness and tests (determinism hashes), the fluid spike, and
 * available to Diagnostics. Each call makes its own canvas and context and releases
 * the context when done, so repeated calls never pile up live WebGL contexts.
 */
import { createRng } from '../chance/prng';
import {
  getVisualContext,
  readDrawingBuffer,
  releaseVisualContext,
} from '../materials/visual/shared/gl';
import { baselineValues } from '../materials/properties';
import {
  FIXED_DT,
  type PropertyValues,
  type Quality,
  type VisualMaterial,
} from '../materials/types';
import type { SignatureSampler } from '../signature/types';

export interface OffscreenRenderOptions {
  create: () => VisualMaterial;
  sampler: SignatureSampler;
  /** Fixed steps to run before the final draw. */
  steps: number;
  /** Overrides on top of the material's baseline. */
  props?: PropertyValues;
  /**
   * Further overrides applied only to the final draw, after every step ran with `props`.
   * A property that only changes how the wake is drawn gives the same frame either way.
   */
  finalProps?: PropertyValues;
  seed?: number;
  quality?: Quality;
  width?: number;
  height?: number;
  /**
   * Also draw at these step counts (ascending) and hand each frame to `onCapture`
   * before continuing; the canvas holds the frame only during the callback.
   */
  checkpoints?: readonly number[];
  onCapture?: (step: number, canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) => void;
}

export interface OffscreenRenderResult {
  /** RGBA bytes of the final frame, bottom row first. */
  pixels: Uint8Array;
  width: number;
  height: number;
}

/**
 * Run `steps` fixed steps (sampling the signature at `i × FIXED_DT` before step i),
 * draw, and read the pixels.
 */
export async function renderOffscreen(
  opts: OffscreenRenderOptions,
): Promise<OffscreenRenderResult> {
  const width = Math.max(1, Math.round(opts.width ?? 480));
  const height = Math.max(1, Math.round(opts.height ?? 270));
  const seed = opts.seed ?? 1;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const gl = getVisualContext(canvas);
  if (!gl) throw new Error('WebGL2 is not available in this browser.');
  const material = opts.create();
  try {
    await material.init({
      gl,
      width,
      height,
      quality: opts.quality ?? 'draft',
      seed,
      rng: createRng(seed),
    });
    material.reset(seed);
    const props = { ...baselineValues(material.properties), ...(opts.props ?? {}) };
    // Display-only properties apply from the first frame, as in the Studio and a render.
    material.setProperties?.(props);
    const checkpoints = [...(opts.checkpoints ?? [])].sort((a, b) => a - b);
    let next = 0;
    for (let i = 0; i < opts.steps; i++) {
      while (next < checkpoints.length && checkpoints[next] === i) {
        material.draw();
        opts.onCapture?.(i, canvas, gl);
        next++;
      }
      material.step(opts.sampler.sample(i * FIXED_DT), props, FIXED_DT);
    }
    if (opts.finalProps) material.setProperties?.({ ...props, ...opts.finalProps });
    material.draw();
    const pixels = readDrawingBuffer(gl);
    opts.onCapture?.(opts.steps, canvas, gl);
    return { pixels, width, height };
  } finally {
    material.dispose();
    releaseVisualContext(gl);
  }
}

/** SHA-256 of bytes as lowercase hex (SubtleCrypto; needs a secure context). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Mean Rec. 709 luma of RGBA bytes, 0..1. */
export function meanLuma(pixels: Uint8Array): number {
  let sum = 0;
  const n = pixels.length / 4;
  for (let i = 0; i < pixels.length; i += 4) {
    sum +=
      0.2126 * (pixels[i] ?? 0) + 0.7152 * (pixels[i + 1] ?? 0) + 0.0722 * (pixels[i + 2] ?? 0);
  }
  return n > 0 ? sum / n / 255 : 0;
}

/** Fraction of pixels brighter than a small threshold (how much of the frame is lit). */
export function litFraction(pixels: Uint8Array, threshold = 8): number {
  let lit = 0;
  const n = pixels.length / 4;
  for (let i = 0; i < pixels.length; i += 4) {
    if (Math.max(pixels[i] ?? 0, pixels[i + 1] ?? 0, pixels[i + 2] ?? 0) > threshold) lit++;
  }
  return n > 0 ? lit / n : 0;
}
