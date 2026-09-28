/**
 * Seeded noise (SPEC 9.1: "Noise is generated from the seeded PRNG into AudioBuffers, never
 * from browser randomness"). The fill functions are pure; `createNoiseBuffer` wraps them in
 * an AudioBuffer with one independent (decorrelated) stream per channel.
 */
import { createRng, hash32, type Rng } from '../../../chance/prng';

export type NoiseColor = 'white' | 'pink';

/** Salt that separates noise buffers from every other use of a material seed. */
const NOISE_SALT = 0x4e4f4953; // "NOIS"

/** Uniform white noise in [−1, 1). Returns `out`. */
export function fillWhiteNoise<T extends Float32Array>(out: T, rng: Rng): T {
  for (let i = 0; i < out.length; i++) out[i] = rng() * 2 - 1;
  return out;
}

/**
 * Pink (1/f) noise: Paul Kellet's refined filter over white noise, scaled so peaks stay
 * roughly within ±1. Returns `out`.
 */
export function fillPinkNoise<T extends Float32Array>(out: T, rng: Rng): T {
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  for (let i = 0; i < out.length; i++) {
    const white = rng() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
    b6 = white * 0.115926;
    out[i] = pink * 0.11;
  }
  return out;
}

export interface NoiseBufferOptions {
  seed: number;
  seconds: number;
  color?: NoiseColor;
  /** Default 1. Each channel gets its own stream. */
  channels?: number;
  /** Distinguishes several buffers made from one seed. Default 0. */
  stream?: number;
}

/** Noise samples for one channel of a buffer (pure; used by `createNoiseBuffer`). */
export function noiseChannel(
  length: number,
  opts: Pick<NoiseBufferOptions, 'seed' | 'color' | 'stream'>,
  channel: number,
): Float32Array<ArrayBuffer> {
  const rng = createRng(hash32(opts.seed, NOISE_SALT, opts.stream ?? 0, channel));
  const out = new Float32Array(length);
  return opts.color === 'pink' ? fillPinkNoise(out, rng) : fillWhiteNoise(out, rng);
}

/** A seeded noise AudioBuffer, e.g. for a looping AudioBufferSourceNode. */
export function createNoiseBuffer(ctx: BaseAudioContext, opts: NoiseBufferOptions): AudioBuffer {
  const channels = Math.max(1, Math.round(opts.channels ?? 1));
  const length = Math.max(1, Math.round(opts.seconds * ctx.sampleRate));
  const buffer = ctx.createBuffer(channels, length, ctx.sampleRate);
  for (let c = 0; c < channels; c++) buffer.copyToChannel(noiseChannel(length, opts, c), c);
  return buffer;
}
