/**
 * Spike 2 decode checks. Runs in a worker (the plan) or on the main thread (SPEC 7.4's
 * fallback), so it only uses APIs available in both: Mediabunny, OffscreenCanvas,
 * fetch. Every VideoSample obtained here is counted and closed.
 */
import {
  ALL_FORMATS,
  BlobSource,
  CanvasSink,
  Input,
  VideoSampleSink,
  type VideoSample,
} from 'mediabunny';
import { createRng, hashString32 } from '../../src/chance/prng';
import { readBarcode } from './barcode';

export interface ClipSpec {
  name: string;
  url: string;
  /** Nominal frame rate the clip was made with. */
  fps: number;
  frames: number;
  /** Displayed (after rotation metadata) width and height. */
  displayWidth: number;
  displayHeight: number;
  /** Expected container rotation (clockwise degrees). */
  rotation: number;
}

export interface SeekResult {
  index: number;
  atStart: number | null;
  atMiddle: number | null;
}

export interface ClipResult {
  name: string;
  error: string | null;
  codec: string | null;
  canDecode: boolean;
  rotation: number;
  displayWidth: number;
  displayHeight: number;
  firstTimestamp: number;
  durationSec: number;
  packetCount: number;
  averagePacketRate: number;
  bestGuessFrameRate: number;
  /** Frame indices read from the barcodes during a sequential pass (null = bad read). */
  sequence: (number | null)[];
  /** Largest |timestamp − index / fps| in the sequential pass, seconds. */
  worstTimestampError: number;
  seeks: SeekResult[];
  /** Indices read back from samplesAtTimestamps((i + 0.5) / fps), i = 0..frames−1. */
  atTimestamps: (number | null)[];
  /** CanvasSink with the track's rotation, resized to 320 wide. */
  canvasSink: { width: number; height: number; sequence: (number | null)[] };
  decodeFps: number;
  pipelineFps: number;
  samplesOpened: number;
  samplesClosed: number;
}

interface CanvasLike {
  width: number;
  height: number;
  getContext(contextId: '2d'): unknown;
}

function pixels(canvas: CanvasLike): Uint8ClampedArray {
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error('No 2D context');
  return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
}

