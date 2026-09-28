/**
 * Render harness logic: build a composition from a signature and render it through the real
 * pipeline (src/render), for tests/e2e/render.spec.ts and for manual checks on a Mac.
 */
import { ALL_FORMATS, AudioBufferSink, BlobSource, CanvasSink, Input } from 'mediabunny';
import type { Composition, TimelineSettings } from '../../src/engine/composition';
import { createComposition, defaultCompositionName } from '../../src/engine/compositionFactory';
import { getSoundMaterial, getVisualMaterial } from '../../src/materials/registry';
import type {
  MaterialMeta,
  PropertyValues,
  Quality,
  SoundMaterialEntry,
  VisualMaterialEntry,
} from '../../src/materials/types';
// Through the public entry point, which loads the pipeline lazily, as the app does.
import {
  createPauseController,
  createTimelineSampler,
  isRenderCancelled,
  renderComposition,
  signatureDurationOf,
  type RenderDestination,
  type RenderEncoding,
  type RenderPhase,
  type RenderResult,
} from '../../src/render';
import { parseSignature } from '../../src/signature/serialize';
import { createSyntheticSignature } from '../../src/signature/synthetic';
import type { KineticSignature } from '../../src/signature/types';
import {
  CLICK_META,
  CLICK_THRESHOLD,
  FLASH_META,
  onsetClickEntry,
  onsetFlashEntry,
} from './testMaterials';

/** Material ids the harness understands besides the registry's. */
export const TEST_FLASH = 'test-flash';
export const TEST_CLICK = 'test-click';

export interface RenderBytesOptions {
  /** A `.sig.json` to load; default: the synthetic wink. */
  signatureUrl?: string;
  /** Registry id, or 'test-flash'. Default 'water'. */
  visual?: string;
  /** Registry id, or 'test-click'. Default 'water'. */
  sound?: string;
  props?: { visual?: PropertyValues; sound?: PropertyValues };
  timeline?: Partial<TimelineSettings>;
  /** Fit the timeline to this many seconds (one pass: tail to lengthen, speed to shorten). */
  seconds?: number;
  seed?: number;
  compositionName?: string;
  width?: number;
  height?: number;
  fps?: 30 | 60;
  quality?: Quality;
  normalize?: boolean;
  sidecar?: boolean;
  mute?: { visual?: boolean; sound?: boolean };
  /** 'memory' (default) or 'opfs' (a folder in the origin-private file system). */
  destination?: 'memory' | 'opfs';
  /** Folder name inside the origin-private file system. Default 'render-tests'. */
  opfsDir?: string;
  /** Abort once this many frames are done. */
  cancelAtFrame?: number;
  /** Pause for `pauseMs` once this many frames are done. */
  pauseAtFrame?: number;
  pauseMs?: number;
  /** Return the MP4 as base64 (default true). */
  returnBytes?: boolean;
  encoding?: RenderEncoding;
  /** Pretend the composition names a material this version lacks (error-path tests). */
  missingVisualMaterial?: string;
  /** Make the visual material fail after this many steps (error-path tests). */
  failAtStep?: number;
}

export interface ProgressLog {
  /** Phases in the order they were first reported. */
  phases: RenderPhase[];
  calls: number;
  /** Frames never went backwards and moved by at most one per call. */
  monotonic: boolean;
  lastFramesDone: number;
  frameCount: number;
  /** Frames that were reported while the render was paused (should be 0 or 1). */
  framesDuringPause: number;
}

export interface RenderBytesResult {
  ok: boolean;
  cancelled: boolean;
  error: { name: string; message: string; code?: string; detail?: string } | null;
  base64: string | null;
  result: Omit<RenderResult, 'blob'> | null;
  progress: ProgressLog;
  timing: {
    totalMs: number;
    soundMs: number;
    framesMs: number;
    finishMs: number;
    msPerFrame: number;
  };
  /** Onset times (s) in the composition, for alignment checks. */
  onsets: number[];
  /** Entries left in the origin-private folder afterwards (name and size). */
  folderListing: { name: string; size: number }[] | null;
  composition: Composition;
}

const signatureCache = new Map<string, Promise<KineticSignature>>();

export function loadSignature(url?: string): Promise<KineticSignature> {
  const key = url ?? 'synthetic-wink';
  let cached = signatureCache.get(key);
  if (!cached) {
    cached = url
      ? fetch(url).then(async (response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
          return parseSignature(await response.text());
        })
      : Promise.resolve(createSyntheticSignature('wink'));
    signatureCache.set(key, cached);
  }
  return cached;
}

