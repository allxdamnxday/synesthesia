/**
 * A4 Resonance: property values → synthesis parameters, including the modal table the
 * resonator bank rings with. Pure (unit-tested); the mapping table for the docs is the
 * comment on `deriveResonanceParams`.
 *
 * The body is a bank of MODE_COUNT resonant modes (partials). Each body has natural mode
 * ratios, amplitudes and decay times; the properties bend them:
 *
 * - Rigidity sets how inharmonic the modes are. Each natural ratio is measured against a
 *   harmonic reference (the nearest whole-number ratio, kept increasing): at Rigidity 0 the
 *   modes sit exactly on the harmonic series (a soft, in-tune body, like a string); at 0.5 they
 *   sit at the body's natural ratios; at 1 their deviation from harmonic is doubled (a stiff,
 *   clanging body). Rigidity also hardens the strike.
 * - Range scales every ratio's distance from the fundamental in log-frequency: compressed into
 *   a tight cluster at 0, the natural spread at 0.5, expanded at 1.
 * - Elasticity scales the ring time (the modes' Q). Viscosity damps the body, most of all its
 *   high modes, and muffles the strike.
 */
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
import { RESONANCE_PROPERTIES } from './meta';

/** Modes in the resonator bank (SPEC 9.5: 6–12). Density decides how many sound. */
export const MODE_COUNT = 12;
/** Modes that always sound (Density 0); Density adds the rest. */
export const MIN_MODES = 6;
/** Output level at baseline Intensity: a strong strike peaks around −6 dBFS. */
export const RESONANCE_LEVEL = 0.5;
/** −60 dB as a natural-log amplitude ratio. */
export const LN_1000 = Math.log(1000);

export interface BodyDef {
  /** Fundamental in Hz. */
  baseHz: number;
  /** Natural mode frequency ratios (at Rigidity 0.5 and Range 0.5), ascending. */
  ratios: readonly number[];
  /** Relative mode amplitudes for a hard strike. */
  amps: readonly number[];
  /**
   * The order in which Density adds modes: ranks 0–5 are the body's core modes and always
   * sound; ranks 6–11 are in-between modes that make the body richer and more complex.
   */
  rank: readonly number[];
  /** Ring time (T60, seconds) of the fundamental at baseline. */
  decaySec: number;
  /** High modes die sooner: T60 falls as ratio^(−dampExp) at baseline Viscosity. */
  dampExp: number;
  /** Strike hardness offset (glass is struck with something hard, wood with a mallet). */
  hardness: number;
  /** Output level calibration, so the bodies sound about equally loud. */
  level: number;
  /** Level of the bowed (singing) excitation. */
  bow: number;
}

/**
 * The three bodies, twelve modes each, all within hearing. Core ratios: glass from a wine
 * glass's (m,0) bending modes (1, 2.32, 4.25, 6.63, 9.38, 12.5); wood from a marimba bar's
 * tuned partials (1 : 3.99 : 9.2) with torsional modes between; metal from a free bar
 * (1, 2.76, 5.4, 8.93) and a bell's octave partials (1.97, 4.08). The in-between modes that
 * Density adds sit among them.
 */
export const BODIES: readonly BodyDef[] = [
  {
    // Glass: high, pure, long, bright.
    baseHz: 783.99,
    ratios: [1, 1.52, 2.32, 3.08, 4.25, 5.36, 6.63, 7.95, 9.38, 11.1, 12.5, 14.6],
    amps: [1, 0.35, 0.72, 0.3, 0.5, 0.25, 0.36, 0.2, 0.26, 0.15, 0.19, 0.12],
    rank: [0, 6, 1, 7, 2, 8, 3, 9, 4, 10, 5, 11],
    decaySec: 2.6,
    dampExp: 0.45,
    hardness: 0.4,
    level: 1,
    bow: 0.45,
  },
  {
    // Wood: a short, dry knock; high modes die almost at once.
    baseHz: 349.23,
    ratios: [1, 2.13, 2.61, 3.99, 4.72, 5.52, 7.15, 9.2, 10.9, 13.7, 16.8, 20.1],
    amps: [1, 0.3, 0.25, 0.6, 0.2, 0.22, 0.18, 0.32, 0.12, 0.12, 0.08, 0.06],
    rank: [0, 1, 6, 2, 7, 3, 8, 4, 9, 5, 10, 11],
    decaySec: 0.55,
    dampExp: 1.05,
    hardness: 0.05,
    level: 1.2,
    bow: 0.2,
  },
  {
    // Metal: low, dense, clustered partials that ring for a long time.
    baseHz: 220,
    ratios: [1, 1.52, 1.97, 2.44, 2.76, 3.27, 4.08, 4.52, 5.4, 6.19, 7.11, 8.93],
    amps: [1, 0.55, 0.8, 0.45, 0.6, 0.4, 0.45, 0.3, 0.32, 0.22, 0.2, 0.14],
    rank: [0, 6, 1, 7, 2, 8, 3, 9, 4, 10, 11, 5],
    decaySec: 5,
    dampExp: 0.3,
    hardness: 0,
    level: 0.72,
    bow: 0.8,
  },
];

