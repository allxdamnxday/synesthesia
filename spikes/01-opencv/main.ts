/**
 * Spike 1 page: OpenCV.js in a worker (SPEC 16, M0 spike 1).
 *
 * 1. Cold load in a module worker (fetch + indirect eval, the production loader) while a
 *    requestAnimationFrame loop measures the longest main-thread frame gap.
 * 2. Farneback checks in that worker: known shift, zero shift, timing, heap stability.
 * 3. Warm load in a second module worker (HTTP cache now warm).
 * 4. The classic-worker fallback: a blob worker that uses importScripts().
 */
import type { FlowChecks, LoadTiming, SpikeRequest, SpikeResponse } from './protocol';
import { Report, environmentLines, fmt } from './report';

// This page lives at <root>/spikes/01-opencv/; public/ files are served from <root>/.
const OPENCV_URL = new URL('../../vendor/opencv/opencv.js', document.baseURI).href;
const report = new Report('Spike 1: OpenCV.js in a worker');
/** performance.now() when each module worker reported ready, in order. */
const readyAt: number[] = [];

function createModuleWorker(): Worker {
  return new Worker(new URL('./opencv.worker.ts', import.meta.url), { type: 'module' });
}

interface ModuleRun {
  timing: LoadTiming;
  checks: FlowChecks | null;
  worker: Worker;
}

function runModuleWorker(mode: SpikeRequest['mode']): Promise<ModuleRun> {
  return new Promise((resolve, reject) => {
    const worker = createModuleWorker();
    let timing: LoadTiming | null = null;
    worker.onerror = (e) => reject(new Error(`Worker error: ${e.message}`));
    worker.onmessage = (event: MessageEvent<SpikeResponse>) => {
      const msg = event.data;
      if (msg.type === 'error') reject(new Error(msg.message));
      else if (msg.type === 'ready') {
        timing = msg.timing;
        readyAt.push(performance.now());
        if (mode === 'load-only') resolve({ timing, checks: null, worker });
      } else if (msg.type === 'checks' && timing) {
        resolve({ timing, checks: msg.checks, worker });
      }
    };
    const request: SpikeRequest = { type: 'run', opencvUrl: OPENCV_URL, mode };
    worker.postMessage(request);
  });
}

/**
 * Records every gap between animation frames. `longestBetween(a, b)` is the longest gap
 * that overlaps the window [a, b] (performance.now() times).
 */
