/**
 * How a composition's timeline configures a signature sampler. The render uses this for
 * both of its samplers (sound and picture); the Studio preview should configure its
 * sampler the same way so preview and render agree (SPEC 7.5, 8.4).
 */
import { timelineDuration, type TimelineSettings } from '../engine/composition';
import { createSampler } from '../signature/sampler';
import type { KineticSignature, SamplerConfig, SignatureSampler } from '../signature/types';

export function samplerConfigFor(timeline: TimelineSettings): SamplerConfig {
  return {
    speed: timeline.speed,
    loops: timeline.loops,
    tailSec: timeline.tailSec,
    loopMode: timeline.loopMode,
    smoothing: timeline.smoothing,
    strength: timeline.signatureStrength,
  };
}

/** A fresh sampler for a signature, configured from a composition's timeline. */
export function createTimelineSampler(
  signature: KineticSignature,
  timeline: TimelineSettings,
): SignatureSampler {
  return createSampler(signature, samplerConfigFor(timeline));
}

/** One pass of the signature at speed 1, in seconds. */
export function signatureDurationOf(
  signature: Pick<KineticSignature, 'frameCount' | 'frameRate'>,
): number {
  return signature.frameRate > 0 ? signature.frameCount / signature.frameRate : 0;
}

/** The composition's full timeline (loops and tail included), in seconds. */
export function compositionDuration(
  signature: Pick<KineticSignature, 'frameCount' | 'frameRate'>,
  timeline: TimelineSettings,
): number {
  return timelineDuration(signatureDurationOf(signature), timeline);
}
