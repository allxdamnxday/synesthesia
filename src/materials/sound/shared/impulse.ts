/**
 * Procedural reverb impulse responses (SPEC 9.1, "Reverb"): seeded noise × exponential
 * decay, one independent noise stream per channel (decorrelated stereo), with high
 * frequencies dying away faster than lows the way they do in real rooms and water.
 * No external IR files. Pure: the same options always give the same samples.
 */
import { createRng, hash32 } from '../../../chance/prng';

export interface ImpulseOptions {
  sampleRate: number;
  /** RT60: seconds for the tail to fall by 60 dB. */
  decaySec: number;
  seed: number;
  /** Default 2. */
  channels?: number;
  /** Silence before the tail starts, in seconds. Default 0.012. */
  preDelaySec?: number;
  /** 0–1: how much darker the tail becomes as it decays. Default 0.5. */
  damping?: number;
}

/** −60 dB expressed as a natural-log amplitude ratio: ln(1000). */
const LN_1000 = Math.log(1000);
/** Fade-in at the start of the tail, so transients don't crack. */
const FADE_IN_SEC = 0.004;
/** Salt that separates reverb noise from every other use of the material seed. */
const REVERB_SALT = 0x52455642; // "REVB"

/** Length in samples of an impulse response with these options. */
export function impulseLength(opts: ImpulseOptions): number {
  const pre = opts.preDelaySec ?? 0.012;
  return Math.max(1, Math.ceil((pre + Math.max(0.05, opts.decaySec)) * opts.sampleRate));
}

/**
 * Generate the impulse response, one Float32Array per channel. Each channel is scaled to
 * unit energy (sum of squares = 1) so the reverb level is set by the send, not the decay.
 */
export function generateImpulseResponse(opts: ImpulseOptions): Float32Array<ArrayBuffer>[] {
  const sr = opts.sampleRate;
  const decay = Math.max(0.05, opts.decaySec);
  const channels = Math.max(1, Math.round(opts.channels ?? 2));
  const damping = Math.min(1, Math.max(0, opts.damping ?? 0.5));
  const length = impulseLength(opts);
  const pre = Math.min(length, Math.round((opts.preDelaySec ?? 0.012) * sr));
  const fadeIn = Math.max(1, Math.round(FADE_IN_SEC * sr));
  // Amplitude falls by 60 dB over `decay` seconds.
  const step = Math.exp(-LN_1000 / (decay * sr));
  // The tail's low-pass cutoff glides from bright to (damping-dependent) dark.
  const nyquist = sr / 2;
  const fHigh = Math.min(16000, nyquist * 0.9);
  const fLow = Math.min(fHigh, 16000 * Math.pow(2, -5 * damping));
  const block = 64;

  const out: Float32Array<ArrayBuffer>[] = [];
  for (let c = 0; c < channels; c++) {
    const rng = createRng(hash32(opts.seed, REVERB_SALT, c));
    const data = new Float32Array(length);
    let env = 1;
    let lp = 0;
    let coeff = 1;
    let energy = 0;
    for (let i = pre; i < length; i++) {
      const j = i - pre;
      if (j % block === 0) {
        const x = Math.min(1, j / sr / decay);
        const fc = fHigh * Math.pow(fLow / fHigh, x);
        coeff = 1 - Math.exp((-2 * Math.PI * fc) / sr);
      }
      const noise = rng() * 2 - 1;
      lp += coeff * (noise - lp);
      const fade = j < fadeIn ? 0.5 - 0.5 * Math.cos((Math.PI * j) / fadeIn) : 1;
      const v = lp * env * fade;
      data[i] = v;
      energy += v * v;
      env *= step;
    }
    const scale = energy > 0 ? 1 / Math.sqrt(energy) : 0;
    for (let i = pre; i < length; i++) data[i] = (data[i] ?? 0) * scale;
    out.push(data);
  }
  return out;
}