function visualMeta(id: string): MaterialMeta {
  if (id === TEST_FLASH) return FLASH_META;
  const entry = getVisualMaterial(id);
  if (!entry) throw new Error(`No visual material "${id}"`);
  return entry.meta;
}

function soundMeta(id: string): MaterialMeta {
  if (id === TEST_CLICK) return CLICK_META;
  const entry = getSoundMaterial(id);
  if (!entry) throw new Error(`No sound material "${id}"`);
  return entry.meta;
}

/** A composition for the harness: baseline properties, then the overrides given. */
export function buildComposition(
  signature: KineticSignature,
  opts: RenderBytesOptions,
): Composition {
  const visual = visualMeta(opts.visual ?? 'water');
  const sound = soundMeta(opts.sound ?? 'water');
  const composition = createComposition({
    id: 'render-harness',
    now: '2026-09-28T00:00:00.000Z',
    name: opts.compositionName ?? defaultCompositionName(signature.name, visual.name, sound.name),
    signature: {
      id: signature.id,
      contentHash: signature.contentHash,
      name: signature.name,
      preferredSpeed: signature.preferredSpeed,
    },
    seed: opts.seed ?? 4217,
    visual,
    sound,
    render: { width: opts.width ?? 1280, height: opts.height ?? 720, fps: opts.fps ?? 30 },
  });
  composition.timeline = { ...composition.timeline, ...opts.timeline };
  if (opts.seconds !== undefined) {
    const pass = signatureDurationOf(signature);
    composition.timeline.loops = 1;
    if (opts.seconds >= pass) {
      composition.timeline.speed = 1;
      composition.timeline.tailSec = opts.seconds - pass;
    } else {
      composition.timeline.speed = pass / opts.seconds;
      composition.timeline.tailSec = 0;
    }
  }
  composition.visual.properties = { ...composition.visual.properties, ...opts.props?.visual };
  composition.sound.properties = { ...composition.sound.properties, ...opts.props?.sound };
  composition.mute = {
    visual: opts.mute?.visual ?? false,
    sound: opts.mute?.sound ?? false,
  };
  if (opts.missingVisualMaterial) composition.visual.materialId = opts.missingVisualMaterial;
  return composition;
}

/** A registry material whose `step` throws after `steps` steps (error-path tests). */
function failingVisual(entry: VisualMaterialEntry, steps: number): VisualMaterialEntry {
  return {
    ...entry,
    create: () => {
      const material = entry.create();
      const step = material.step.bind(material);
      let taken = 0;
      material.step = (frame, props, dt) => {
        if (++taken > steps) throw new Error(`Test failure after ${steps} steps`);
        step(frame, props, dt);
      };
      return material;
    },
  };
}

/** The dev-only test materials a composition asks for (undefined: use the registry). */
export function harnessMaterials(
  signature: KineticSignature,
  composition: Composition,
  failAtStep?: number,
): { visual?: VisualMaterialEntry; sound?: SoundMaterialEntry } {
  const materials: { visual?: VisualMaterialEntry; sound?: SoundMaterialEntry } = {};
  if (composition.visual.materialId === FLASH_META.id) {
    materials.visual = onsetFlashEntry(createTimelineSampler(signature, composition.timeline));
  } else if (failAtStep !== undefined) {
    const entry = getVisualMaterial(composition.visual.materialId);
    if (entry) materials.visual = failingVisual(entry, failAtStep);
  }
  if (composition.sound.materialId === CLICK_META.id) materials.sound = onsetClickEntry;
  return materials;
}

export async function opfsFolder(name: string): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(name, { create: true });
}

