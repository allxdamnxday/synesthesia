/**
 * Frame and sample arithmetic for the offline render (SPEC 7.5, 10.2). Pure.
 *
 * - A render of a timeline lasting `d` seconds has N = ceil(d × fps) frames; frame i shows
 *   composition time i / fps and lasts 1 / fps.
 * - The sound covers exactly the same span as the frames, N / fps seconds, so both tracks
 *   end together. That is at most one frame longer than the timeline; the sound simply
 *   keeps settling (the tail) for those few milliseconds.
 * - The muxer reserves room for its index at the start of the file (fast start while
 *   streaming to disk), so it needs upper bounds on the packet counts.
 */
export const RENDER_SAMPLE_RATE = 48_000;
export const RENDER_CHANNELS = 2;

/** Durations are rounded to this before counting frames, so float noise can't add a frame. */
const TIME_EPSILON = 1e-6;

/** Frames needed to show a timeline of `durationSec` at `fps` (at least 1). */
export function renderFrameCount(durationSec: number, fps: number): number {
  if (!(fps > 0)) throw new Error(`Frame rate ${fps} is not positive`);
  const d = Number.isFinite(durationSec) ? Math.max(0, durationSec) : 0;
  return Math.max(1, Math.ceil(d * fps - TIME_EPSILON));
}

/** Presentation time of frame i, in seconds. */
export function frameTime(index: number, fps: number): number {
  return index / fps;
}

/** How long one frame lasts, in seconds. */
export function frameDuration(fps: number): number {
  return 1 / fps;
}

/** Audio samples that cover `frameCount` frames exactly. */
export function audioSampleCount(
  frameCount: number,
  fps: number,
  sampleRate: number = RENDER_SAMPLE_RATE,
): number {
  return Math.round((frameCount * sampleRate) / fps);
}

/** Packets the video track may hold: one per frame, plus a little room. */
export function maxVideoPackets(frameCount: number): number {
  return frameCount + 8;
}

/**
 * Packets the audio track may hold. Mediabunny's guidance: assume each packet is 10 ms or
 * 512 samples, whichever is shorter, plus about a third for safety. AAC packets hold 1024
 * samples and Opus 960, so this is roughly three times what is needed; each spare packet
 * costs about 35 bytes of reserved space.
 */
export function maxAudioPackets(
  sampleCount: number,
  sampleRate: number = RENDER_SAMPLE_RATE,
): number {
  const perPacket = Math.max(1, Math.min(512, Math.floor(sampleRate / 100)));
  return Math.ceil((Math.ceil(sampleCount / perPacket) * 4) / 3) + 16;
}

/**
 * How far the sound should have been handed to the encoder before frame `index` is added:
 * `leadSec` ahead of the frame, in whole `chunkSamples` pieces, never past `totalSamples`.
 * Feeding the sound alongside the frames keeps the file interleaved as it streams to disk.
 */
export function audioFeedTarget(
  index: number,
  fps: number,
  totalSamples: number,
  options: { sampleRate?: number; leadSec?: number; chunkSamples?: number } = {},
): number {
  const sampleRate = options.sampleRate ?? RENDER_SAMPLE_RATE;
  const lead = options.leadSec ?? 1;
  const chunk = Math.max(1, options.chunkSamples ?? sampleRate);
  const wanted = Math.ceil(((index / fps + lead) * sampleRate) / chunk) * chunk;
  return Math.min(totalSamples, Math.max(0, wanted));
}
