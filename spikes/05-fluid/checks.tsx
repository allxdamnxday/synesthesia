/**
 * Spike 5 checks:
 *  (a) 20 mount/unmount cycles of <FluidCanvas> (inside StrictMode) leak no WebGL
 *      contexts and none is lost unexpectedly;
 *  (b) determinism: reset, 120 fixed steps, draw, read pixels, hash; again after reset
 *      and on a fresh instance: identical;
 *  (c) frame rate at each tier at 1× and 2× backing-store resolution (~2 s each), plus
 *      a back-to-back burst that shows the headroom beyond the display's refresh rate.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRng } from '../../src/chance/prng';
import { baselineValues } from '../../src/materials/properties';
import { FIXED_DT, type Quality } from '../../src/materials/types';
import { readDrawingBuffer } from '../../src/materials/visual/shared/gl';
import { WaterMaterial } from '../../src/materials/visual/water';
import { meanLuma, sha256Hex } from '../../src/perf/offscreenRender';
import { createSyntheticSampler } from '../../src/signature/synthetic';
import { acquireContext, contextCounts, releaseContext } from './contexts';
import { FluidCanvas, type FluidCanvasHandle, type FluidCanvasStats } from './FluidCanvas';

export interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}

export interface FpsRow {
  quality: Quality;
  scale: number;
  width: number;
  height: number;
  fps: number;
  stepsPerSecond: number;
  droppedFrames: number;
  burstMsPerFrame: number | null;
  /** GPU milliseconds for one simulation step (null without timer queries). */
  gpuStepMs: number | null;
  /** GPU milliseconds for one draw of the canvas. */
  gpuDrawMs: number | null;
}

export interface SpikeResults {
  environment: Record<string, string>;
  checks: CheckResult[];
  fps: FpsRow[];
  pass: boolean;
  seconds: number;
}

const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function gpuRenderer(): string {
  const canvas = document.createElement('canvas');
  const gl = acquireContext(canvas);
  if (!gl) return 'WebGL2 unavailable';
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = info
    ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
    : String(gl.getParameter(gl.RENDERER));
  releaseContext(gl);
  return renderer;
}

interface Mounted {
  stats: FluidCanvasStats;
  handle: FluidCanvasHandle | null;
  unmount(): void;
}

/** Mount a FluidCanvas in its own StrictMode root and wait for `frames` drawn frames. */
function mount(
  container: HTMLElement,
  props: { width: number; height: number; quality: Quality; pixelRatio?: number },
  frames = 3,
): Promise<Mounted> {
  return new Promise((resolve, reject) => {
    const host = document.createElement('div');
    container.append(host);
    const root = createRoot(host);
    let resolved = false;
    const mounted: Mounted = {
      stats: { frames: 0, steps: 0, dropped: 0, fps: 0, t: 0 },
      handle: null,
      unmount: () => {
        root.unmount();
        host.remove();
      },
    };
    const onFrame = (stats: FluidCanvasStats) => {
      mounted.stats = { ...stats };
      if (!resolved && stats.frames >= frames) {
        resolved = true;
        resolve(mounted);
      }
    };
    const onError = (message: string) => {
      mounted.unmount();
      reject(new Error(message));
    };
    root.render(
      <StrictMode>
        <FluidCanvas
          {...props}
          ref={(handle) => {
            mounted.handle = handle;
          }}
          onFrame={onFrame}
          onError={onError}
        />
      </StrictMode>,
    );
  });
}

async function leakCheck(container: HTMLElement, cycles: number): Promise<CheckResult> {
  const before = contextCounts();
  for (let i = 0; i < cycles; i++) {
    const m = await mount(container, { width: 320, height: 180, quality: 'draft' });
    m.unmount();
    await nextFrame();
  }
  // Let any context-lost events from the browser arrive before counting.
  await nextFrame();
  await sleep(100);
  const after = contextCounts();
  const created = after.created - before.created;
  const released = after.released - before.released;
  const lost = after.unexpectedLosses - before.unexpectedLosses;
  const pass =
    created >= cycles && released === created && after.live === before.live && lost === 0;
  return {
    name: `Mount and unmount ${cycles} times without leaking graphics contexts`,
    pass,
    detail: `${created} contexts created, ${released} released, ${after.live} still live (was ${before.live}), ${lost} lost unexpectedly`,
  };
}

async function determinismCheck(): Promise<CheckResult> {
  const width = 640;
  const height = 360;
  const seed = 42;
  const steps = 120;
  const sampler = createSyntheticSampler('wink');
  const hashes: string[] = [];
  let luma = 0;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const gl = acquireContext(canvas);
  if (!gl) return { name: 'Determinism', pass: false, detail: 'WebGL2 unavailable' };
  try {
    let material = new WaterMaterial();
    const init = (m: WaterMaterial) =>
      m.init({ gl, width, height, quality: 'standard', seed, rng: createRng(seed) });
    await init(material);
    const props = baselineValues(material.properties);
    const run = async (m: WaterMaterial) => {
      m.reset(seed);
      for (let i = 0; i < steps; i++) m.step(sampler.sample(i * FIXED_DT), props, FIXED_DT);
      m.draw();
      const pixels = readDrawingBuffer(gl);
      luma = meanLuma(pixels);
      return sha256Hex(pixels);
    };
    hashes.push(await run(material));
    hashes.push(await run(material));
    material.dispose();
    material = new WaterMaterial();
    await init(material);
    hashes.push(await run(material));
    material.dispose();
  } finally {
    releaseContext(gl);
  }
  const same = hashes.every((h) => h === hashes[0]);
  const visible = luma > 0.005;
  return {
    name: 'Determinism: reset, 120 steps, draw, hash, repeat',
    pass: same && visible,
    detail: `${same ? 'identical' : 'DIFFERENT'} hashes over 3 runs (reset twice, then a fresh instance): ${hashes
      .map((h) => h.slice(0, 12))
      .join(', ')}; mean brightness ${(luma * 100).toFixed(1)}%`,
  };
}

