/**
 * A2 Honey: property values → synthesis parameters. Pure (unit-tested); the mapping table
 * for docs/MATERIALS.md is the comment on `deriveHoneyParams`.
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
import { HONEY_PROPERTIES } from './meta';

/** Base pitch: A2, two octaves below Water's middle register. */
export const HONEY_BASE_HZ = 110;
export const VOICE_COUNT = 4;
/**
 * Each stacked voice's frequency relative to the base: the hum, an octave above, a fifth
 * above, an octave below. Stacked on harmonics rather than in unison: at 110 Hz, unison
 * voices a few cents apart beat slowly (about once every two seconds), a loudness swell as
 * large as the movement's own that would blur its timing.
 */
export const VOICE_RATIOS = [1, 2, 1.5, 0.5] as const;
/**
 * Voice level at baseline Intensity: a wink sounds about as loud as A1 Water (its RMS sits a
 * little higher, since a low hum sounds quieter than a whistle at the same level).
 */
export const HONEY_LEVEL = 0.55;
/**
 * Honey's filter sits well below the shared brightness range (SPEC 9.2 keeps the meaning:
 * the same octaves per unit of Brightness, the same darkening from Viscosity), so the
 * baseline is a dark "oo" hum and the top is a buzz rather than a hiss.
 */
export const HONEY_CUTOFF_SCALE = 0.28;
/** The second low-pass sits this far above the resonant one (keeps the resonant peak). */
export const SECOND_POLE_RATIO = 1.5;

/** Small seed-dependent differences, so each seed has its own subtly different honey. */
export interface HoneyVariation {
  /** Stutter rate multiplier, ~0.92–1.08. */
  rate: number;
  /** Stutter phase at composition time 0 (0–1). */
  phase: number;
  /** Pitch offset of the whole hum in cents, ±6. */
  tuneCents: number;
}

const VARIATION_SALT = 0x484f4e59; // "HONY"

export function honeyVariation(seed: number): HoneyVariation {
  const rng = createRng(hash32(seed, VARIATION_SALT));
  return {
    rate: 0.92 + 0.16 * rng(),
    phase: rng(),
    tuneCents: 12 * rng() - 6,
  };
}

type Four = [number, number, number, number];

export interface HoneyParams {
  baseHz: number;
  // Pitch
  rangeSt: number;
  glideSec: number;
  glideQ: number;
  // The honey's own motion (a slewed follower of the movement's energy)
  flowRiseSec: number;
  flowFallSec: number;
  // Loudness
  level: number;
  attackSec: number;
  releaseSec: number;
  // Stutter
  stutterDepth: number;
  rateLoHz: number;
  rateHiHz: number;
  // Tone
  cutoffHz: number;
  resonance: number;
  /** Octaves the filter opens at full flow. */
  openOct: number;
  sawMix: number;
  triMix: number;
  // Space
  dispersion: number;
  panGlideSec: number;
  // Per-voice (static while properties are unchanged)
  voiceLevels: Four;
  voiceDetune: Four;
  voicePan: Four;
  // Output stage
  drive: number;
  reverbSend: number;
  reverbDecaySec: number;
  dry: number;
}

function def(id: string): PropertyDef {
  const found = HONEY_PROPERTIES.find((p) => p.id === id);
  if (!found) throw new Error(`Honey has no property "${id}".`);
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
  stutterDepth: def('stutterDepth'),
};

/** Property ids that shape Honey, in a fixed order (for change detection). */
export const HONEY_PROPERTY_IDS = Object.keys(P) as (keyof typeof P)[];

/** Stutter depth property (0–1) → how far the level dips between syllables (0–1). */
export function stutterDepthAmount(value: number): number {
  return 1 - Math.pow(1 - Math.min(1, Math.max(0, value)), 1.7);
}

