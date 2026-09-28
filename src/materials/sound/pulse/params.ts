/**
 * A5 Pulse: property values → synthesis parameters. Pure (unit-tested); the mapping table for
 * the docs is the comment on `derivePulseParams`.
 */
import { hash32 } from '../../../chance/prng';
import { clamp, clamp01, lerp, smoothstep } from '../../../lib/math';
import { readProperty } from '../../properties';
import type { PropertyDef, PropertyValues } from '../../types';
import {
  brightnessCutoffHz,
  expLerp,
  intensityGain,
  reverbDecaySeconds,
  reverbSendLevel,
} from '../shared/mapping';
import { PULSE_PROPERTIES } from './meta';

/** The middle of the pitch range (A4). Higher movement plays above it, lower below. */
export const PULSE_BASE_HZ = 440;
/** Output level at baseline Intensity: an accented pluck peaks around −6 dBFS. */
export const PULSE_LEVEL = 0.6;
/** Geometric centre of the pulse rate range, Hz. */
export const PULSE_CENTER_HZ = 6;
/** Plucks never come closer together than this (seconds). */
export const MIN_PULSE_GAP_SEC = 0.03;

/** Scale degrees (semitones within an octave) for each Scale choice; null = free pitch. */
export const SCALES: readonly (readonly number[] | null)[] = [
  null,
  [0, 2, 4, 7, 9],
  [0, 2, 4, 6, 8, 10],
];

export interface PulseParams {
  // Rhythm
  rateMinHz: number;
  rateMaxHz: number;
  /** The steady grid pulses snap to at high Rigidity (Hz). */
  gridHz: number;
  /** 0 free timing … 1 every pulse on the grid. */
  timeSnap: number;
  rateAttackSec: number;
  rateReleaseSec: number;
  /** Multiplies the movement's density to give each pulse's chance of sounding. */
  fireGain: number;
  /** Largest random delay of a pulse (Dispersion's scatter in time). */
  jitterSec: number;
  // Pitch
  /** Total pitch span, low movement to high movement, semitones. */
  pitchSpanSt: number;
  pitchSlewSec: number;
  /** 0 free pitch … 1 locked to the scale. */
  pitchSnap: number;
  /** Scale degrees, or null for free pitch. */
  scale: readonly number[] | null;
  detuneCents: number;
  // Each pluck
  /** Ring time (T60) of a pluck at the base pitch, seconds. */
  decaySec: number;
  /** 0 dark … 1 bright (string loop filter and pick noise). */
  tone: number;
  attackSec: number;
  /** Pitch twang at full velocity, semitones (the pluck starts sharp and bounces). */
  bendSt: number;
  bendHz: number;
  bendDecaySec: number;
  // Space and output
  dispersion: number;
  panScatter: number;
  level: number;
  drive: number;
  cutoffHz: number;
  reverbSend: number;
  reverbDecaySec: number;
  dry: number;
}

function def(id: string): PropertyDef {
  const found = PULSE_PROPERTIES.find((p) => p.id === id);
  if (!found) throw new Error(`Pulse has no property "${id}".`);
  return found;
}

const P = {
  rigidity: def('rigidity'),
  range: def('range'),
  density: def('density'),
  persistence: def('persistence'),
  viscosity: def('viscosity'),
  intensity: def('intensity'),
  scale: def('scale'),
  elasticity: def('elasticity'),
  brightness: def('brightness'),
  dispersion: def('dispersion'),
};

/** Property ids that shape Pulse, in a fixed order (for change detection). */
export const PULSE_PROPERTY_IDS = Object.keys(P) as (keyof typeof P)[];

/** Range → pulse rate span (Hz) around PULSE_CENTER_HZ: narrow and steady … wide. */
export function pulseRateRange(range: number): [number, number] {
  const spread = expLerp(1.5, 12, clamp01(range));
  const half = Math.sqrt(spread);
  return [PULSE_CENTER_HZ / half, PULSE_CENTER_HZ * half];
}

/** Rigidity → how firmly pitch locks to the scale (fully locked from 0.45 up). */
export function pitchSnapAmount(rigidity: number): number {
  return smoothstep(0.15, 0.45, rigidity);
}

/** Rigidity → how firmly timing locks to the grid (free up to 0.55, locked from 0.9). */
export function timeSnapAmount(rigidity: number): number {
  return smoothstep(0.55, 0.9, rigidity);
}

/** Nearest note of a scale (degrees in semitones within an octave, ascending). */
export function quantizeToScale(semitones: number, degrees: readonly number[]): number {
  const octave = Math.floor(semitones / 12);
  const within = semitones - octave * 12;
  let best = degrees[0] ?? 0;
  let bestDist = Math.abs(within - best);
  for (const degree of degrees) {
    const dist = Math.abs(within - degree);
    if (dist < bestDist) {
      best = degree;
      bestDist = dist;
    }
  }
  // The next octave's root can be nearer than any degree in this one.
  const top = 12 + (degrees[0] ?? 0);
  if (Math.abs(within - top) < bestDist) best = top;
  return octave * 12 + best;
}

/** Velocity of an accent (a pluck at an onset) from the onset's normalized surge. */
export function accentVelocity(surge: number): number {
  return 0.75 + 0.25 * clamp01(surge / 0.8);
}

/** Velocity of an ordinary pulse from the movement's normalized energy. */
export function pulseVelocity(energy: number): number {
  return lerp(0.2, 0.9, Math.pow(clamp01(energy), 0.6));
}