export async function checkClip(spec: ClipSpec): Promise<ClipResult> {
  const result: ClipResult = {
    name: spec.name,
    error: null,
    codec: null,
    canDecode: false,
    rotation: 0,
    displayWidth: 0,
    displayHeight: 0,
    firstTimestamp: NaN,
    durationSec: NaN,
    packetCount: 0,
    averagePacketRate: NaN,
    bestGuessFrameRate: NaN,
    sequence: [],
    worstTimestampError: NaN,
    seeks: [],
    atTimestamps: [],
    canvasSink: { width: 0, height: 0, sequence: [] },
    decodeFps: NaN,
    pipelineFps: NaN,
    samplesOpened: 0,
    samplesClosed: 0,
  };
  const opened = (sample: VideoSample | null): VideoSample | null => {
    if (sample) result.samplesOpened++;
    return sample;
  };
  const close = (sample: VideoSample | null): void => {
    if (!sample) return;
    sample.close();
    result.samplesClosed++;
  };
  const scratch = new OffscreenCanvas(spec.displayWidth, spec.displayHeight);
  const scratchCtx = scratch.getContext('2d', { willReadFrequently: true });
  if (!scratchCtx) throw new Error('No 2D context');
  /** Draw with the sample's own rotation (display orientation) and read the barcode. */
  const read = (sample: VideoSample): number | null => {
    if (scratch.width !== sample.displayWidth || scratch.height !== sample.displayHeight) {
      scratch.width = sample.displayWidth;
      scratch.height = sample.displayHeight;
    }
    sample.draw(scratchCtx, 0, 0);
    const data = scratchCtx.getImageData(0, 0, scratch.width, scratch.height).data;
    return readBarcode(data, scratch.width, scratch.height);
  };

  const blob = await (await fetch(spec.url)).blob();
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('No video track');
    result.codec = await track.getCodec();
    result.canDecode = await track.canDecode();
    result.rotation = await track.getRotation();
    result.displayWidth = await track.getDisplayWidth();
    result.displayHeight = await track.getDisplayHeight();
    result.firstTimestamp = await track.getFirstTimestamp();
    result.durationSec = await track.computeDuration();
    const stats = await track.computePacketStats();
    result.packetCount = stats.packetCount;
    result.averagePacketRate = stats.averagePacketRate;
    result.bestGuessFrameRate = (await track.computeFrameRateMetrics()).bestGuessFrameRate;
    if (!result.canDecode) return result;

    const sink = new VideoSampleSink(track);

    // Pure decode speed: every frame, closed at once.
    let t0 = performance.now();
    let count = 0;
    for await (const sample of sink.samples()) {
      opened(sample);
      count++;
      close(sample);
    }
    result.decodeFps = count / ((performance.now() - t0) / 1000);

    // Sequential pass with barcode reads and timestamps.
    let worst = 0;
    for await (const sample of sink.samples()) {
      opened(sample);
      try {
        const index = read(sample);
        result.sequence.push(index);
        if (index !== null) worst = Math.max(worst, Math.abs(sample.timestamp - index / spec.fps));
      } finally {
        close(sample);
      }
    }
    result.worstTimestampError = worst;

    // Seeded random seeks, in random order (so some go backwards across keyframes).
    const rng = createRng(hashString32(spec.name));
    for (let k = 0; k < 10; k++) {
      const index = Math.floor(rng() * spec.frames);
      const seek: SeekResult = { index, atStart: null, atMiddle: null };
      const atStart = opened(await sink.getSample(index / spec.fps));
      try {
        seek.atStart = atStart ? read(atStart) : null;
      } finally {
        close(atStart);
      }
      const atMiddle = opened(await sink.getSample((index + 0.5) / spec.fps));
      try {
        seek.atMiddle = atMiddle ? read(atMiddle) : null;
      } finally {
        close(atMiddle);
      }
      result.seeks.push(seek);
    }

    // The extraction path: fixed-rate timestamps at frame middles.
    const times = Array.from({ length: spec.frames }, (_, i) => (i + 0.5) / spec.fps);
    for await (const sample of sink.samplesAtTimestamps(times)) {
      opened(sample);
      try {
        result.atTimestamps.push(sample ? read(sample) : null);
      } finally {
        close(sample);
      }
    }

    // CanvasSink with the track's rotation, resized like extraction does (320 wide).
    const canvasSink = new CanvasSink(track, { width: 320, poolSize: 2 });
    t0 = performance.now();
    for await (const wrapped of canvasSink.canvasesAtTimestamps(times)) {
      if (!wrapped) {
        result.canvasSink.sequence.push(null);
        continue;
      }
      const canvas = wrapped.canvas as unknown as CanvasLike;
      result.canvasSink.width = canvas.width;
      result.canvasSink.height = canvas.height;
      result.canvasSink.sequence.push(readBarcode(pixels(canvas), canvas.width, canvas.height));
    }
    result.pipelineFps = spec.frames / ((performance.now() - t0) / 1000);
  } catch (error) {
    result.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  } finally {
    input.dispose();
  }
  return result;
}

/** Count Mediabunny's "garbage collected without first being closed" messages. */
export function watchUnclosedWarnings(): () => number {
  let count = 0;
  const original = console.error.bind(console);
  const originalWarn = console.warn.bind(console);
  const check = (args: unknown[]) => {
    if (args.some((a) => typeof a === 'string' && a.includes('garbage collected'))) count++;
  };
  console.error = (...args: unknown[]) => {
    check(args);
    original(...args);
  };
  console.warn = (...args: unknown[]) => {
    check(args);
    originalWarn(...args);
  };
  return () => count;
}

/** Force a garbage collection if Chrome was started with --js-flags=--expose-gc. */
export async function collectGarbage(): Promise<boolean> {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (typeof gc !== 'function') return false;
  gc();
  await new Promise((resolve) => setTimeout(resolve, 300));
  gc();
  await new Promise((resolve) => setTimeout(resolve, 300));
  return true;
}
