/**
 * Offline render of one composition to MP4 (SPEC 10.2). This module loads Mediabunny and
 * every material, so import it lazily; src/render/index.ts does that for you.
 *
 * 1. Fresh instances: a sampler per field, configured from the composition's timeline; a
 *    dedicated canvas at the output size with its own WebGL2 context (the preview's is
 *    untouched); the visual material created from the registry, `init` at the render
 *    quality (default High), then reset to the composition's visual seed.
 * 2. Sound first: the whole timeline on an OfflineAudioContext at 48 kHz stereo
 *    (`renderSoundOffline`), peak-normalized to −1 dBFS unless turned off. A muted sound
 *    field gives silence; a muted visual field gives black frames.
 * 3. An MP4 `Output` with a CanvasSource (H.264) and an AudioBufferSource (AAC, or Opus
 *    when AAC isn't available), encoded exactly as Diagnostics tested them.
 * 4. For frame i of N = ceil(duration × fps): t = i / fps; the VisualRunner steps the
 *    material in fixed 1/60 s steps until simulation time ≥ t; draw; add the canvas with
 *    timestamp t and duration 1/fps. The sound is handed to the encoder about a second
 *    ahead of the frames, so the file interleaves as it streams. Progress after every
 *    frame; the page gets a turn between frames; pause and cancel are honoured.
 * 5. Finalize, then deliver: a folder (streamed, never overwriting), a download, or a Blob.
 *    Everything is disposed and the WebGL context released, whatever happens.
 *
 * The file uses Mediabunny's `fastStart: 'reserve'`: room for the index is reserved at the
 * start and filled in at the end, so the MP4 is "fast start" (plays while downloading, as
 * web players like) even though it streams to disk. Memory and folder renders produce the
 * same bytes layout.
 *
 * No clock reads or browser randomness here: the same signature, composition and seed
 * give the same frames and sound on the same machine (SPEC C6).
 */
import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  Quality,
  StreamTarget,
  type Target,
} from 'mediabunny';
import { renderSoundOffline } from '../engine/audio/offline';
import type { Composition } from '../engine/composition';
import { serializeComposition } from '../engine/compositionSerialize';
import { completeValues } from '../engine/propertyModel';
import { soundSeed, visualRng, visualSeed } from '../engine/seeds';
import { VisualRunner } from '../engine/visualRunner';
import { downloadBlob, downloadText } from '../library/download';
import { getSoundMaterial, getVisualMaterial } from '../materials/registry';
import type {
  PropertyValues,
  SoundMaterialEntry,
  VisualMaterial,
  VisualMaterialEntry,
} from '../materials/types';
import { getVisualContext, releaseVisualContext } from '../materials/visual/shared/gl';
import { getRenderDefaults } from './capabilities';
import { RENDER_VIDEO_QUALITY } from './capabilities/codecs';
import {
  RenderCancelledError,
  RenderError,
  isRenderCancelled,
  renderMessage,
  throwIfCancelled,
  toRenderError,
  type RenderStage,
} from './errors';
import { createFolderFile, takenNames, writeFolderText, type FolderFile } from './folderTarget';
import {
  MP4_EXTENSION,
  SIDECAR_EXTENSION,
  firstFreeNumber,
  numberedStem,
  renderFileStem,
} from './naming';
import { yieldToEventLoop } from './pause';
import type { RenderPhase } from './progress';
import {
  RENDER_CHANNELS,
  RENDER_SAMPLE_RATE,
  audioFeedTarget,
  audioSampleCount,
  frameDuration,
  frameTime,
  maxAudioPackets,
  maxVideoPackets,
  renderFrameCount,
} from './timing';
import { compositionDuration, createTimelineSampler } from './timeline';
import type { RenderEncoding, RenderRequest, RenderResult } from './types';

/** Sound is handed to the encoder in pieces of this many samples (one second). */
const SOUND_CHUNK = RENDER_SAMPLE_RATE;

export const SIDECAR_WARNING =
  'The video is saved, but the composition file couldn’t be saved next to it.';

