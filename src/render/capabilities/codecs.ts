/**
 * Codec probes (SPEC 10.3, 14.1), using Mediabunny the same way the render pipeline will.
 *
 * Encode support is confirmed by a tiny real encode rather than trusting
 * `isConfigSupported`: a few canvas frames through `CanvasSource` (AVC) and a short tone
 * through `AudioBufferSource` (AAC, else Opus) into an MP4 `Output` with a `BufferTarget`.
 * A size or codec passes only if packets come out and the MP4 has bytes. AAC is tried at
 * 192, 160, 128 and 96 kbps (Windows' Media Foundation AAC encoder accepts only those), and
 * the bitrate that works is recorded for the render dialog.
 *
 * This module imports Mediabunny, so load it lazily (`import('./codecs')`) from code that
 * runs at startup.
 */
import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  canEncodeVideo,
  Mp4OutputFormat,
  Output,
  Quality,
  type QualityLevel,
} from 'mediabunny';
import {
  AAC_BITRATES,
  AUDIO_CHANNELS,
  AUDIO_SAMPLE_RATE,
  OPUS_BITRATES,
  pickRenderDefaults,
  RENDER_SIZES,
  type AudioCodecOutcome,
  type AudioEncodeAttempt,
  type AudioEncodeResult,
  type DecodeEntry,
  type DecodeResult,
  type RenderDefaults,
  type RenderResolution,
  type RenderSupport,
  type VideoEncodeResult,
} from './codecAssess';
import { errorMessage, TimeoutError, withTimeout } from './util';

/** The video quality the render pipeline should use, so the probe tests the same configuration. */
export const RENDER_VIDEO_QUALITY: QualityLevel = 'high';

const PROBE_FRAMES = 3;
const PROBE_FPS = 30;
const ENCODE_TIMEOUT_MS = 20_000;
const DECODE_TIMEOUT_MS = 5_000;

type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function createCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function drawProbeFrame(ctx: Canvas2D, width: number, height: number, index: number): void {
  ctx.fillStyle = `rgb(${14 + index * 40}, 26, 36)`;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#e8e4da';
  ctx.fillRect(((index + 1) * width) / 8, height / 3, width / 8, height / 3);
}

function describeRateControl(config: VideoEncoderConfig | null): string | null {
  if (!config) return null;
  const hardware = `hardware acceleration: ${config.hardwareAcceleration ?? 'no-preference'}`;
  if (config.bitrateMode === 'quantizer') return `quantizer (per-frame QP); ${hardware}`;
  return `${config.bitrateMode ?? 'variable'}, ${config.bitrate ?? '?'} bps; ${hardware}`;
}

/** Encode a few frames at one output size and report what came out. Never throws. */
export async function probeVideoEncode(resolution: RenderResolution): Promise<VideoEncodeResult> {
  const { width, height } = RENDER_SIZES[resolution];
  const result: VideoEncodeResult = {
    resolution,
    width,
    height,
    ok: false,
    webCodecs: typeof VideoEncoder === 'function',
    configSupported: null,
    frames: 0,
    packets: 0,
    bytes: 0,
    codecString: null,
    rateControl: null,
    timedOut: false,
    error: null,
  };
  if (!result.webCodecs) {
    result.error = 'VideoEncoder is not defined';
    return result;
  }

  try {
    result.configSupported = await withTimeout(
      canEncodeVideo('avc', {
        width,
        height,
        quality: new Quality(RENDER_VIDEO_QUALITY),
        frameRate: PROBE_FPS,
      }),
      ENCODE_TIMEOUT_MS,
      'canEncodeVideo',
    );
  } catch (error) {
    result.timedOut = error instanceof TimeoutError;
    result.error = errorMessage(error);
    return result;
  }
  if (!result.configSupported) {
    result.error = 'No supported AVC encoder configuration (canEncodeVideo returned false)';
    return result;
  }

  let output: Output | null = null;
  const seen: { config: VideoEncoderConfig | null } = { config: null };
  try {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2D canvas context');
    const source = new CanvasSource(canvas, {
      codec: 'avc',
      quality: new Quality(RENDER_VIDEO_QUALITY),
      onEncoderConfig: (config) => {
        seen.config = config;
      },
      onEncodedPacket: (_packet, meta) => {
        result.packets++;
        if (meta?.decoderConfig?.codec) result.codecString = meta.decoderConfig.codec;
      },
    });
    const target = new BufferTarget();
    const out = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
    output = out;
    out.addVideoTrack(source, { frameRate: PROBE_FPS });
    await withTimeout(
      (async () => {
        await out.start();
        for (let i = 0; i < PROBE_FRAMES; i++) {
          drawProbeFrame(ctx, width, height, i);
          await source.add(i / PROBE_FPS, 1 / PROBE_FPS);
          result.frames++;
        }
        await out.finalize();
      })(),
      ENCODE_TIMEOUT_MS,
      `${resolution} encode`,
    );
    result.bytes = target.buffer?.byteLength ?? 0;
  } catch (error) {
    result.timedOut = error instanceof TimeoutError;
    result.error = errorMessage(error);
    await cancelQuietly(output);
  }
  result.rateControl = describeRateControl(seen.config);
  result.ok = result.error === null && result.packets > 0 && result.bytes > 0;
  return result;
}