export interface ResonanceParams {
  body: number;
  baseHz: number;
  // The modal table (MODE_COUNT entries each).
  freqs: number[];
  /** T60 per mode, seconds. */
  decays: number[];
  gains: number[];
  // Stereo spread and shimmer inside the bank.
  width: number;
  detuneCents: number;
  // Strikes.
  /** Strike hardness before per-strike velocity (0 soft … 1 hard). */
  hardness: number;
  /** Pitch bounce per strike, cents at full velocity (sign follows the movement). */
  bounceCents: number;
  bounceHz: number;
  bounceDecaySec: number;
  // Singing (bowed) excitation.
  bowLevel: number;
  bowAttackSec: number;
  bowReleaseSec: number;
  bowCutoffHz: number;
  // Damper: how fast the ring dies once the movement stops.
  /** Extra decay rate (natural-log amplitude per second) with the damper fully on. */
  dampRate: number;
  // Space and output.
  dispersion: number;
  panGlideSec: number;
  level: number;
  drive: number;
  cutoffHz: number;
  reverbSend: number;
  reverbDecaySec: number;
  dry: number;
}

function def(id: string): PropertyDef {
  const found = RESONANCE_PROPERTIES.find((p) => p.id === id);
  if (!found) throw new Error(`Resonance has no property "${id}".`);
  return found;
}

const P = {
  body: def('body'),
  rigidity: def('rigidity'),
  elasticity: def('elasticity'),
  viscosity: def('viscosity'),
  persistence: def('persistence'),
  intensity: def('intensity'),
  brightness: def('brightness'),
  dispersion: def('dispersion'),
  density: def('density'),
  range: def('range'),
};

/** Property ids that shape Resonance, in a fixed order (for change detection). */
export const RESONANCE_PROPERTY_IDS = Object.keys(P) as (keyof typeof P)[];

/** Nearest whole-number ratio for each natural ratio, kept strictly increasing. */
export function harmonicReference(ratios: readonly number[]): number[] {
  const out: number[] = [];
  let prev = 0;
  for (const r of ratios) {
    const h = Math.max(prev + 1, Math.round(r));
    out.push(h);
    prev = h;
  }
  return out;
}

/** Rigidity → how far the modes move from harmonic toward (and past) the natural ratios. */
export function inharmonicityAmount(rigidity: number): number {
  return 2 * clamp01(rigidity);
}

/** Range → log-frequency spread of the modes around the fundamental (1 = natural). */
export function modeSpread(range: number): number {
  const r = clamp01(range);
  return r < 0.5 ? lerp(0.45, 1, r / 0.5) : lerp(1, 1.45, (r - 0.5) / 0.5);
}

/** Elasticity → ring-time multiplier (0.12× dead knock … 3.5× long ring; 1 at baseline). */
export function elasticRing(elasticity: number): number {
  const e = clamp01(elasticity);
  return e < 0.5 ? expLerp(0.12, 1, e / 0.5) : expLerp(1, 3.5, (e - 0.5) / 0.5);
}

/** Viscosity → overall ring-time multiplier (thicker medium damps more; 1 at baseline). */
export function viscousDamping(viscosity: number): number {
  const v = clamp01(viscosity);
  return v < 0.5 ? expLerp(1.4, 1, v / 0.5) : expLerp(1, 0.3, (v - 0.5) / 0.5);
}

/** Persistence → how long the ring lasts once the movement stops (damper release, T60 s). */
export function releaseSeconds(persistence: number): number {
  return expLerp(0.12, 10, clamp01(persistence));
}

/**
 * Mode ratios for a body: harmonic reference h, natural ratio b, inharmonicity amount a and
 * spread s give ratio = exp(s · (ln h + a · (ln b − ln h))).
 */
export function modeRatios(body: BodyDef, rigidity: number, range: number): number[] {
  const harmonic = harmonicReference(body.ratios);
  const a = inharmonicityAmount(rigidity);
  const s = modeSpread(range);
  return body.ratios.map((b, i) => {
    const h = harmonic[i] ?? b;
    return Math.exp(s * (Math.log(h) + a * (Math.log(b) - Math.log(h))));
  });
}

/**
 * Inharmonicity of a body's modes: the amplitude-weighted mean distance, in cents, of each
 * mode from its in-tune position (its harmonic reference). 0 for a soft (Rigidity 0) body.
 */
export function inharmonicityCents(
  ratios: readonly number[],
  reference: readonly number[],
  weights: readonly number[],
): number {
  let acc = 0;
  let total = 0;
  ratios.forEach((r, i) => {
    const w = weights[i] ?? 0;
    acc += w * Math.abs(1200 * Math.log2(r / (reference[i] ?? r)));
    total += w;
  });
  return total > 0 ? acc / total : 0;
}

/** Strike velocity (0.45–1) from the onset's normalized surge. */
export function strikeVelocity(surge: number): number {
  return 0.45 + 0.55 * clamp01(surge / 0.8);
}