/** H.264 needs even dimensions. */
function evenSize(value: number): number {
  const v = Number.isFinite(value) ? Math.round(value) : 2;
  return Math.max(2, v - (v % 2));
}

async function defaultEncoding(): Promise<RenderEncoding> {
  const defaults = await getRenderDefaults();
  if (!defaults.largestResolution) {
    throw new RenderError('no-video', renderMessage('no-video'), defaults.notes.join(' '));
  }
  return { audioCodec: defaults.audioCodec, audioBitrate: defaults.audioBitrate };
}

function resolveVisual(request: RenderRequest): VisualMaterialEntry {
  const id = request.composition.visual.materialId;
  const entry = request.materials?.visual ?? getVisualMaterial(id);
  if (!entry) {
    throw new RenderError(
      'material-missing',
      renderMessage('material-missing', id),
      `visual ${id}`,
    );
  }
  return entry;
}

function resolveSound(request: RenderRequest): SoundMaterialEntry {
  const id = request.composition.sound.materialId;
  const entry = request.materials?.sound ?? getSoundMaterial(id);
  if (!entry) {
    throw new RenderError('material-missing', renderMessage('material-missing', id), `sound ${id}`);
  }
  return entry;
}

/** One chunk of sound, [start, end) samples, as an AudioBuffer for the encoder. */
function soundChunk(source: AudioBuffer | null, start: number, end: number): AudioBuffer {
  const chunk = new AudioBuffer({
    length: end - start,
    numberOfChannels: RENDER_CHANNELS,
    sampleRate: RENDER_SAMPLE_RATE,
  });
  if (source) {
    for (let c = 0; c < RENDER_CHANNELS; c++) {
      const data = source.getChannelData(Math.min(c, source.numberOfChannels - 1));
      chunk.copyToChannel(data.subarray(start, Math.min(end, data.length)), c);
    }
  }
  return chunk;
}

interface Picture {
  canvas: HTMLCanvasElement;
  /** Draw the frame for composition time t. Synchronous, so the canvas is captured intact. */
  draw(t: number): void;
  dispose(): void;
}

/** Black frames for a muted visual field: no material, no WebGL. */
function blackPicture(width: number, height: number): Picture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('No 2D canvas context');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  return {
    canvas,
    draw() {},
    dispose() {
      canvas.width = 0;
      canvas.height = 0;
    },
  };
}