export async function listFolder(
  directory: FileSystemDirectoryHandle,
): Promise<{ name: string; size: number }[]> {
  const entries: { name: string; size: number }[] = [];
  for await (const [name, handle] of directory.entries()) {
    const size = handle.kind === 'file' ? (await handle.getFile()).size : 0;
    entries.push({ name, size });
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

export async function clearOpfs(name: string): Promise<void> {
  const root = await navigator.storage.getDirectory();
  try {
    await root.removeEntry(name, { recursive: true });
  } catch {
    // Not there.
  }
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? reader.result : '';
      resolve(url.slice(url.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'));
    reader.readAsDataURL(blob);
  });
}

export async function renderToBytes(opts: RenderBytesOptions): Promise<RenderBytesResult> {
  const signature = await loadSignature(opts.signatureUrl);
  const composition = buildComposition(signature, opts);
  const onsets = createTimelineSampler(signature, composition.timeline).onsetsBetween(
    0,
    Number.POSITIVE_INFINITY,
  );
  const folderName = opts.opfsDir ?? 'render-tests';
  const folder = opts.destination === 'opfs' ? await opfsFolder(folderName) : null;
  const destination: RenderDestination = folder
    ? { kind: 'folder', directory: folder }
    : { kind: 'memory' };

  const controller = new AbortController();
  const pause = createPauseController();
  const progress: ProgressLog = {
    phases: [],
    calls: 0,
    monotonic: true,
    lastFramesDone: 0,
    frameCount: 0,
    framesDuringPause: 0,
  };
  const marks: Partial<Record<RenderPhase, number>> = {};
  const started = performance.now();

  let result: RenderResult | null = null;
  let error: RenderBytesResult['error'] = null;
  let cancelled = false;
  try {
    result = await renderComposition({
      composition,
      signature,
      output: {
        width: opts.width ?? 1280,
        height: opts.height ?? 720,
        fps: opts.fps ?? 30,
        quality: opts.quality ?? 'high',
        normalize: opts.normalize ?? true,
        sidecar: opts.sidecar ?? false,
      },
      destination,
      signal: controller.signal,
      pause,
      encoding: opts.encoding,
      materials: harnessMaterials(signature, composition, opts.failAtStep),
      onProgress: (p) => {
        progress.calls++;
        if (!progress.phases.includes(p.phase)) {
          progress.phases.push(p.phase);
          marks[p.phase] = performance.now();
        }
        if (p.framesDone < progress.lastFramesDone || p.framesDone > progress.lastFramesDone + 1) {
          progress.monotonic = false;
        }
        if (pause.paused && p.phase === 'frames') progress.framesDuringPause++;
        progress.lastFramesDone = p.framesDone;
        progress.frameCount = p.frameCount;
        if (opts.cancelAtFrame !== undefined && p.framesDone >= opts.cancelAtFrame) {
          controller.abort();
        }
        if (
          opts.pauseAtFrame !== undefined &&
          p.phase === 'frames' &&
          p.framesDone === opts.pauseAtFrame
        ) {
          pause.pause();
          setTimeout(() => pause.resume(), opts.pauseMs ?? 500);
        }
      },
    });
  } catch (err) {
    cancelled = isRenderCancelled(err);
    const e = err as { name?: string; message?: string; code?: string; detail?: string };
    error = cancelled
      ? null
      : {
          name: e.name ?? 'Error',
          message: e.message ?? String(err),
          code: e.code,
          detail: e.detail,
        };
  }
  const ended = performance.now();

  let base64: string | null = null;
  if (result && opts.returnBytes !== false) {
    if (result.blob) base64 = await blobToBase64(result.blob);
    else if (folder) {
      const file = await (await folder.getFileHandle(result.fileName)).getFile();
      base64 = await blobToBase64(file);
    }
  }
  const soundAt = marks.sound ?? started;
  const framesAt = marks.frames ?? soundAt;
  const finishAt = marks.finishing ?? ended;
  const frameCount = result?.frameCount ?? progress.frameCount;
  let summary: Omit<RenderResult, 'blob'> | null = null;
  if (result) {
    const { blob: _blob, ...rest } = result;
    summary = rest;
  }
  return {
    ok: result !== null,
    cancelled,
    error,
    base64,
    result: summary,
    progress,
    timing: {
      totalMs: ended - started,
      soundMs: framesAt - soundAt,
      framesMs: finishAt - framesAt,
      finishMs: ended - finishAt,
      msPerFrame: frameCount > 0 ? (finishAt - framesAt) / frameCount : 0,
    },
    onsets,
    folderListing: folder ? await listFolder(folder) : null,
    composition,
  };
}

export interface ReadBack {
  durationSec: number;
  frames: number;
  /** Presentation times (s) of white frames. */
  flashTimes: number[];
  /** Times (s) where the sound first rises above the click threshold after silence. */
  clickTimes: number[];
  sampleRate: number | null;
  channels: number | null;
}

/**
 * Read an MP4 back with Mediabunny (as a player would, edit lists applied) and find the
 * white frames and click onsets. Works on a Mac without ffmpeg.
 */
export async function readBack(blob: Blob): Promise<ReadBack> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const durationSec = await input.computeDuration();
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    const flashTimes: number[] = [];
    let frames = 0;
    if (video) {
      const sink = new CanvasSink(video, { width: 32, height: 18, fit: 'fill', poolSize: 1 });
      const probe = document.createElement('canvas');
      probe.width = 32;
      probe.height = 18;
      const ctx = probe.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('No 2D context');
      for await (const wrapped of sink.canvases()) {
        frames++;
        ctx.drawImage(wrapped.canvas, 0, 0);
        const pixels = ctx.getImageData(0, 0, 32, 18).data;
        let sum = 0;
        for (let i = 0; i < pixels.length; i += 4) sum += pixels[i + 1] ?? 0;
        if (sum / (pixels.length / 4) > 128) flashTimes.push(wrapped.timestamp);
      }
    }
    const clickTimes: number[] = [];
    let sampleRate: number | null = null;
    let channels: number | null = null;
    if (audio) {
      sampleRate = await audio.getSampleRate();
      channels = await audio.getNumberOfChannels();
      const sink = new AudioBufferSink(audio);
      let quietFor = Number.POSITIVE_INFINITY;
      for await (const { buffer, timestamp } of sink.buffers()) {
        const left = buffer.getChannelData(0);
        for (let i = 0; i < left.length; i++) {
          const loud = Math.abs(left[i] ?? 0) > CLICK_THRESHOLD;
          if (loud && quietFor > 0.05 * buffer.sampleRate) {
            clickTimes.push(timestamp + i / buffer.sampleRate);
          }
          quietFor = loud ? 0 : quietFor + 1;
        }
      }
    }
    return { durationSec, frames, flashTimes, clickTimes, sampleRate, channels };
  } finally {
    input.dispose();
  }
}

