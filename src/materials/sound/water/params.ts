/**
 * A1 Water: property values → synthesis parameters. Pure (unit-tested); the mapping table
 * for docs/MATERIALS.md is the comment on `deriveWaterParams`.
 */
import { createRng, hash32 } from '../../../chance/prng';
import { lerp, smoothstep } from '../../../lib/math';
import { readProperty } from '../../properties';
import type { PropertyDef, PropertyValues } from '../../types';
import {
  brightnessCutoffHz,
  dispersionDetuneCents,
  expLerp,
  intensityGain,
  rangeSemitones,
  releaseSeconds,
  reverbDecaySeconds,
  reverbSendLevel,
  viscosityAttackSeconds,
  viscosityGlideSeconds,
} from '../shared/mapping';
import { WATER_PROPERTIES } from './meta';

/** Base pitch of each register, Hz (A3, A4, A5). */
export const REGISTER_HZ = [220, 440, 880] as const;
/**
 * FM modulator : carrier ratio. 3 puts sidebands on harmonics 2, 4, 5, 7, … and never on the
 * fundamental or DC, so the pitch stays clear as brightness rises (1:2 folds a sideband
 * onto the fundamental and hollows it out; 1:1 creates DC).
 */
export const MOD_RATIO = 3;
export const VOICE_COUNT = 3;
/** Voice level at baseline Intensity: strong gestures peak around −6 dBFS. */
export const WATER_LEVEL = 0.33;

/** Small seed-dependent differences, so each seed has its own subtly different voice. */
export interface WaterVariation {
  /** Vibrato rate multiplier, ~0.9–1.1. */
  vibRate: number;
  /** Flutter ("Br") rate in Hz, ~24–29. */
  flutterHz: number;
  /** Per-voice detune offsets in cents, ±1.5. */
  detune: [number, number, number];
}

const VARIATION_SALT = 0x57415452; // "WATR"

export function waterVariation(seed: number): WaterVariation {
  const rng = createRng(hash32(seed, VARIATION_SALT));
  return {
    vibRate: 0.9 + 0.2 * rng(),
    flutterHz: 24 + 5 * rng(),
    detune: [3 * rng() - 1.5, 3 * rng() - 1.5, 3 * rng() - 1.5],
  };
}

export interface WaterParams {
  baseHz: number;
  /** FM deviation (Hz at the base pitch) per unit of modulation index. */
  devScale: number;
  // Pitch
  rangeSt: number;
  glideSec: number;
  glideQ: number;
  /** 0 = free glide, 1 = snapped to the scale. */
  quantize: number;
  vibMaxSt: number;
  vibDecaySec: number;
  vibRateHz: number;
  // Loudness
  level: number;
  attackSec: number;
  releaseSec: number;
  // Brightness
  indexBase: number;
  kickIndex: number;
  flutterMax: number;
  flutterHz: number;
  // Space
  dispersion: number;
  panGlideSec: number;
  // Per-voice (static while properties are unchanged)
  voiceLevels: [number, number, number];
  voiceDetune: [number, number, number];
  voicePan: [number, number, number];
  // Output stage
  cutoffHz: number;
  drive: number;
  reverbSend: number;
  reverbDecaySec: number;
  dry: number;
  // Droplets (onsets)
  dropletLevel: number;
  dropletRiseSt: number;
  dropletRiseSec: number;
  dropletDecaySec: number;
}

function def(id: string): PropertyDef {
  const found = WATER_PROPERTIES.find((p) => p.id === id);
  if (!found) throw new Error(`Water has no property "${id}".`);
  return found;
}

const P = {
  viscosity: def('viscosity'),
  elasticity: def('elasticity'),
  persistence: def('persistence'),
  dispersion: def('dispersion'),
  brightness: def('brightness'),
  intensity: def('intensity'),
  range: def('range'),
  density: def('density'),
  rigidity: def('rigidity'),
  register: def('register'),
};

/** Property ids that shape Water, in a fixed order (for change detection). */
export const WATER_PROPERTY_IDS = Object.keys(P) as (keyof typeof P)[];

