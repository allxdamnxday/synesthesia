/**
 * Spike 1 worker: load OpenCV.js with the production loader (src/signature/opencv.ts),
 * then check Farneback on synthetic frames with a known shift, time it, and watch the
 * wasm heap for leaks. Timing lives here (spike code), never in src/signature.
 */
import { createRng } from '../../src/chance/prng';
import { FarnebackFlow, loadOpenCv, type OpenCv } from '../../src/signature/opencv';
import { DEFAULT_FARNEBACK } from '../../src/signature/types';
import type { FlowChecks, SpikeRequest, SpikeResponse } from './protocol';

const W = 320;
const H = 180;

function post(message: SpikeResponse): void {
  self.postMessage(message);
}

/** Smooth seeded texture (value noise, 3 octaves), 0..255. */
function makeTexture(width: number, height: number, seed: number): Float32Array {
  const rng = createRng(seed);
  const out = new Float32Array(width * height);
  const octaves = [
    { cell: 24, amp: 0.5 },
    { cell: 10, amp: 0.3 },
    { cell: 4, amp: 0.2 },
  ];
  for (const { cell, amp } of octaves) {
    const gw = Math.ceil(width / cell) + 2;
    const gh = Math.ceil(height / cell) + 2;
    const lattice = new Float32Array(gw * gh).map(() => rng());
    for (let y = 0; y < height; y++) {
      const fy = y / cell;
      const y0 = Math.floor(fy);
      const ty = fy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < width; x++) {
        const fx = x / cell;
        const x0 = Math.floor(fx);
        const tx = fx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const a = lattice[y0 * gw + x0] ?? 0;
        const b = lattice[y0 * gw + x0 + 1] ?? 0;
        const c = lattice[(y0 + 1) * gw + x0] ?? 0;
        const d = lattice[(y0 + 1) * gw + x0 + 1] ?? 0;
        const top = a + (b - a) * sx;
        const bottom = c + (d - c) * sx;
        out[y * width + x] += amp * (top + (bottom - top) * sy);
      }
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = Math.round(30 + 195 * (out[i] ?? 0));
  return out;
}

/** Crop a W×H gray frame out of the texture at (x0, y0). */
function crop(texture: Float32Array, tw: number, x0: number, y0: number): Uint8Array {
  const frame = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) frame[y * W + x] = texture[(y0 + y) * tw + x0 + x] ?? 0;
  }
  return frame;
}

function median(values: Float32Array): number {
  const sorted = Float32Array.from(values).sort();
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** Median u and v over the interior (20 px border excluded) plus the largest |component|. */
function summarize(flow: Float32Array): { medianU: number; medianV: number; maxAbs: number } {
  const border = 20;
  const us: number[] = [];
  const vs: number[] = [];
  let maxAbs = 0;
  for (let y = border; y < H - border; y++) {
    for (let x = border; x < W - border; x++) {
      const u = flow[(y * W + x) * 2] ?? 0;
      const v = flow[(y * W + x) * 2 + 1] ?? 0;
      us.push(u);
      vs.push(v);
      maxAbs = Math.max(maxAbs, Math.abs(u), Math.abs(v));
    }
  }
  return {
    medianU: median(Float32Array.from(us)),
    medianV: median(Float32Array.from(vs)),
    maxAbs,
  };
}

function heapBytes(cv: OpenCv): number {
  return cv.HEAPU8?.buffer.byteLength ?? 0;
}

function runChecks(cv: OpenCv): FlowChecks {
  const tw = W + 80;
  const th = H + 80;
  const texture = makeTexture(tw, th, 20260928);
  const truthU = 3;
  const truthV = -2;
  // B(x, y) = A(x − 3, y + 2): content moves +3 px right and 2 px up (y down).
  const a = crop(texture, tw, 40, 40);
  const b = crop(texture, tw, 40 - truthU, 40 - truthV);

  const engine = new FarnebackFlow(cv, W, H, DEFAULT_FARNEBACK);
  engine.push(a);
  const shiftFlow = engine.push(b);
  const shift = summarize(shiftFlow ?? new Float32Array(W * H * 2));
  engine.reset();
  engine.push(a);
  const zeroFlow = engine.push(a);
  const zero = summarize(zeroFlow ?? new Float32Array(W * H * 2));

  // Timing: 50 frames (blur + Farneback per frame), alternating the two frames.
  engine.reset();
  engine.push(a);
  const times: number[] = [];
  for (let i = 0; i < 50; i++) {
    const t0 = performance.now();
    engine.push(i % 2 === 0 ? b : a);
    times.push(performance.now() - t0);
  }

  // Heap: 200 more frames through the same engine, then 20 engines created and disposed.
  const before = heapBytes(cv);
  for (let i = 0; i < 200; i++) engine.push(i % 2 === 0 ? b : a);
  const after = heapBytes(cv);
  engine.dispose();
  for (let i = 0; i < 20; i++) {
    const e = new FarnebackFlow(cv, W, H, DEFAULT_FARNEBACK);
    e.push(a);
    e.push(b);
    e.dispose();
  }
  const afterEngines = heapBytes(cv);

  return {
    hasFarneback: typeof cv.calcOpticalFlowFarneback === 'function',
    shift: { truthU, truthV, medianU: shift.medianU, medianV: shift.medianV },
    zero,
    timing: {
      runs: times.length,
      avgMs: times.reduce((s, t) => s + t, 0) / times.length,
      minMs: Math.min(...times),
      maxMs: Math.max(...times),
    },
    heap: { runs: 200, before, after, afterEngines },
  };
}

self.onmessage = (event: MessageEvent<SpikeRequest>) => {
  const request = event.data;
  if (request.type !== 'run') return;
  void (async () => {
    const t0 = performance.now();
    let tFetched = t0;
    let tEvaluated = t0;
    let bytes = 0;
    try {
      const { cv, method } = await loadOpenCv(request.opencvUrl, {
        onStage: (stage, info) => {
          if (stage === 'fetched') {
            tFetched = performance.now();
            bytes = info.bytes ?? 0;
          } else if (stage === 'evaluated') {
            tEvaluated = performance.now();
          }
        },
      });
      const tReady = performance.now();
      post({
        type: 'ready',
        timing: {
          method,
          bytes,
          fetchMs: tFetched - t0,
          evalMs: tEvaluated - tFetched,
          initMs: tReady - tEvaluated,
          totalMs: tReady - t0,
        },
      });
      if (request.mode === 'full') post({ type: 'checks', checks: runChecks(cv) });
    } catch (error) {
      post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  })();
};
