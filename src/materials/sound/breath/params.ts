/**
 * A3 Breath: property values → synthesis parameters. Pure (unit-tested); the mapping table
 * for docs/MATERIALS.md is the comment on `deriveBreathParams`.
 */
import { createRng, hash32 } from '../../../chance/prng';
import { lerp, smoothstep } from '../../../lib/math';
import { readProperty } from '../../properties';
import type { PropertyDef, PropertyValues } from '../../types';
import {
  expLerp,
  intensityGain,
  rangeSemitones,
  releaseSeconds,
  reverbDecaySeconds,
  reverbSendLevel,
  viscosityAttackSeconds,
  viscosityGlideSeconds,
} from '../shared/mapping';
import { BREATH_PROPERTIES } from './meta';

/**
 * Level at baseline Intensity. Calibrated so a wink sounds about as loud as A1 Water (its RMS
 * sits a few dB lower: a band of noise sounds louder than a tone at the same level). The
 * noise loses most of its power in the band-pass, hence the large number.
 */
export const BREATH_LEVEL = 2.4;
/** Seconds of seeded noise in the looping buffer (two decorrelated channels). */
export const NOISE_SECONDS = 5;

/**
 * The bands of air, in the order the graph builds them: the main band, a chest layer an
 * octave below, a hiss 1.5 octaves above, a narrow whistle at the main band's centre, and
 * three vowel formants.
 */
export const BAND_COUNT = 7;
export const AIR = 0;
export const CHEST = 1;
export const HISS = 2;
export const WHISTLE = 3;
export const FORMANT_1 = 4;
/** Centre of each layer relative to the main band. */
export const CHEST_RATIO = 0.5;
export const HISS_RATIO = 2.83;
/** Q of the whistle band (Elasticity's top end): narrow enough to be heard as a tone. */
export const WHISTLE_Q = 60;

/** How far the whistle has risen out of the air, 0–1, for an Elasticity (0 below 0.5). */
export function whistleAmount(elasticity: number): number {
  return smoothstep(0.5, 0.95, elasticity);
}
/** Reference Q for loudness compensation (bands are levelled against one this wide). */
const Q_REF = 1.5;

/** Whispered vowel formants: centre (Hz), level (dB) and Q, for "ah" and "oo". */
export const FORMANTS: Readonly<
  Record<1 | 2, { hz: readonly number[]; db: readonly number[]; q: readonly number[] }>
> = {
  1: { hz: [730, 1090, 2440], db: [0, -4, -14], q: [6, 8, 12] },
  2: { hz: [300, 870, 2240], db: [0, -10, -25], q: [5, 7, 10] },
};

/** Small seed-dependent differences, so each seed breathes a little differently. */
export interface BreathVariation {
  /** Main band centre multiplier, ~0.94–1.06. */
  center: number;
  /** Pan offset of the two air streams' shared centre, ±0.05. */
  pan: number;
}

const VARIATION_SALT = 0x42524541; // "BREA"

export function breathVariation(seed: number): BreathVariation {
  const rng = createRng(hash32(seed, VARIATION_SALT));
  return { center: 0.94 + 0.12 * rng(), pan: 0.1 * rng() - 0.05 };
}

type Bands = [number, number, number, number, number, number, number];

export interface BreathParams {
  /** Main band centre at rest, Hz. */
  centerHz: number;
  // How the band moves
  rangeSt: number;
  shiftGlideSec: number;
  shiftGlideQ: number;
  /** Seconds over which the shape of the movement (height, spread, divergence) is followed. */
  followSec: number;
  // Band width
  dispersion: number;
  // Loudness
  level: number;
  attackSec: number;
  releaseSec: number;
  // Per band (static while properties are unchanged)
  bandHz: Bands;
  /** Base Q; the air layers and formants are scaled by the program's bandwidth. */
  bandQ: Bands;
  bandGain: Bands;
  // Space
  /** Pan offset of each of the two decorrelated air streams (±width). */
  width: number;
  panOffset: number;
  panGlideSec: number;
  // Output stage
  drive: number;
  reverbSend: number;
  reverbDecaySec: number;
  dry: number;
}

function def(id: string): PropertyDef {
  const found = BREATH_PROPERTIES.find((p) => p.id === id);
  if (!found) throw new Error(`Breath has no property "${id}".`);
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
  formant: def('formant'),
};

/** Property ids that shape Breath, in a fixed order (for change detection). */
export const BREATH_PROPERTY_IDS = Object.keys(P) as (keyof typeof P)[];

/** Width in octaves of a band-pass with this Q (the RBJ definition). */
export function bandOctaves(q: number): number {
  return (2 / Math.LN2) * Math.asinh(1 / (2 * Math.max(1e-3, q)));
}

/**
 * Gain that levels a band of pink noise against one of Q_REF. Pink noise carries the same
 * power in every octave, so the power through a band follows its width in octaves.
 */
export function bandCompensation(q: number): number {
  return Math.sqrt(bandOctaves(Q_REF) / bandOctaves(q));
}

/** Main band centre at rest: Brightness raises it (500 Hz–5 kHz), Viscosity darkens it. */
export function breathCenterHz(brightness: number, viscosity: number): number {
  return expLerp(500, 5000, brightness) * Math.pow(2, -viscosity);
}