/**
 * Mapping (shared vocabulary → sound), SPEC 9.5 A2 plus the common behaviour:
 *
 * | Property | Honey |
 * |---|---|
 * | Viscosity | pitch glide 0.12–1.5 s; the honey keeps moving after the push (settles in 0.15–2 s); attack 10–200 ms; darker (low-pass down 1.5 octaves); slower stutter (×1.3 to ×0.7) |
 * | Elasticity | filter resonance (Q 0.7–8.7): a vowel-like ring; glide overshoot (Q 0.5–1.8) |
 * | Persistence | release 20–700 ms; reverb send and decay 0.4–6 s |
 * | Dispersion | stacked voices spread in stereo, and above 0.5 detuned up to ±22 cents; pan follows the movement's position more widely |
 * | Brightness | low-pass cutoff (about 120 Hz–3 kHz at the baseline viscosity) and saw/triangle mix; the filter opens further with movement |
 * | Intensity | level −15 / 0 / +9 dB at 0 / 0.5 / 1, and drive (soft saturation) |
 * | Range | pitch travel 2–14 semitones, which also sets the depth of the fall ("oot") |
 * | Density | one to four stacked voices: the hum, an octave above, a fifth above, an octave below |
 * | Stutter depth | how far the level dips between "roo" syllables (0–100%), plus the filter's "wah" and the pitch scoop per syllable |
 */
export function deriveHoneyParams(props: PropertyValues, variation: HoneyVariation): HoneyParams {
  const v = readProperty(props, P.viscosity);
  const e = readProperty(props, P.elasticity);
  const p = readProperty(props, P.persistence);
  const d = readProperty(props, P.dispersion);
  const b = readProperty(props, P.brightness);
  const i = readProperty(props, P.intensity);
  const r = readProperty(props, P.range);
  const n = readProperty(props, P.density);
  const s = readProperty(props, P.stutterDepth);

  // Extra voices fade in with Density: the octave above at baseline, then the fifth, then
  // the octave below.
  const l1 = 0.55 * smoothstep(0.2, 0.6, n);
  const l2 = 0.5 * smoothstep(0.45, 0.85, n);
  const l3 = 0.6 * smoothstep(0.7, 1, n);
  const norm = 1 / Math.sqrt(1 + l1 * l1 + l2 * l2 + l3 * l3);
  // Dispersion first spreads the voices in stereo; above its baseline it also pulls them
  // out of tune with each other (a slow, thick chorus).
  const detune = dispersionDetuneCents(smoothstep(0.5, 1, d), 22);
  const spread = 0.7 * Math.pow(d, 1.2);
  const send = reverbSendLevel(p);
  // Thicker honey stutters more slowly.
  const rateScale = lerp(1.3, 0.7, v) * variation.rate;
  const saw = lerp(0.15, 0.85, b);

  return {
    baseHz: HONEY_BASE_HZ,
    rangeSt: rangeSemitones(r, 2, 14),
    glideSec: viscosityGlideSeconds(v, 0.12, 1.5),
    glideQ: 0.5 + 1.3 * e * e,
    flowRiseSec: expLerp(0.03, 0.3, v),
    flowFallSec: expLerp(0.15, 2, v),
    level: HONEY_LEVEL * intensityGain(i),
    attackSec: viscosityAttackSeconds(v, 0.01, 0.2),
    releaseSec: releaseSeconds(p, 0.02, 0.7),
    stutterDepth: stutterDepthAmount(s),
    rateLoHz: 2 * rateScale,
    rateHiHz: 7 * rateScale,
    cutoffHz: HONEY_CUTOFF_SCALE * brightnessCutoffHz(b, v),
    resonance: 0.7 + 8 * Math.pow(e, 1.5),
    openOct: 0.9 + 0.6 * b,
    sawMix: saw,
    triMix: 1 - saw,
    dispersion: d,
    panGlideSec: 0.15,
    voiceLevels: [norm, l1 * norm, l2 * norm, l3 * norm],
    voiceDetune: [
      variation.tuneCents,
      variation.tuneCents + detune,
      variation.tuneCents - 0.8 * detune,
      variation.tuneCents + 0.5 * detune,
    ],
    voicePan: [0, spread, -spread, 0],
    drive: lerp(0.3, 3.2, Math.pow(i, 2.5)),
    reverbSend: send,
    reverbDecaySec: reverbDecaySeconds(p),
    dry: 1 - 0.35 * send,
  };
}

/** True when every property Honey reads has the same value in both sets. */
export function sameHoneyProps(a: PropertyValues, b: PropertyValues): boolean {
  for (const id of HONEY_PROPERTY_IDS) if (a[id] !== b[id]) return false;
  return true;
}