async function cancelQuietly(output: Output | null): Promise<void> {
  if (!output || output.state === 'finalized' || output.state === 'canceled') return;
  try {
    await output.cancel();
  } catch {
    // Already torn down.
  }
}

function makeTestTone(): AudioBuffer {
  const length = AUDIO_SAMPLE_RATE / 10;
  const buffer = new AudioBuffer({
    length,
    numberOfChannels: AUDIO_CHANNELS,
    sampleRate: AUDIO_SAMPLE_RATE,
  });
  for (let c = 0; c < AUDIO_CHANNELS; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) {
      data[i] = 0.2 * Math.sin((2 * Math.PI * 440 * i) / AUDIO_SAMPLE_RATE);
    }
  }
  return buffer;
}

/** Encode 0.1 s of stereo tone at one codec and bitrate. Never throws. */
export async function probeAudioEncodeAt(
  codec: 'aac' | 'opus',
  bitrate: number,
): Promise<AudioEncodeAttempt> {
  const attempt: AudioEncodeAttempt = {
    codec,
    bitrate,
    ok: false,
    packets: 0,
    codecString: null,
    timedOut: false,
    error: null,
  };
  let output: Output | null = null;
  try {
    const source = new AudioBufferSource({
      codec,
      quality: new Quality({ bitrate }),
      onEncodedPacket: (_packet, meta) => {
        attempt.packets++;
        if (meta?.decoderConfig?.codec) attempt.codecString = meta.decoderConfig.codec;
      },
    });
    const target = new BufferTarget();
    const out = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
    output = out;
    out.addAudioTrack(source);
    await withTimeout(
      (async () => {
        await out.start();
        await source.add(makeTestTone());
        await out.finalize();
      })(),
      ENCODE_TIMEOUT_MS,
      `${codec} encode`,
    );
    attempt.ok = attempt.packets > 0 && (target.buffer?.byteLength ?? 0) > 0;
    if (!attempt.ok) attempt.error = 'No packets came out';
  } catch (error) {
    attempt.timedOut = error instanceof TimeoutError;
    attempt.error = errorMessage(error);
    await cancelQuietly(output);
  }
  return attempt;
}

async function tryBitrates(
  codec: 'aac' | 'opus',
  bitrates: readonly number[],
): Promise<AudioCodecOutcome> {
  const attempts: AudioEncodeAttempt[] = [];
  for (const bitrate of bitrates) {
    const attempt = await probeAudioEncodeAt(codec, bitrate);
    attempts.push(attempt);
    if (attempt.ok) return { ok: true, bitrate, codecString: attempt.codecString, attempts };
    if (attempt.timedOut) break; // Don't stack up hung encoders.
  }
  return { ok: false, bitrate: null, codecString: null, attempts };
}