const BASELINE_CENTER_HZ = breathCenterHz(0.5, 0.5);

/**
 * Mapping (shared vocabulary → sound), SPEC 9.5 A3 plus the common behaviour:
 *
 * | Property | Breath |
 * |---|---|
 * | Viscosity | slower swells (attack 15–250 ms); the band follows the movement more slowly (glide 30–500 ms); darker (band down an octave) |
 * | Elasticity | a narrower, more resonant band (Q ×1–×2.8) that overshoots as it moves (glide Q 0.5–2.3); above 0.55 a whistle rises out of the air |
 * | Persistence | release 30–800 ms; reverb send and decay 0.4–6 s |
 * | Dispersion | a broader band (up to ×2.2 wider when the movement is spread out); the two air streams spread across the stereo field; pan follows the movement's position more widely |
 * | Brightness | band centre 500 Hz–5 kHz (vowels move by half as much) |
 * | Intensity | level −15 / 0 / +9 dB at 0 / 0.5 / 1, and drive (soft saturation) |
 * | Range | how far the band travels with the movement's height and its opening and closing: 4–24 semitones |
 * | Density | one band of air, then a chest layer an octave below, then a hiss 1.5 octaves above |
 * | Formant | none (plain air), "ah" or "oo": three vowel formants shape the air |
 */
export function deriveBreathParams(
  props: PropertyValues,
  variation: BreathVariation,
): BreathParams {
  const v = readProperty(props, P.viscosity);
  const e = readProperty(props, P.elasticity);
  const p = readProperty(props, P.persistence);
  const d = readProperty(props, P.dispersion);
  const b = readProperty(props, P.brightness);
  const i = readProperty(props, P.intensity);
  const r = readProperty(props, P.range);
  const n = readProperty(props, P.density);
  const formant = readProperty(props, P.formant);

  const centerHz = breathCenterHz(b, v) * variation.center;
  const airQ = 1.2 * Math.pow(2, 1.5 * e * e);
  const whistle = whistleAmount(e);
  // As the whistle rises, the air it grows out of thins away.
  const thin = 1 - 0.8 * whistle;
  const vowel = formant === 1 || formant === 2 ? FORMANTS[formant] : null;
  // Vowels follow Brightness by half as many octaves as the air, so they stay recognisable.
  const vowelTilt = Math.sqrt(centerHz / BASELINE_CENTER_HZ);

  const bandHz: Bands = [
    centerHz,
    centerHz * CHEST_RATIO,
    centerHz * HISS_RATIO,
    centerHz,
    (vowel?.hz[0] ?? 730) * vowelTilt,
    (vowel?.hz[1] ?? 1090) * vowelTilt,
    (vowel?.hz[2] ?? 2440) * vowelTilt,
  ];
  const bandQ: Bands = [
    airQ,
    airQ * 0.9,
    airQ * 1.1,
    WHISTLE_Q,
    vowel?.q[0] ?? 6,
    vowel?.q[1] ?? 8,
    vowel?.q[2] ?? 12,
  ];
  // Levels as heard (before compensating for each band's width).
  const heard: Bands = [
    (vowel ? 0.3 : 1) * (1 - 0.9 * whistle),
    0.7 * smoothstep(0.2, 0.7, n) * thin,
    0.5 * smoothstep(0.45, 0.95, n) * thin,
    1.2 * whistle,
    vowel ? Math.pow(10, (vowel.db[0] ?? 0) / 20) * thin : 0,
    vowel ? Math.pow(10, (vowel.db[1] ?? 0) / 20) * thin : 0,
    vowel ? Math.pow(10, (vowel.db[2] ?? 0) / 20) * thin : 0,
  ];
  let power = 0;
  for (const h of heard) power += h * h;
  const norm = power > 0 ? 1 / Math.sqrt(power) : 0;
  const bandGain = heard.map((h, k) => h * norm * bandCompensation(bandQ[k] ?? Q_REF)) as Bands;
  const send = reverbSendLevel(p);

  return {
    centerHz,
    rangeSt: rangeSemitones(r, 4, 24),
    shiftGlideSec: viscosityGlideSeconds(v, 0.03, 0.5),
    shiftGlideQ: 0.5 + 1.8 * e * e,
    followSec: expLerp(0.02, 0.25, v),
    dispersion: d,
    level: BREATH_LEVEL * intensityGain(i),
    attackSec: viscosityAttackSeconds(v, 0.015, 0.25),
    releaseSec: releaseSeconds(p, 0.03, 0.8),
    bandHz,
    bandQ,
    bandGain,
    width: 0.85 * Math.pow(d, 1.2),
    panOffset: variation.pan,
    panGlideSec: 0.1,
    drive: lerp(0.3, 3, Math.pow(i, 2.5)),
    reverbSend: send,
    reverbDecaySec: reverbDecaySeconds(p),
    dry: 1 - 0.35 * send,
  };
}

/** True when every property Breath reads has the same value in both sets. */
export function sameBreathProps(a: PropertyValues, b: PropertyValues): boolean {
  for (const id of BREATH_PROPERTY_IDS) if (a[id] !== b[id]) return false;
  return true;
}