/** Mallet contact time in seconds for a strike: harder strikes are shorter (brighter). */
export function malletSeconds(hardness: number, velocity: number): number {
  const h = clamp01(hardness + 0.3 * (velocity - 0.8));
  return expLerp(1.6e-3, 0.08e-3, h);
}

/**
 * Mapping (shared vocabulary → sound), SPEC 9.5 A4 plus the common behaviour:
 *
 * | Property | Resonance |
 * |---|---|
 * | Body | glass (D5, long bright ring), wood (F4, short dry knock), metal (A3, long dense hum) |
 * | Rigidity | inharmonicity: modes harmonic at 0, natural at 0.5, twice as far off at 1; harder, brighter strikes |
 * | Elasticity | ring time ×0.12 … ×3.5 (the modes' Q); pitch bounce on each strike (0 … ±90 cents) |
 * | Viscosity | damping (ring ×1.4 … ×0.3, high modes most); muffled strikes; slower singing; darker filter |
 * | Persistence | damper release 0.12–10 s once the movement stops; reverb send and decay 0.4–6 s |
 * | Intensity | level −15 / 0 / +9 dB at 0 / 0.5 / 1, and drive (soft saturation) |
 * | Brightness | spectral tilt of the modes; brighter singing; low-pass cutoff |
 * | Dispersion | modes spread across the stereo field and detuned into shimmering pairs (0–16 cents); pan follows the movement more widely |
 * | Density | 6 … 12 sounding modes (the body's six core modes, then in-between modes) |
 * | Range | spread of the modes: compressed cluster (log ratios ×0.45) … expanded (×1.45) |
 */
export function deriveResonanceParams(props: PropertyValues, sampleRate = 48000): ResonanceParams {
  const bodyIndex = readProperty(props, P.body);
  const body = BODIES[bodyIndex] ?? BODIES[0];
  if (!body) throw new Error('Resonance has no bodies.');
  const g = readProperty(props, P.rigidity);
  const e = readProperty(props, P.elasticity);
  const v = readProperty(props, P.viscosity);
  const p = readProperty(props, P.persistence);
  const i = readProperty(props, P.intensity);
  const b = readProperty(props, P.brightness);
  const d = readProperty(props, P.dispersion);
  const n = readProperty(props, P.density);
  const r = readProperty(props, P.range);

  const ratios = modeRatios(body, g, r);
  const tilt = lerp(-1.1, 0.35, b);
  const ring = body.decaySec * elasticRing(e) * viscousDamping(v);
  const dampExp = Math.max(0.05, body.dampExp + 1.8 * (v - 0.5));
  const activeModes = MIN_MODES + (MODE_COUNT - MIN_MODES) * n;
  const nyquistSafe = 0.45 * sampleRate;

  const freqs: number[] = [];
  const decays: number[] = [];
  const gains: number[] = [];
  ratios.forEach((ratio, m) => {
    const f = body.baseHz * ratio;
    freqs.push(f);
    decays.push(Math.max(0.015, ring * Math.pow(ratio, -dampExp)));
    const rank = body.rank[m] ?? m;
    const density = rank < MIN_MODES ? 1 : clamp01(activeModes - rank);
    const audible = f < nyquistSafe ? 1 - smoothstep(11000, 16000, f) : 0;
    gains.push((body.amps[m] ?? 0) * Math.pow(ratio, tilt) * density * audible);
  });

  const send = reverbSendLevel(p);
  return {
    body: bodyIndex,
    baseHz: body.baseHz,
    freqs,
    decays,
    gains,
    width: Math.pow(d, 0.8),
    detuneCents: 16 * Math.pow(d, 1.5),
    hardness: clamp01(body.hardness + 0.3 + 0.9 * (g - 0.5) - 0.7 * (v - 0.5)),
    bounceCents: 90 * e * e,
    bounceHz: lerp(7, 4.5, e),
    bounceDecaySec: 0.08 + 0.35 * e,
    bowLevel: body.bow,
    bowAttackSec: expLerp(0.03, 0.35, v),
    bowReleaseSec: expLerp(0.05, 0.25, v),
    bowCutoffHz: Math.min(16000, body.baseHz * expLerp(3, 12, b) * Math.pow(2, -1.2 * v)),
    dampRate: LN_1000 / releaseSeconds(p),
    dispersion: d,
    panGlideSec: 0.08,
    level: RESONANCE_LEVEL * body.level * intensityGain(i),
    drive: lerp(0.25, 3, Math.pow(i, 2.5)),
    cutoffHz: clamp(1.6 * brightnessCutoffHz(b, v), 800, 20000),
    reverbSend: send,
    reverbDecaySec: reverbDecaySeconds(p),
    dry: 1 - 0.35 * send,
  };
}

/** True when every property Resonance reads has the same value in both sets. */
export function sameResonanceProps(a: PropertyValues, b: PropertyValues): boolean {
  for (const id of RESONANCE_PROPERTY_IDS) if (a[id] !== b[id]) return false;
  return true;
}