/** AAC at the first bitrate that works; Opus only when AAC fails. Never throws. */
export async function probeAudioEncode(): Promise<AudioEncodeResult> {
  const webCodecs = typeof AudioEncoder === 'function';
  const aac = await tryBitrates('aac', AAC_BITRATES);
  const opus = aac.ok ? null : await tryBitrates('opus', OPUS_BITRATES);
  return { webCodecs, aac, opus };
}

const DECODE_ENTRIES: Omit<DecodeEntry, 'supported' | 'error'>[] = [
  {
    key: 'h264-1080p',
    label: 'H.264 High, 1080p',
    codec: 'avc1.64002a',
    width: 1920,
    height: 1080,
  },
  { key: 'h264-4k', label: 'H.264 High, 4K', codec: 'avc1.640033', width: 3840, height: 2160 },
  {
    key: 'hevc-1080p',
    label: 'HEVC Main, 1080p',
    codec: 'hvc1.1.6.L123.B0',
    width: 1920,
    height: 1080,
  },
  {
    key: 'hevc-main10-4k',
    label: 'HEVC Main 10, 4K (iPhone HDR)',
    codec: 'hvc1.2.4.L153.B0',
    width: 3840,
    height: 2160,
  },
];

/** Clip decode support via VideoDecoder.isConfigSupported. Never throws. */
export async function probeDecode(): Promise<DecodeResult> {
  const webCodecs = typeof VideoDecoder === 'function';
  const entries: DecodeEntry[] = [];
  for (const entry of DECODE_ENTRIES) {
    if (!webCodecs) {
      entries.push({ ...entry, supported: false, error: 'VideoDecoder is not defined' });
      continue;
    }
    try {
      const support = await withTimeout(
        VideoDecoder.isConfigSupported({
          codec: entry.codec,
          codedWidth: entry.width,
          codedHeight: entry.height,
        }),
        DECODE_TIMEOUT_MS,
        'VideoDecoder.isConfigSupported',
      );
      entries.push({ ...entry, supported: support.supported === true, error: null });
    } catch (error) {
      entries.push({ ...entry, supported: null, error: errorMessage(error) });
    }
  }
  return { webCodecs, entries };
}

export type RenderProbeEvent =
  { kind: 'video'; result: VideoEncodeResult } | { kind: 'audio'; result: AudioEncodeResult };

/** Probe order: 720p first (the minimum), then 1080p and square. */
export const VIDEO_PROBE_ORDER: readonly RenderResolution[] = ['720p', '1080p', 'square'];

let cachedSupport: Promise<RenderSupport> | null = null;

/**
 * Real encodes at every output size plus the audio codec, cached for the page's lifetime.
 * `fresh` re-runs them (Diagnostics' Run again); `onResult` reports each probe as it ends.
 */
export function probeRenderSupport(
  options: { fresh?: boolean; onResult?: (event: RenderProbeEvent) => void } = {},
): Promise<RenderSupport> {
  if (cachedSupport && !options.fresh) return cachedSupport;
  const run = (async (): Promise<RenderSupport> => {
    const video: Partial<Record<RenderResolution, VideoEncodeResult>> = {};
    for (const resolution of VIDEO_PROBE_ORDER) {
      const result = await probeVideoEncode(resolution);
      video[resolution] = result;
      options.onResult?.({ kind: 'video', result });
    }
    const audio = await probeAudioEncode();
    options.onResult?.({ kind: 'audio', result: audio });
    return { video: video as Record<RenderResolution, VideoEncodeResult>, audio };
  })();
  cachedSupport = run;
  void run.catch(() => {
    if (cachedSupport === run) cachedSupport = null;
  });
  return run;
}

/**
 * What the render dialog (Milestone 4) should offer: available sizes, the audio codec and
 * bitrate, and plain-language notes. Uses the cached probe when Diagnostics already ran.
 */
export async function getRenderDefaults(
  options: { fresh?: boolean } = {},
): Promise<RenderDefaults> {
  return pickRenderDefaults(await probeRenderSupport(options));
}