/**
 * Mapping (shared vocabulary → sound), SPEC 9.5 A1 plus the common behaviour:
 *
 * | Property | Water |
 * |---|---|
 * | Viscosity | glide 12–160 ms; attack 2–30 ms; darker (low-pass down 1.5 octaves, FM index −30%); slower droplets |
 * | Elasticity | glide overshoot (resonant glide, Q 0.5–2.5); vibrato on jolts up to ±0.9 st |
 * | Persistence | release 25–700 ms; reverb send and decay 0.4–6 s; longer droplets |
 * | Dispersion | voices detuned up to ±24 cents and spread in stereo; pan follows the movement's position more widely |
 * | Brightness | FM index 0.15–2.75; onset buzz; low-pass cutoff |
 * | Intensity | level −15 / 0 / +9 dB at 0 / 0.5 / 1, and drive (soft saturation) |
 * | Range | pitch travel 2–24 semitones |
 * | Density | one to three voices; droplet level |
 * | Rigidity | pitch snaps to a pentatonic scale; sharper attack, shorter release |
 * | Register | base pitch A3 / A4 / A5 |
 */
export function deriveWaterParams(props: PropertyValues, variation: WaterVariation): WaterParams {
  const v = readProperty(props, P.viscosity);
  const e = readProperty(props, P.elasticity);
  const p = readProperty(props, P.persistence);
  const d = readProperty(props, P.dispersion);
  const b = readProperty(props, P.brightness);
  const i = readProperty(props, P.intensity);
  const r = readProperty(props, P.range);
  const n = readProperty(props, P.density);
  const g = readProperty(props, P.rigidity);
  const register = readProperty(props, P.register);

  const baseHz = REGISTER_HZ[register] ?? REGISTER_HZ[1];
  const sharpen = lerp(1, 0.4, g);

  // Extra voices fade in with Density: a faint second voice at baseline (a gentle shimmer
  // rather than a deep beating tremolo), three full voices at the top.
  const l1 = 0.8 * smoothstep(0.2, 0.8, n);
  const l2 = 0.65 * smoothstep(0.55, 1, n);
  const norm = 1 / Math.sqrt(1 + l1 * l1 + l2 * l2);
  const detune = dispersionDetuneCents(d, 24);
  const spread = 0.75 * Math.pow(d, 1.2);
  const send = reverbSendLevel(p);

  return {
    baseHz,
    devScale: baseHz * MOD_RATIO,
    rangeSt: rangeSemitones(r, 2, 24),
    glideSec: viscosityGlideSeconds(v, 0.012, 0.16),
    glideQ: 0.5 + 2 * e * e,
    quantize: smoothstep(0.05, 0.7, g),
    vibMaxSt: 0.9 * e,
    vibDecaySec: 0.12 + 0.5 * e,
    vibRateHz: (5.5 + 2.5 * e) * variation.vibRate,
    level: WATER_LEVEL * intensityGain(i),
    attackSec: viscosityAttackSeconds(v, 0.002, 0.03) * sharpen,
    releaseSec: releaseSeconds(p, 0.025, 0.7) * lerp(1, 0.6, g),
    indexBase: (0.15 + 2.6 * Math.pow(b, 1.4)) * lerp(1, 0.7, v),
    kickIndex: 1.4 * (0.3 + b),
    flutterMax: 0.12 + 0.3 * b,
    flutterHz: variation.flutterHz,
    dispersion: d,
    panGlideSec: 0.06,
    voiceLevels: [norm, l1 * norm, l2 * norm],
    voiceDetune: [
      variation.detune[0],
      detune + variation.detune[1],
      -0.8 * detune + variation.detune[2],
    ],
    voicePan: [0, spread, -spread],
    cutoffHz: Math.min(20000, 1.5 * brightnessCutoffHz(b, v)),
    drive: lerp(0.25, 3, Math.pow(i, 2.5)),
    reverbSend: send,
    reverbDecaySec: reverbDecaySeconds(p),
    dry: 1 - 0.35 * send,
    dropletLevel: 0.2 + 0.4 * n,
    dropletRiseSt: lerp(12, 5, v),
    dropletRiseSec: expLerp(0.02, 0.07, v),
    dropletDecaySec: expLerp(0.02, 0.09, p),
  };
}

/** True when every property Water reads has the same value in both sets. */
export function sameWaterProps(a: PropertyValues, b: PropertyValues): boolean {
  for (const id of WATER_PROPERTY_IDS) if (a[id] !== b[id]) return false;
  return true;
}

/** Nearest note of the major pentatonic scale (0, 2, 4, 7, 9 semitones per octave). */
export function quantizePentatonic(semitones: number): number {
  const octave = Math.floor(semitones / 12);
  const within = semitones - octave * 12;
  let best = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const degree of [0, 2, 4, 7, 9, 12]) {
    const dist = Math.abs(within - degree);
    if (dist < bestDist) {
      best = degree;
      bestDist = dist;
    }
  }
  return octave * 12 + best;
}
