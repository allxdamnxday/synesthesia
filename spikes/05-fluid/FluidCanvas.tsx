/**
 * Mounts the real Water material on its own canvas and plays a synthetic signature at a
 * fixed dt of 1/60 s, with an accumulator against requestAnimationFrame. No mouse or
 * keyboard handlers: only the signature moves the water.
 *
 * Each mount makes a fresh canvas and context and each unmount releases them, so React
 * StrictMode's mount → unmount → mount (and any number of remounts) never leaks a
 * WebGL context. A released canvas can't get a WebGL context again, which is why the
 * canvas is created here rather than rendered as JSX.
 */
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import { createRng } from '../../src/chance/prng';
import { baselineValues } from '../../src/materials/properties';
import { FIXED_DT, type Quality } from '../../src/materials/types';
import { WaterMaterial } from '../../src/materials/visual/water';
import { planSteps } from '../../src/perf/fixedStep';
import { FpsMeter } from '../../src/perf/fpsMeter';
import { createSyntheticSampler, type SyntheticKind } from '../../src/signature/synthetic';
import { acquireContext, releaseContext } from './contexts';

/** EXT_disjoint_timer_query_webgl2 (GPU timers; often unavailable, e.g. on macOS). */
interface TimerQueryExt {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}

export interface FluidCanvasStats {
  /** Frames drawn since mount. */
  frames: number;
  /** Fixed steps run since mount. */
  steps: number;
  /** Frames where the loop fell behind and dropped time. */
  dropped: number;
  /** Recent frames per second. */
  fps: number;
  /** Composition time, seconds. */
  t: number;
}

export interface FluidCanvasHandle {
  /**
   * Run `frames` step + draw frames back to back, then wait for the GPU to finish;
   * returns the average milliseconds per frame (the machine's headroom beyond vsync).
   */
  burst(frames: number): number | null;
  /**
   * GPU time per frame in milliseconds for `frames` back-to-back steps, draws, or both,
   * measured with EXT_disjoint_timer_query_webgl2; null where the extension is missing
   * (it is often disabled, e.g. on macOS) or the measurement was disturbed.
   */
  gpuTime(frames: number, what: 'step' | 'draw' | 'both'): Promise<number | null>;
  /** Backing-store size and the render-target path, for reports. */
  describe(): { width: number; height: number; detail: string } | null;
}

export interface FluidCanvasProps {
  /** CSS size in pixels. */
  width: number;
  height: number;
  quality?: Quality;
  /** Backing-store pixels per CSS pixel (default: the display's devicePixelRatio). */
  pixelRatio?: number;
  seed?: number;
  kind?: SyntheticKind;
  onFrame?: (stats: FluidCanvasStats) => void;
  onError?: (message: string) => void;
  ref?: Ref<FluidCanvasHandle>;
}

export function FluidCanvas({
  width,
  height,
  quality = 'standard',
  pixelRatio,
  seed = 1,
  kind = 'wink',
  onFrame,
  onError,
  ref,
}: FluidCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onFrameRef = useRef(onFrame);
  const onErrorRef = useRef(onError);
  const handleRef = useRef<FluidCanvasHandle | null>(null);

  useEffect(() => {
    onFrameRef.current = onFrame;
    onErrorRef.current = onError;
  });

  useImperativeHandle(
    ref,
    () => ({
      burst: (frames) => handleRef.current?.burst(frames) ?? null,
      gpuTime: (frames, what) => handleRef.current?.gpuTime(frames, what) ?? Promise.resolve(null),
      describe: () => handleRef.current?.describe() ?? null,
    }),
    [],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ratio = pixelRatio ?? window.devicePixelRatio ?? 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.style.display = 'block';
    host.append(canvas);

    const gl = acquireContext(canvas);
    if (!gl) {
      canvas.remove();
      onErrorRef.current?.('WebGL2 is not available in this browser.');
      return;
    }
    const material = new WaterMaterial();
    const sampler = createSyntheticSampler(kind);
    const props = baselineValues(material.properties);
    const meter = new FpsMeter();
    let disposed = false;
    let raf = 0;
    let stepIndex = 0;
    let accumulator = 0;
    let last = 0;
    const stats: FluidCanvasStats = { frames: 0, steps: 0, dropped: 0, fps: 0, t: 0 };

    const stepOnce = () => {
      material.step(sampler.sample(stepIndex * FIXED_DT), props, FIXED_DT);
      stepIndex++;
      stats.steps++;
      if (stepIndex * FIXED_DT >= sampler.duration) {
        material.reset(seed);
        stepIndex = 0;
      }
    };

    const pixel = new Uint8Array(4);
    handleRef.current = {
      burst(frames) {
        if (disposed || gl.isContextLost()) return null;
        const start = performance.now();
        for (let i = 0; i < frames; i++) {
          stepOnce();
          material.draw();
        }
        // Reading one pixel waits for every queued command to finish.
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        return (performance.now() - start) / Math.max(1, frames);
      },
      async gpuTime(frames, what) {
        // Not in the DOM typings, so describe the two constants we use.
        const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerQueryExt | null;
        if (!timer || disposed) return null;
        const query = gl.createQuery();
        gl.getParameter(timer.GPU_DISJOINT_EXT); // clear the disjoint flag
        gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
        for (let i = 0; i < frames; i++) {
          if (what !== 'draw') stepOnce();
          if (what !== 'step') material.draw();
        }
        gl.endQuery(timer.TIME_ELAPSED_EXT);
        try {
          for (let tries = 0; tries < 120 && !disposed; tries++) {
            await new Promise((resolve) => requestAnimationFrame(resolve));
            if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) continue;
            if (gl.getParameter(timer.GPU_DISJOINT_EXT)) return null;
            const ns = gl.getQueryParameter(query, gl.QUERY_RESULT) as number;
            return ns / 1e6 / Math.max(1, frames);
          }
          return null;
        } finally {
          gl.deleteQuery(query);
        }
      },
      describe: () => ({ width: canvas.width, height: canvas.height, detail: material.describe() }),
    };

    const frame = (now: number) => {
      if (disposed) return;
      const plan = planSteps(accumulator, last > 0 ? (now - last) / 1000 : 0, FIXED_DT);
      accumulator = plan.accumulator;
      last = now;
      for (let i = 0; i < plan.steps; i++) stepOnce();
      if (plan.dropped) stats.dropped++;
      material.draw();
      meter.tick(now);
      stats.frames++;
      stats.fps = meter.fps;
      stats.t = stepIndex * FIXED_DT;
      onFrameRef.current?.(stats);
      raf = requestAnimationFrame(frame);
    };

    material
      .init({
        gl,
        width: canvas.width,
        height: canvas.height,
        quality,
        seed,
        rng: createRng(seed),
      })
      .then(() => {
        if (disposed) return;
        material.reset(seed);
        raf = requestAnimationFrame(frame);
      })
      .catch((error: unknown) => {
        if (!disposed) onErrorRef.current?.(error instanceof Error ? error.message : String(error));
      });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      handleRef.current = null;
      material.dispose();
      releaseContext(gl);
      canvas.remove();
    };
  }, [width, height, quality, pixelRatio, seed, kind]);

  return <div ref={hostRef} style={{ width, height, background: '#000' }} />;
}
