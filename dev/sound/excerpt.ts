/**
 * An excerpt of a signature as its own signature: plays [start, end) of one pass of a base
 * sampler. Used to put a loop boundary in the middle of a movement, where a click would
 * show if a material's state weren't continuous. Harness-only; 'loop' mode only.
 */
import {
  DEFAULT_SAMPLER_CONFIG,
  type SamplerConfig,
  type SignatureFrame,
  type SignatureSampler,
} from '../../src/signature/types';

export function excerptSampler(
  base: SignatureSampler,
  start: number,
  end: number,
): SignatureSampler {
  const signatureDuration = Math.max(0.05, end - start);
  let config: SamplerConfig = { ...DEFAULT_SAMPLER_CONFIG };
  // The base plays one pass at speed 1 with a long tail; strength and smoothing pass through.
  const syncBase = (): void => {
    base.configure({
      speed: 1,
      loops: 1,
      tailSec: 10,
      loopMode: 'loop',
      smoothing: config.smoothing,
      strength: config.strength,
    });
  };
  syncBase();
  const speed = (): number => Math.max(0.25, config.speed);
  const pass = (): number => signatureDuration / speed();
  const loops = (): number => Math.max(1, config.loops);
  const movement = (): number => pass() * loops();

  return {
    get duration() {
      return movement() + Math.max(0, config.tailSec);
    },
    signatureDuration,
    get config() {
      return config;
    },
    configure(opts) {
      config = { ...config, ...opts, loopMode: 'loop' };
      syncBase();
    },
    sample(t): SignatureFrame {
      let frame: SignatureFrame;
      if (t >= movement() || t < 0) {
        frame = base.sample(base.duration + 1);
        frame.inTail = t >= movement();
      } else {
        const index = Math.min(Math.floor(t / pass()), loops() - 1);
        const local = (t - index * pass()) * speed();
        frame = base.sample(start + Math.min(signatureDuration, Math.max(0, local)));
      }
      frame.t = t;
      return frame;
    },
    onsetsBetween(t0, t1) {
      const result: number[] = [];
      const onsets = base.onsetsBetween(start, end);
      for (let index = 0; index < loops(); index++) {
        for (const onset of onsets) {
          const t = index * pass() + (onset - start) / speed();
          if (t >= t0 && t < t1 && t < movement()) result.push(t);
        }
      }
      return result.sort((a, b) => a - b);
    },
  };
}