async function materialPicture(
  request: RenderRequest,
  entry: VisualMaterialEntry,
  width: number,
  height: number,
): Promise<Picture> {
  const { composition, signature } = request;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const gl = getVisualContext(canvas);
  if (!gl) {
    throw new RenderError('no-webgl', renderMessage('no-webgl'), 'no WebGL2 context');
  }
  let material: VisualMaterial | null = null;
  const dispose = () => {
    material?.dispose();
    material = null;
    releaseVisualContext(gl);
    canvas.width = 0;
    canvas.height = 0;
  };
  try {
    const seed = visualSeed(composition.seed);
    const props: PropertyValues = completeValues(
      composition.visual.properties,
      entry.meta.properties,
    );
    const created = entry.create();
    material = created;
    await created.init({
      gl,
      width,
      height,
      quality: request.output.quality ?? 'high',
      seed,
      rng: visualRng(composition.seed),
    });
    const runner = new VisualRunner(
      created,
      createTimelineSampler(signature, composition.timeline),
      seed,
    );
    runner.reset(seed);
    // Display-only properties (brightness, palette, surface light) apply from frame 0.
    created.setProperties?.(props);
    return {
      canvas,
      draw(t) {
        runner.advanceTo(t, props);
        runner.draw();
        if (gl.isContextLost()) {
          throw new RenderError('gpu-lost', renderMessage('gpu-lost'), 'WebGL context lost');
        }
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

async function renderSound(
  request: RenderRequest,
  sampleCount: number,
): Promise<AudioBuffer | null> {
  const { composition, signature } = request;
  if (composition.mute.sound) return null;
  const entry = resolveSound(request);
  return renderSoundOffline({
    entry,
    sampler: createTimelineSampler(signature, composition.timeline),
    props: completeValues(composition.sound.properties, entry.meta.properties),
    seed: soundSeed(composition.seed),
    duration: sampleCount / RENDER_SAMPLE_RATE,
    sampleRate: RENDER_SAMPLE_RATE,
    normalize: request.output.normalize ?? true,
  });
}

function sidecarFor(composition: Composition, output: RenderResult): string {
  return serializeComposition({
    ...composition,
    render: { width: output.width, height: output.height, fps: output.fps },
  });
}

async function cancelQuietly(output: Output | null): Promise<void> {
  if (!output || output.state === 'finalized' || output.state === 'canceled') return;
  try {
    await output.cancel();
  } catch {
    // Already torn down.
  }
}

/** Render one composition to MP4. Rejects with RenderCancelledError when cancelled. */
export async function renderComposition(request: RenderRequest): Promise<RenderResult> {
  const { composition, signature, destination, signal } = request;
  const fps = request.output.fps;
  const width = evenSize(request.output.width);
  const height = evenSize(request.output.height);
  const quality = request.output.quality ?? 'high';
  const normalize = request.output.normalize ?? true;
  const wantSidecar = request.output.sidecar ?? false;
  const folderName = destination.kind === 'folder' ? destination.directory.name : null;
  const yieldToUi = request.yieldToUi ?? yieldToEventLoop;

  const timelineSec = compositionDuration(signature, composition.timeline);
  const frameCount = renderFrameCount(timelineSec, fps);
  const sampleCount = audioSampleCount(frameCount, fps, RENDER_SAMPLE_RATE);
  const report = (phase: RenderPhase, framesDone: number) =>
    request.onProgress?.({ phase, framesDone, frameCount });

  let stage: RenderStage = 'setup';
  let picture: Picture | null = null;
  let output: Output | null = null;
  let folderFile: FolderFile | null = null;

  try {
    throwIfCancelled(signal);
    report('starting', 0);
    // Resolve the materials first, so a missing one fails before any work.
    const visualEntry = composition.mute.visual ? null : resolveVisual(request);
    if (!composition.mute.sound) resolveSound(request);
    const encoding = request.encoding ?? (await defaultEncoding());
    throwIfCancelled(signal);

    // Sound first (SPEC 10.2 step 3).
    stage = 'sound';
    report('sound', 0);
    const sound = encoding.audioCodec ? await renderSound(request, sampleCount) : null;
    throwIfCancelled(signal);

    stage = 'setup';
    picture = visualEntry
      ? await materialPicture(request, visualEntry, width, height)
      : blackPicture(width, height);
    throwIfCancelled(signal);

    const stem = renderFileStem(signature.name, composition.name, composition.seed);
    let fileName = `${stem}${MP4_EXTENSION}`;
    let target: Target;
    let memoryTarget: BufferTarget | null = null;
    if (destination.kind === 'folder') {
      stage = 'saving';
      folderFile = await createFolderFile(
        destination.directory,
        stem,
        wantSidecar ? [SIDECAR_EXTENSION] : [],
      );
      fileName = folderFile.fileName;
      target = new StreamTarget(folderFile.writable, { chunked: true });
      stage = 'setup';
    } else {
      memoryTarget = new BufferTarget();
      target = memoryTarget;
    }

    const out = new Output({ format: new Mp4OutputFormat({ fastStart: 'reserve' }), target });
    output = out;
    const video = new CanvasSource(picture.canvas, {
      codec: 'avc',
      quality: new Quality(RENDER_VIDEO_QUALITY),
    });
    out.addVideoTrack(video, { frameRate: fps, maximumPacketCount: maxVideoPackets(frameCount) });
    let audio: AudioBufferSource | null = null;
    if (encoding.audioCodec && encoding.audioBitrate) {
      audio = new AudioBufferSource({
        codec: encoding.audioCodec,
        quality: new Quality({ bitrate: encoding.audioBitrate }),
      });
      out.addAudioTrack(audio, { maximumPacketCount: maxAudioPackets(sampleCount) });
    }
    await out.start();

    // The frames (SPEC 10.2 step 5).
    stage = 'frames';
    report('frames', 0);
    let soundFed = 0;
    const feedSound = async (upTo: number) => {
      if (!audio) return;
      while (soundFed < upTo) {
        const end = Math.min(upTo, soundFed + SOUND_CHUNK);
        await audio.add(soundChunk(sound, soundFed, end));
        soundFed = end;
      }
    };
    const duration = frameDuration(fps);
    for (let i = 0; i < frameCount; i++) {
      await request.pause?.wait(signal);
      throwIfCancelled(signal);
      await feedSound(audioFeedTarget(i, fps, sampleCount));
      const t = frameTime(i, fps);
      // Draw and capture in the same task: the canvas doesn't keep its drawing afterwards.
      picture.draw(t);
      await video.add(t, duration);
      report('frames', i + 1);
      await yieldToUi();
    }
    await feedSound(sampleCount);
    throwIfCancelled(signal);

    stage = 'finishing';
    report('finishing', frameCount);
    folderFile?.markComplete();
    await out.finalize();
    const mimeType = await out.getMimeType();
    // Cancelled while finishing: the finished file is removed like any other.
    throwIfCancelled(signal);
    // From here on the MP4 stays, whatever happens next.
    const savedFile = folderFile;
    folderFile = null;

    stage = 'saving';
    const result: RenderResult = {
      fileName,
      destination: destination.kind,
      folderName,
      sidecarFileName: null,
      sidecarText: null,
      blob: null,
      bytes: 0,
      mimeType,
      width,
      height,
      fps,
      quality,
      frameCount,
      durationSec: frameCount / fps,
      timelineSec,
      audio: {
        codec: audio ? encoding.audioCodec : null,
        bitrate: audio ? encoding.audioBitrate : null,
        muted: composition.mute.sound,
        normalized: normalize && !composition.mute.sound && audio !== null,
      },
      visualMuted: composition.mute.visual,
      warnings: [],
    };
    const sidecarText = wantSidecar ? sidecarFor(composition, result) : null;
    result.sidecarText = sidecarText;

    if (destination.kind === 'folder' && savedFile) {
      try {
        result.bytes = (await (await destination.directory.getFileHandle(fileName)).getFile()).size;
      } catch {
        // The size is only informative.
      }
      if (sidecarText !== null) {
        // Same stem as the MP4, checked again in case something took the name meanwhile.
        const mp4Stem = numberedStem(stem, savedFile.number);
        try {
          const taken = await takenNames(destination.directory);
          const n = firstFreeNumber(mp4Stem, [SIDECAR_EXTENSION], taken);
          const name = `${numberedStem(mp4Stem, n)}${SIDECAR_EXTENSION}`;
          await writeFolderText(destination.directory, name, sidecarText);
          result.sidecarFileName = name;
        } catch {
          result.warnings.push(SIDECAR_WARNING);
        }
      }
    } else {
      const bytes = memoryTarget?.buffer;
      if (!bytes) throw new Error('The MP4 is empty');
      const blob = new Blob([bytes], { type: 'video/mp4' });
      result.blob = blob;
      result.bytes = blob.size;
      if (sidecarText !== null) result.sidecarFileName = `${stem}${SIDECAR_EXTENSION}`;
      if (destination.kind === 'download') {
        downloadBlob(blob, fileName);
        if (sidecarText !== null && result.sidecarFileName) {
          downloadText(sidecarText, result.sidecarFileName);
        }
      }
    }
    report('done', frameCount);
    return result;
  } catch (error) {
    await cancelQuietly(output);
    await folderFile?.discard();
    if (signal?.aborted || isRenderCancelled(error)) throw new RenderCancelledError();
    throw toRenderError(error, stage, folderName);
  } finally {
    picture?.dispose();
  }
}
