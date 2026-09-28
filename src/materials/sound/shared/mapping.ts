/**
 * Common sound behaviour for every sound material (SPEC 9.5), as pure functions so each
 * shared property means the same thing in every sound material:
 *
 * - pan follows the horizontal centroid, with width scaled by Dispersion;
 * - Intensity → gain (and drive, per material);
 * - Brightness → low-pass cutoff or harmonic content (Viscosity darkens);
 * - Persistence → envelope release and reverb send and decay;
 * - `upward = −flowY` (image coordinates are y-down, so upward movement is negative flowY).
 *
 * Materials choose their own ranges where the SPEC says so (e.g. Water's short glides and
 * Honey's long ones) by passing `lo`/`hi`.
 */
import { clamp, clamp01, lerp } from '../../../lib/math';
import type { SignatureFrame } from '../../../signature/types';

/** Exponential interpolation between two positive values (perceptually even steps). */
export function expLerp(a: number, b: number, t: number): number {
  return a * Math.pow(b / a, clamp01(t));
}

/** Upward movement, −1..1 (normalized). Image y points down, so up is −flowY. */
export function upwardFlow(frame: Pick<SignatureFrame, 'normalized'>): number {
  return clamp(-frame.normalized.flowY, -1, 1);
}

/**
 * Pan position (−1 left … 1 right) from the horizontal centroid (0..1). Dispersion widens
 * the field: at 0 the sound stays near the centre (±25%), at 1 it can reach the edges.
 */
export function panFromCentroid(centroidX: number, dispersion: number): number {
  const width = lerp(0.25, 1, clamp01(dispersion));
  return clamp((clamp01(centroidX) - 0.5) * 2 * width, -1, 1);
}

/**
 * Intensity → gain relative to the material's own baseline level: −15 dB at 0, 0 dB at the
 * 0.5 baseline, +9 dB at 1 (linear in dB on each side). Materials multiply their calibrated
 * level by this and follow it with a saturation stage (the "drive") that grows with
 * Intensity, so loud also means driven.
 */
export function intensityGain(intensity: number): number {
  const i = clamp01(intensity);
  const db = i < 0.5 ? lerp(-15, 0, i / 0.5) : lerp(0, 9, (i - 0.5) / 0.5);
  return Math.pow(10, db / 20);
}

/**
 * Brightness → low-pass cutoff in Hz, spanning ~700 Hz to ~18 kHz; Viscosity darkens by up
 * to about an octave and a half.
 */
export function brightnessCutoffHz(brightness: number, viscosity = 0): number {
  const bright = expLerp(700, 18000, brightness);
  return bright * Math.pow(2, -1.5 * clamp01(viscosity));
}

/** Persistence → envelope release time constant in seconds, from `lo` to `hi` (exponential). */
export function releaseSeconds(persistence: number, lo = 0.03, hi = 1.2): number {
  return expLerp(lo, hi, persistence);
}

/** Persistence → reverb send level (linear gain). */
export function reverbSendLevel(persistence: number): number {
  return lerp(0.04, 0.55, Math.pow(clamp01(persistence), 1.2));
}

/** Persistence → reverb decay (RT60), 0.4 s to 6 s. */
export function reverbDecaySeconds(persistence: number): number {
  return expLerp(0.4, 6, persistence);
}

/** Viscosity → glide (portamento) time in seconds, from `lo` to `hi` (exponential). */
export function viscosityGlideSeconds(viscosity: number, lo: number, hi: number): number {
  return expLerp(lo, hi, viscosity);
}

/** Viscosity → attack time in seconds (softer attacks with thicker material). */
export function viscosityAttackSeconds(viscosity: number, lo = 0.003, hi = 0.04): number {
  return expLerp(lo, hi, viscosity);
}

/** Dispersion → detune spread in cents between voices. */
export function dispersionDetuneCents(dispersion: number, maxCents = 24): number {
  return maxCents * Math.pow(clamp01(dispersion), 1.3);
}

/** Range → pitch range in semitones, narrow (compressed) to wide (expanded). */
export function rangeSemitones(range: number, lo = 2, hi = 24): number {
  return lerp(lo, hi, clamp01(range));
}

/** Semitones → frequency ratio. */
export function semitonesToRatio(st: number): number {
  return Math.pow(2, st / 12);
}
