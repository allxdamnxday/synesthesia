/**
 * Preview quality benchmark (SPEC 14.2): about 3 s of Water driven by the synthetic
 * wink at each tier, on the caller's canvas at its real backing size, measuring the
 * frame rate a viewer would see (requestAnimationFrame pacing, fixed-step catch-up as in
 * the Studio preview). Picks the highest tier that sustains the target (30 fps).
 *
 * Wall-clock timing is fine here: src/perf sits outside the deterministic folders, and
 * the simulation itself still only advances by FIXED_DT.
 *
 * The caller owns the canvas: the benchmark borrows its WebGL2 context (creating it if
 * needed) and disposes the materials it made, but doesn't release the context.
 */
import { createRng } from '../chance/prng';
import { baselineValues } from '../materials/properties';
import { FIXED_DT, type Quality } from '../materials/types';
import { getVisualContext } from '../materials/visual/shared/gl';
import { WaterMaterial } from '../materials/visual/water';
import { createSyntheticSampler } from '../signature/synthetic';
import { planSteps } from './fixedStep';

export const QUALITY_TIERS: readonly Quality[] = ['draft', 'standard', 'high'];
/** SPEC 14.2: the preview must sustain this. */
export const TARGET_PREVIEW_FPS = 30;

export interface QualityBenchmarkOptions {
  /** Total time across the three tiers, ms (default 3000). */
  durationMs?: number;
  /** Frames per second a tier must sustain (default 30). */
  targetFps?: number;
  seed?: number;
  signal?: AbortSignal;
  onProgress?: (progress: { tier: Quality; fraction: number }) => void;
}

export interface TierMeasurement {
  fps: number;
  /** Frames counted after warm-up. */
  frames: number;
  /** Fixed steps run while counting (≈ 60 per second when keeping up). */
  steps: number;
  elapsedMs: number;
  /** Frames where the preview fell behind real time and dropped backlog. */
  droppedFrames: number;
}

export interface QualityBenchmarkResult {
  tier: Quality;
  fpsByTier: Record<Quality, number>;
  details: Record<Quality, TierMeasurement>;
  /** Canvas backing size measured. */
  width: number;
  height: number;
}

/** Highest tier whose fps meets the target; 'draft' if none does. */
export function pickQualityTier(
  fpsByTier: Readonly<Record<Quality, number>>,
  targetFps = TARGET_PREVIEW_FPS,
): Quality {
  let best: Quality = 'draft';
  for (const tier of QUALITY_TIERS) if ((fpsByTier[tier] ?? 0) >= targetFps) best = tier;
  return best;
}

/** Thrown when the benchmark can't finish (tab hidden, no frames, aborted). */
export class BenchmarkInterruptedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BenchmarkInterruptedError';
  }
}

/** Part of the wink with movement in it (the close and the open), looped. */
const WINK_ACTIVE_START = 0.55;
const WINK_ACTIVE_LENGTH = 1.0;
/** Share of each tier's time spent warming up (shader compile, first allocations). */
const WARM_UP_SHARE = 0.25;
/** Give up if no animation frame arrives for this long (hidden tab). */
const STALL_MS = 2000;

function nextFrame(signal?: AbortSignal): Promise<number> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new BenchmarkInterruptedError('The benchmark was cancelled.'));
      return;
    }
    let timer = 0;
    const id = requestAnimationFrame((now) => {
      clearTimeout(timer);
      resolve(now);
    });
    timer = window.setTimeout(() => {
      cancelAnimationFrame(id);
      reject(
        new BenchmarkInterruptedError(
          'No frames were drawn (is the page hidden?). Run the benchmark while the page is visible.',
        ),
      );
    }, STALL_MS);
  });
}

async function measureTier(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  tier: Quality,
  budgetMs: number,
  opts: QualityBenchmarkOptions,
): Promise<TierMeasurement> {
  const seed = opts.seed ?? 1;
  const material = new WaterMaterial();
  const sampler = createSyntheticSampler('wink');
  const props = baselineValues(material.properties);
  try {
    await material.init({ gl, width, height, quality: tier, seed, rng: createRng(seed) });
    material.reset(seed);
    let stepIndex = 0;
    let accumulator = 0;
    let frames = 0;
    let steps = 0;
    let dropped = 0;
    let last = await nextFrame(opts.signal);
    const start = last;
    const warmUpEnd = start + budgetMs * WARM_UP_SHARE;
    let countFrom = -1;
    for (;;) {
      const now = await nextFrame(opts.signal);
      const plan = planSteps(accumulator, (now - last) / 1000, FIXED_DT);
      accumulator = plan.accumulator;
      last = now;
      for (let i = 0; i < plan.steps; i++) {
        const t = WINK_ACTIVE_START + ((stepIndex * FIXED_DT) % WINK_ACTIVE_LENGTH);
        material.step(sampler.sample(t), props, FIXED_DT);
        stepIndex++;
      }
      material.draw();
      if (now >= warmUpEnd) {
        if (countFrom < 0) {
          countFrom = now;
        } else {
          frames++;
          steps += plan.steps;
          if (plan.dropped) dropped++;
        }
      }
      opts.onProgress?.({ tier, fraction: Math.min(1, (now - start) / budgetMs) });
      if (now - start >= budgetMs) break;
    }
    const elapsedMs = countFrom >= 0 ? last - countFrom : 0;
    return {
      fps: elapsedMs > 0 ? (frames * 1000) / elapsedMs : 0,
      frames,
      steps,
      elapsedMs,
      droppedFrames: dropped,
    };
  } finally {
    material.dispose();
  }
}

/**
 * Measure Water at each tier on `canvas` (its current width × height is the backing
 * size) and pick the highest tier that sustains `targetFps`.
 */
export async function runQualityBenchmark(
  canvas: HTMLCanvasElement,
  opts: QualityBenchmarkOptions = {},
): Promise<QualityBenchmarkResult> {
  const gl = getVisualContext(canvas);
  if (!gl) throw new Error('WebGL2 is not available in this browser.');
  const width = Math.max(1, canvas.width);
  const height = Math.max(1, canvas.height);
  const perTier = Math.max(300, (opts.durationMs ?? 3000) / QUALITY_TIERS.length);
  const details = {} as Record<Quality, TierMeasurement>;
  const fpsByTier = {} as Record<Quality, number>;
  for (const tier of QUALITY_TIERS) {
    const m = await measureTier(gl, width, height, tier, perTier, opts);
    details[tier] = m;
    fpsByTier[tier] = Math.round(m.fps * 10) / 10;
  }
  return {
    tier: pickQualityTier(fpsByTier, opts.targetFps ?? TARGET_PREVIEW_FPS),
    fpsByTier,
    details,
    width,
    height,
  };
}