async function fpsCheck(container: HTMLElement): Promise<FpsRow[]> {
  const rows: FpsRow[] = [];
  for (const quality of ['draft', 'standard', 'high'] as Quality[]) {
    for (const scale of [1, 2]) {
      const m = await mount(container, { width: 960, height: 540, quality, pixelRatio: scale });
      await sleep(400);
      const t0 = performance.now();
      const s0 = { ...m.stats };
      await sleep(1600);
      const t1 = performance.now();
      const s1 = { ...m.stats };
      const seconds = (t1 - t0) / 1000;
      m.handle?.burst(20); // warm up (the GPU clocks up)
      const bursts = [0, 1, 2]
        .map(() => m.handle?.burst(120) ?? null)
        .filter((x): x is number => x !== null)
        .sort((a, b) => a - b);
      const burstMsPerFrame =
        bursts.length > 0 ? (bursts[Math.floor(bursts.length / 2)] ?? null) : null;
      const gpuStepMs = (await m.handle?.gpuTime(60, 'step')) ?? null;
      const gpuDrawMs = (await m.handle?.gpuTime(60, 'draw')) ?? null;
      const size = m.handle?.describe();
      m.unmount();
      rows.push({
        quality,
        scale,
        width: size?.width ?? 960 * scale,
        height: size?.height ?? 540 * scale,
        fps: (s1.frames - s0.frames) / seconds,
        stepsPerSecond: (s1.steps - s0.steps) / seconds,
        droppedFrames: s1.dropped - s0.dropped,
        burstMsPerFrame,
        gpuStepMs,
        gpuDrawMs,
      });
      await nextFrame();
    }
  }
  return rows;
}

/** Wait (up to `timeoutMs`) until no tracked context is live, e.g. the demo's released. */
async function waitForIdle(timeoutMs = 3000): Promise<void> {
  const until = performance.now() + timeoutMs;
  while (contextCounts().live > 0 && performance.now() < until) await nextFrame();
}

export async function runChecks(container: HTMLElement): Promise<SpikeResults> {
  const start = performance.now();
  // React releases the paused demo's context in a passive-effect cleanup; let it land.
  await waitForIdle();
  const initial = contextCounts();
  const environment: Record<string, string> = {
    browser: navigator.userAgent,
    gpu: gpuRenderer(),
    devicePixelRatio: String(window.devicePixelRatio),
    screen: `${screen.width}×${screen.height}`,
  };
  const probe = await mount(container, {
    width: 320,
    height: 180,
    quality: 'standard',
    pixelRatio: 1,
  });
  environment.renderTargets = probe.handle?.describe()?.detail ?? 'unknown';
  probe.unmount();

  const checks: CheckResult[] = [];
  checks.push(await leakCheck(container, 20));
  checks.push(await determinismCheck());
  const fps = await fpsCheck(container);
  const standard = fps.find((r) => r.quality === 'standard' && r.scale === 1);
  checks.push({
    name: 'Standard quality sustains at least 30 frames per second at 1× resolution',
    pass: (standard?.fps ?? 0) >= 30,
    detail: standard
      ? `${standard.fps.toFixed(1)} fps at ${standard.width}×${standard.height}`
      : 'not measured',
  });
  const after = contextCounts();
  const lost = after.unexpectedLosses - initial.unexpectedLosses;
  checks.push({
    name: 'Every context the checks made was released, and none was lost',
    pass: lost === 0 && after.live === initial.live,
    detail: `${after.created - initial.created} created, ${after.released - initial.released} released, ${after.live - initial.live} left live, ${lost} lost unexpectedly`,
  });
  return {
    environment,
    checks,
    fps,
    pass: checks.every((c) => c.pass),
    seconds: (performance.now() - start) / 1000,
  };
}

const ms = (x: number | null, digits = 2) => (x === null ? '–' : x.toFixed(digits));

export function formatResults(results: SpikeResults): string {
  const lines = [
    'Synesthesia spike 5: fluid simulation in React, driven by a scripted signature',
    `Overall: ${results.pass ? 'PASS' : 'FAIL'} (${results.seconds.toFixed(1)} s)`,
    '',
    ...Object.entries(results.environment).map(([k, v]) => `${k}: ${v}`),
    '',
    ...results.checks.map((c) => `[${c.pass ? 'PASS' : 'FAIL'}] ${c.name}: ${c.detail}`),
    '',
    'quality   scale  backing      fps    steps/s  dropped  burst ms/frame  GPU ms/step  GPU ms/draw',
    ...results.fps.map((r) =>
      [
        r.quality.padEnd(9),
        `${r.scale}×`.padEnd(6),
        `${r.width}×${r.height}`.padEnd(12),
        r.fps.toFixed(1).padStart(5),
        r.stepsPerSecond.toFixed(1).padStart(9),
        String(r.droppedFrames).padStart(8),
        ms(r.burstMsPerFrame).padStart(15),
        ms(r.gpuStepMs, 3).padStart(12),
        ms(r.gpuDrawMs, 3).padStart(12),
      ].join(' '),
    ),
    '',
    'fps is paced by the display (requestAnimationFrame); burst is step + draw back to back',
    '(CPU and GPU); GPU columns come from timer queries where the browser allows them.',
  ];
  return lines.join('\n');
}
