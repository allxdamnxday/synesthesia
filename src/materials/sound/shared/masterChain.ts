/**
 * Master sound chain (SPEC 9.1): material → master gain → soft limiter → mute → destination.
 *
 * The limiter is a gentle WaveShaper soft clip: exactly linear below the threshold, then a
 * tanh knee that approaches full scale. Unlike Chrome's DynamicsCompressorNode it adds no
 * automatic make-up gain and no look-ahead delay, so it is transparent at normal levels and
 * only rounds off overs. Preview and offline render use the same chain.
 */
import { RampedParam } from './automation';

export interface SoftClipOptions {
  /** Curve points (odd, so zero maps exactly to zero). Default 4097. */
  size?: number;
  /** Level where the knee starts (0–1). Default 0.8. */
  threshold?: number;
  /** Largest input handled smoothly before hard clipping, as a multiple of full scale. Default 4. */
  headroom?: number;
}

/** The soft clip transfer function for one sample (odd-symmetric, slope 1 below the threshold). */
export function softClip(x: number, threshold = 0.8): number {
  const a = Math.abs(x);
  if (a <= threshold) return x;
  const knee = 1 - threshold;
  return Math.sign(x) * (threshold + knee * Math.tanh((a - threshold) / knee));
}

/**
 * WaveShaper curve for `softClip`. The WaveShaper maps input −1..1 across the curve, so the
 * chain divides the signal by `headroom` first and the curve multiplies it back.
 */
export function softClipCurve(options: SoftClipOptions = {}): Float32Array<ArrayBuffer> {
  const size = Math.max(3, (options.size ?? 4097) | 1);
  const threshold = options.threshold ?? 0.8;
  const headroom = options.headroom ?? 4;
  const curve = new Float32Array(size);
  const half = (size - 1) / 2;
  for (let i = 0; i < size; i++) curve[i] = softClip(((i - half) / half) * headroom, threshold);
  return curve;
}

export interface MasterChain {
  /** Connect materials (or the engine's transport fade) here. */
  readonly input: GainNode;
  readonly output: GainNode;
  /** Change the master gain with a short fade. */
  setGain(gain: number, atTime: number, rampSec?: number): void;
  /** Mute or unmute with a short fade (for mute/solo in Studio). */
  setMuted(muted: boolean, atTime: number, rampSec?: number): void;
  dispose(): void;
}

export interface MasterChainOptions {
  /** Master gain. Default 0.9. */
  gain?: number;
  softClip?: SoftClipOptions;
}

export const DEFAULT_MASTER_GAIN = 0.9;

export function createMasterChain(
  ctx: BaseAudioContext,
  destination: AudioNode,
  options: MasterChainOptions = {},
): MasterChain {
  const headroom = options.softClip?.headroom ?? 4;
  const input = ctx.createGain();
  const inputGain = new RampedParam(input.gain, options.gain ?? DEFAULT_MASTER_GAIN);
  const pre = ctx.createGain();
  pre.gain.value = 1 / headroom;
  const shaper = ctx.createWaveShaper();
  shaper.curve = softClipCurve({ ...options.softClip, headroom });
  shaper.oversample = 'none';
  const mute = ctx.createGain();
  const muteGain = new RampedParam(mute.gain, 1);
  input.connect(pre);
  pre.connect(shaper);
  shaper.connect(mute);
  mute.connect(destination);

  return {
    input,
    output: mute,
    setGain(gain, atTime, rampSec = 0.02) {
      inputGain.rampTo(gain, atTime, rampSec);
    },
    setMuted(muted, atTime, rampSec = 0.015) {
      muteGain.rampTo(muted ? 0 : 1, atTime, rampSec);
    },
    dispose() {
      input.disconnect();
      pre.disconnect();
      shaper.disconnect();
      mute.disconnect();
    },
  };
}