export interface AlignmentReport {
  fps: number;
  width: number;
  height: number;
  onsets: number[];
  flashTimes: number[];
  clickTimes: number[];
  /** Click minus flash, per onset, in ms (negative: the sound comes first). */
  offsetsMs: number[];
  withinOneFrame: boolean;
  frames: number;
  durationSec: number;
  audio: string;
  text: string;
}

/** Render the flash/click composition and measure alignment in the page (Mac check). */
export async function alignmentCheck(
  opts: {
    signatureUrl?: string;
    fps?: 30 | 60;
    width?: number;
    height?: number;
    speed?: number;
  } = {},
): Promise<AlignmentReport> {
  const fps = opts.fps ?? 30;
  const width = opts.width ?? 1280;
  const height = opts.height ?? 720;
  const signature = await loadSignature(opts.signatureUrl);
  const options: RenderBytesOptions = {
    signatureUrl: opts.signatureUrl,
    visual: TEST_FLASH,
    sound: TEST_CLICK,
    timeline: { speed: opts.speed ?? 1, tailSec: 1, loops: 1, smoothing: 0 },
    width,
    height,
    fps,
    quality: 'draft',
    returnBytes: false,
  };
  const composition = buildComposition(signature, options);
  const result = await renderComposition({
    composition,
    signature,
    output: { width, height, fps, quality: 'draft', normalize: true },
    destination: { kind: 'memory' },
    materials: harnessMaterials(signature, composition),
  });
  if (!result.blob) throw new Error('No file');
  const onsets = createTimelineSampler(signature, composition.timeline).onsetsBetween(
    0,
    Number.POSITIVE_INFINITY,
  );
  const back = await readBack(result.blob);
  const offsetsMs = back.clickTimes.map((click) => {
    let best = Number.POSITIVE_INFINITY;
    for (const flash of back.flashTimes) {
      if (Math.abs(click - flash) < Math.abs(best)) best = click - flash;
    }
    return best * 1000;
  });
  const frameMs = 1000 / fps;
  const withinOneFrame =
    offsetsMs.length === onsets.length &&
    back.flashTimes.length === onsets.length &&
    offsetsMs.every((ms) => Math.abs(ms) <= frameMs + 0.5);
  const audio = `${result.audio.codec ?? 'none'} ${result.audio.bitrate ?? ''} (${back.sampleRate ?? '?'} Hz × ${back.channels ?? '?'})`;
  const lines = [
    `Alignment check: ${width}×${height} at ${fps} fps, ${result.mimeType}`,
    `Audio: ${audio}`,
    `Onsets: ${onsets.map((t) => t.toFixed(4)).join(', ')} s`,
    `White frames at: ${back.flashTimes.map((t) => t.toFixed(4)).join(', ')} s`,
    `Clicks at: ${back.clickTimes.map((t) => t.toFixed(4)).join(', ')} s`,
    `Offsets (click − flash): ${offsetsMs.map((ms) => `${ms.toFixed(1)} ms`).join(', ')}`,
    `Within one frame (${frameMs.toFixed(1)} ms): ${withinOneFrame ? 'yes' : 'NO'}`,
    `Frames read back: ${back.frames}; duration ${back.durationSec.toFixed(3)} s`,
  ];
  return {
    fps,
    width,
    height,
    onsets,
    flashTimes: back.flashTimes,
    clickTimes: back.clickTimes,
    offsetsMs,
    withinOneFrame,
    frames: back.frames,
    durationSec: back.durationSec,
    audio,
    text: lines.join('\n'),
  };
}