/**
 * Chance that an ordinary pulse sounds: the movement's normalized density times the Density
 * property's gain, faded out for faint movement.
 */
export function fireChance(p: Pick<PulseParams, 'fireGain'>, density: number, energy: number) {
  return p.fireGain * smoothstep(0.02, 0.5, density) * smoothstep(0.03, 0.15, energy);
}

const RANDOM_SALT = 0x50554c53; // "PULS"
const NOISE_SALT = 0x504c4b21; // "PLK!"

/**
 * Seeded draw in [0, 1) for control step `k` and stream `stream`: a pure function of the seed
 * and the step (no generator state), so a seek, a rewind or an offline render all draw the
 * same values for the same moment.
 */
export function pulseRandom(seed: number, k: number, stream: number): number {
  return hash32(seed, RANDOM_SALT, k, stream) / 4294967296;
}

/** Seed for a pluck's noise burst: 24 bits, so a float32 AudioParam carries it exactly. */
export function pluckNoiseSeed(seed: number, k: number): number {
  return hash32(seed, NOISE_SALT, k) >>> 8;
}

/**
 * Mapping (shared vocabulary → sound), SPEC 9.5 A5 plus the common behaviour:
 *
 * | Property | Pulse |
 * |---|---|
 * | Rigidity | pitch locks to the scale (from 0.15, fully at 0.45); timing locks to a steady grid (from 0.55, fully at 0.9); sharper, brighter plucks |
 * | Range | pulse rate span 4.9–7.3 Hz (narrow) … 1.7–20.8 Hz (wide), 2.9–12.4 Hz at baseline; pitch span 5 … 24 semitones; the grid is the fastest rate |
 * | Density | each pulse's chance of sounding: the movement's density × 0.15 … × 1.5 (plucks at onsets always sound) |
 * | Persistence | pluck ring time (T60 0.07–3.2 s at A4); reverb send and decay 0.4–6 s |
 * | Viscosity | softer attacks (0.3–12 ms), darker plucks, slower rate and pitch following |
 * | Intensity | level −15 / 0 / +9 dB at 0 / 0.5 / 1, and drive (soft saturation) |
 * | Scale | Free (no snapping), major pentatonic, whole-tone |
 * | Elasticity | pitch twang per pluck, 0 … 2.2 semitones, bouncing at 9 … 6 Hz |
 * | Brightness | pluck brightness (string loop filter, pick noise); low-pass cutoff |
 * | Dispersion | plucks scatter across the stereo field around the movement's position, detune up to ±30 cents, delay up to 15 ms |
 */
export function derivePulseParams(props: PropertyValues): PulseParams {
  const g = readProperty(props, P.rigidity);
  const r = readProperty(props, P.range);
  const n = readProperty(props, P.density);
  const p = readProperty(props, P.persistence);
  const v = readProperty(props, P.viscosity);
  const i = readProperty(props, P.intensity);
  const scale = readProperty(props, P.scale);
  const e = readProperty(props, P.elasticity);
  const b = readProperty(props, P.brightness);
  const d = readProperty(props, P.dispersion);

  const [rateMinHz, rateMaxHz] = pulseRateRange(r);
  const timeSnap = timeSnapAmount(g);
  const softness = clamp01(0.6 * v + 0.4 * (1 - g) - 0.2);
  const send = reverbSendLevel(p);
  return {
    rateMinHz,
    rateMaxHz,
    gridHz: rateMaxHz,
    timeSnap,
    rateAttackSec: expLerp(0.012, 0.3, v),
    rateReleaseSec: expLerp(0.05, 0.6, v),
    fireGain: lerp(0.15, 1.5, n),
    jitterSec: 0.015 * d * d * (1 - timeSnap),
    pitchSpanSt: lerp(5, 24, r),
    pitchSlewSec: expLerp(0.015, 0.5, v),
    pitchSnap: pitchSnapAmount(g),
    scale: SCALES[scale] ?? null,
    detuneCents: 30 * Math.pow(d, 1.5),
    decaySec: expLerp(0.07, 3.2, p),
    tone: clamp01(0.15 + 0.7 * b - 0.4 * (v - 0.5) + 0.2 * (g - 0.5)),
    attackSec: expLerp(0.0003, 0.012, softness),
    bendSt: 2.2 * Math.pow(e, 1.6),
    bendHz: lerp(9, 6, e),
    bendDecaySec: 0.04 + 0.22 * e,
    dispersion: d,
    panScatter: 0.6 * d,
    level: PULSE_LEVEL * intensityGain(i),
    drive: lerp(0.25, 3, Math.pow(i, 2.5)),
    cutoffHz: clamp(1.4 * brightnessCutoffHz(b, v), 800, 20000),
    reverbSend: send,
    reverbDecaySec: reverbDecaySeconds(p),
    dry: 1 - 0.35 * send,
  };
}

/** True when every property Pulse reads has the same value in both sets. */
export function samePulseProps(a: PropertyValues, b: PropertyValues): boolean {
  for (const id of PULSE_PROPERTY_IDS) if (a[id] !== b[id]) return false;
  return true;
}

/** A pluck's ring time: higher notes ring a little shorter, as on a real string. */
export function pluckDecaySeconds(p: PulseParams, freq: number): number {
  return p.decaySec * Math.pow(PULSE_BASE_HZ / Math.max(20, freq), 0.4);
}