function frameGapMonitor(): {
  stop: () => void;
  longestBetween: (a: number, b: number) => { longestMs: number; frames: number };
} {
  const gaps: { start: number; end: number }[] = [];
  let last = performance.now();
  let running = true;
  const tick = (now: number) => {
    if (!running) return;
    gaps.push({ start: last, end: now });
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return {
    stop: () => {
      running = false;
    },
    longestBetween: (a, b) => {
      const inside = gaps.filter((g) => g.end >= a && g.start <= b);
      return {
        longestMs: inside.reduce((m, g) => Math.max(m, g.end - g.start), 0),
        frames: inside.length,
      };
    },
  };
}

/** Classic worker from a blob: importScripts() the same file, then wait for the runtime. */
function runClassicWorker(): Promise<{ importMs: number; initMs: number; hasFarneback: boolean }> {
  const code = `
    self.onmessage = (event) => {
      const url = event.data.url;
      const t0 = performance.now();
      try { importScripts(url); } catch (err) { postMessage({ type: 'error', message: String(err) }); return; }
      const t1 = performance.now();
      const mod = self.cv;
      const done = (ready) => {
        const m = ready && typeof ready === 'object' ? ready : mod;
        if (Object.prototype.hasOwnProperty.call(m, 'then')) delete m.then;
        postMessage({ type: 'ready', importMs: t1 - t0, initMs: performance.now() - t1,
          hasFarneback: typeof m.calcOpticalFlowFarneback === 'function' });
      };
      if (!mod) postMessage({ type: 'error', message: 'cv is not defined' });
      else if (mod.calledRun) done(mod);
      else if (typeof mod.then === 'function') mod.then(done);
      else { const prev = mod.onRuntimeInitialized; mod.onRuntimeInitialized = () => { if (prev) prev(); done(mod); }; }
    };`;
  const blobUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  return new Promise((resolve, reject) => {
    const worker = new Worker(blobUrl);
    worker.onerror = (e) => reject(new Error(`Classic worker error: ${e.message}`));
    worker.onmessage = (
      event: MessageEvent<
        | { type: 'ready'; importMs: number; initMs: number; hasFarneback: boolean }
        | { type: 'error'; message: string }
      >,
    ) => {
      const msg = event.data;
      worker.terminate();
      URL.revokeObjectURL(blobUrl);
      if (msg.type === 'error') reject(new Error(msg.message));
      else resolve(msg);
    };
    worker.postMessage({ url: OPENCV_URL });
  });
}

async function main(): Promise<void> {
  // File size (served bytes).
  const head = await fetch(OPENCV_URL, { method: 'HEAD' });
  const length = Number(head.headers.get('content-length') ?? 0);
  report.add(
    'OpenCV.js file size',
    'INFO',
    `${length.toLocaleString('en-US')} bytes (${fmt(length / 1048576, 2)} MiB), wasm embedded`,
  );

  // 1–2. Cold load + checks. The first second after page load is left out of the frame-gap
  // measurement: headless Chrome's first frames are slow regardless of what the page does.
  const monitor = frameGapMonitor();
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const t0 = performance.now();
  let cold: ModuleRun;
  try {
    cold = await runModuleWorker('full');
  } catch (error) {
    monitor.stop();
    report.add('Load OpenCV.js in a module worker', false, String(error));
    report.finish(environmentLines());
    return;
  }
  const tReady = readyAt[0] ?? performance.now();
  monitor.stop();
  const gap = monitor.longestBetween(t0, tReady);
  const coldReadyMs = tReady - t0;
  cold.worker.terminate();
  const t = cold.timing;
  report.add(
    'Load OpenCV.js in a module worker (cold cache)',
    t.method === 'fetch-eval',
    `method ${t.method}; ready in ${fmt(coldReadyMs, 0)} ms from worker creation ` +
      `(fetch ${fmt(t.fetchMs, 0)} ms, eval ${fmt(t.evalMs, 0)} ms, runtime init ${fmt(t.initMs, 0)} ms)`,
  );
  report.add(
    'Main thread stays responsive while loading',
    gap.longestMs < 50,
    `longest gap between animation frames while the worker loaded: ${fmt(gap.longestMs, 1)} ms over ${gap.frames} frames (target < 50 ms)`,
  );
  const c = cold.checks;
  if (!c) throw new Error('No checks');
  report.add(
    'cv.calcOpticalFlowFarneback is a function',
    c.hasFarneback,
    `typeof = ${c.hasFarneback ? 'function' : 'missing'}`,
  );
  const du = c.shift.medianU - c.shift.truthU;
  const dv = c.shift.medianV - c.shift.truthV;
  report.add(
    'Farneback recovers a known shift (+3 px x, −2 px y)',
    Math.abs(du) <= 0.25 && Math.abs(dv) <= 0.25,
    `median flow (${fmt(c.shift.medianU, 3)}, ${fmt(c.shift.medianV, 3)}) px; error (${fmt(du, 3)}, ${fmt(dv, 3)}); tolerance ±0.25`,
  );
  report.add(
    'Zero shift gives ~0 flow',
    Math.abs(c.zero.medianU) < 0.05 && Math.abs(c.zero.medianV) < 0.05 && c.zero.maxAbs < 0.25,
    `median (${fmt(c.zero.medianU, 4)}, ${fmt(c.zero.medianV, 4)}) px; largest |component| ${fmt(c.zero.maxAbs, 4)} px`,
  );
  const projectedSec = (c.timing.avgMs * 300) / 1000;
  // On a Mac this is the target machine itself: pass within the 60 s budget. Elsewhere,
  // leave room for a Mac up to 3× slower.
  const onMac = /Macintosh|Mac OS X/.test(navigator.userAgent);
  const limitSec = onMac ? 60 : 20;
  report.add(
    'Farneback speed at 320×180 (blur + flow per frame)',
    projectedSec <= limitSec,
    `${fmt(c.timing.avgMs, 2)} ms avg over ${c.timing.runs} runs (min ${fmt(c.timing.minMs, 2)}, max ${fmt(c.timing.maxMs, 2)}); ` +
      `10 s at 30 fps (300 frames) ≈ ${fmt(projectedSec, 1)} s of flow here; budget 60 s on a 2017 MacBook Pro → ` +
      `${fmt(60 / projectedSec, 1)}× headroom (pass if ≤ ${limitSec} s ${onMac ? 'on this Mac' : 'here, leaving room for a 3× slower Mac'})`,
  );
  const heapStable = c.heap.after === c.heap.before && c.heap.afterEngines === c.heap.before;
  report.add(
    'wasm heap stable (every Mat deleted)',
    heapStable,
    `heap ${c.heap.before.toLocaleString('en-US')} bytes before, ${c.heap.after.toLocaleString('en-US')} after ` +
      `${c.heap.runs} more frames, ${c.heap.afterEngines.toLocaleString('en-US')} after 20 engines created and disposed`,
  );

  // 3. Warm load.
  try {
    const t1 = performance.now();
    const warm = await runModuleWorker('load-only');
    const warmReadyMs = (readyAt[1] ?? performance.now()) - t1;
    warm.worker.terminate();
    report.add(
      'Load OpenCV.js again (warm HTTP cache, new worker)',
      true,
      `ready in ${fmt(warmReadyMs, 0)} ms (fetch ${fmt(warm.timing.fetchMs, 0)} ms, eval ${fmt(warm.timing.evalMs, 0)} ms, ` +
        `runtime init ${fmt(warm.timing.initMs, 0)} ms)`,
    );
  } catch (error) {
    report.add('Load OpenCV.js again (warm HTTP cache, new worker)', false, String(error));
  }

  // 4. Classic worker fallback.
  try {
    const classic = await runClassicWorker();
    report.add(
      'Fallback: classic worker with importScripts()',
      classic.hasFarneback,
      `importScripts ${fmt(classic.importMs, 0)} ms, runtime init ${fmt(classic.initMs, 0)} ms; Farneback ${classic.hasFarneback ? 'present' : 'missing'}`,
    );
  } catch (error) {
    report.add('Fallback: classic worker with importScripts()', false, String(error));
  }

  report.finish(environmentLines());
}

main().catch((error: unknown) => {
  report.add('Spike ran to completion', false, String(error));
  report.finish(environmentLines());
});
