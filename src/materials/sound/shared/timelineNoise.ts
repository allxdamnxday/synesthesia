/**
 * Seeded noise that starts in step with composition time (SPEC 9.1: noise comes from the
 * seeded PRNG into AudioBuffers, never from browser randomness).
 *
 * A looping noise buffer started when a material is built would put different samples at
 * the same composition time in preview and in the render, because that depends on when the
 * material was built. So the noise starts with the material's first schedule window (the
 * start of playback, or a material joining mid-playback), from the buffer position that
 * belongs to that composition time: a render and a preview played from the same point hear
 * the very same noise.
 *
 * After that it runs on continuously, through seeks, loop wraps, live edits and scheduler
 * resyncs. It deliberately does not realign on a seek or a resync: after a jump the preview
 * needn't match the render sample for sample, and a restart is one more thing that could be
 * heard. (Only a stretch where nothing is scheduled at all, after its restart was cancelled,
 * starts it again.)
 *
 * Call `sync()` from the control timeline's `begin` handler and `cancelFrom()` from the
 * material's `cancelFrom`.
 */
import type { ContinuityMode } from './controlTimeline';

/** Buffer position (seconds) that plays at composition time `t`. Pure. */
export function noiseOffset(t: number, bufferSec: number): number {
  if (!(bufferSec > 0) || !Number.isFinite(t)) return 0;
  const x = t % bufferSec;
  return x < 0 ? x + bufferSec : x;
}

/**
 * True when a window in this mode must (re)start the noise: the material's first window, or
 * whenever nothing is playing. Never on a seek or resync (see above).
 */
export function noiseRestarts(mode: ContinuityMode, playing: boolean): boolean {
  return mode === 'start' || !playing;
}

/** A stop time beyond any composition: re-arms a source whose stop was cancelled. */
const NEVER_SEC = 1e7;
/** Context-time tolerance when comparing a cancel time with a restart time. */
const EPSILON = 1e-9;

interface Segment {
  /** Context time where this source starts. */
  start: number;
  source: AudioBufferSourceNode;
}

export class TimelineNoise {
  /** The noise comes out here, with as many channels as the buffer. */
  readonly output: GainNode;
  private readonly ctx: BaseAudioContext;
  private readonly buffer: AudioBuffer;
  /** Scheduled sources, oldest first; each plays until the next one starts. */
  private segments: Segment[] = [];

  constructor(ctx: BaseAudioContext, buffer: AudioBuffer) {
    this.ctx = ctx;
    this.buffer = buffer;
    this.output = ctx.createGain();
    this.output.channelCount = buffer.numberOfChannels;
    this.output.channelCountMode = 'explicit';
    this.output.channelInterpretation = 'discrete';
  }

  /**
   * A schedule window begins at composition time `t0` (context time `ctxTimeAtT0`). On the
   * material's first window, start the noise there in step with composition time; otherwise
   * let it carry on.
   */
  sync(mode: ContinuityMode, t0: number, ctxTimeAtT0: number): void {
    if (!noiseRestarts(mode, this.segments.length > 0)) return;
    const at = Math.max(0, ctxTimeAtT0);
    const previous = this.segments[this.segments.length - 1];
    previous?.source.stop(at);
    const source = this.ctx.createBufferSource();
    source.buffer = this.buffer;
    source.loop = true;
    source.connect(this.output);
    source.start(at, noiseOffset(t0, this.buffer.duration));
    this.segments.push({ start: at, source });
    this.prune();
  }

  /** Drop restarts scheduled at or after `ctxTime`; the noise before them carries on. */
  cancelFrom(ctxTime: number): void {
    let n = this.segments.length;
    while (n > 0 && (this.segments[n - 1]?.start ?? 0) >= ctxTime - EPSILON) {
      const cut = this.segments[n - 1];
      if (cut) release(cut.source);
      n--;
    }
    if (n === this.segments.length) return;
    this.segments.length = n;
    // The newest remaining source had been told to stop where the cancelled one began.
    this.segments[n - 1]?.source.stop(NEVER_SEC);
  }

  dispose(): void {
    for (const s of this.segments) release(s.source);
    this.segments = [];
    this.output.disconnect();
  }

  /** Forget sources that finished (their successor started a while ago). */
  private prune(): void {
    const now = this.ctx.currentTime;
    while (this.segments.length > 1 && (this.segments[1]?.start ?? 0) < now - 0.1) {
      const done = this.segments.shift();
      if (done) done.source.disconnect();
    }
  }
}

function release(source: AudioBufferSourceNode): void {
  try {
    source.stop();
  } catch {
    // Already stopped.
  }
  source.disconnect();
}
