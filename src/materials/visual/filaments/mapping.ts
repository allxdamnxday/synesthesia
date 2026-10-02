/**
 * V5 Filaments: property → simulation parameter mapping (SPEC 9.4). Pure, so it is unit
 * tested. Documented as a table in docs/materials/visual-filaments.md.
 *
 * | Property    | Simulation parameter                                                  |
 * |-------------|-----------------------------------------------------------------------|
 * | Viscosity   | drag on the strands (1.8/s → 8.8/s), a slightly weaker push, and lag  |
 * |             | (0 → 0.12 s): thin water lets strands whip and coast, thick holds them|
 * | Elasticity  | spring pulling every point back to its resting place (none → about    |
 * |             | 1.2 Hz, lightly damped, so strands overshoot as they settle)          |
 * | Persistence | how fast the painted ribbons of light fade (7/s → 1.2/s → 0.2/s)      |
 * | Rigidity    | bending stiffness: how firmly a strand keeps its resting curve        |
 * | Brightness  | exposure and saturation of strands and ribbons                        |
 * | Intensity   | force gain (a quarter to four times the baseline push)                |
 * | Dispersion  | how tangled the resting strands lie (a combed curtain → a tangle),    |
 * |             | and seeded scatter of the push                                        |
 * | Density     | number of strands (20 → ~125 → 800), capped by quality tier           |
 * | Range       | projection scale of the signature (compressed ↔ magnified)            |
 * | Length      | strand length (0.11 → 0.28 → 0.7 short sides)                         |
 * | Thickness   | strand and ribbon width (about 0.6 → 1.7 → 5 px at 1080p)             |
 * | Hue         | turn of the strands' and ribbons' colors about grey, where they are   |
 * |             | drawn                                                                 |
 *
 * Signature → filaments: the field, sampled at every point of every strand through the
 * Range projection, pushes the points; the strand's constraints (length, curve, root)
 * turn the push into bending and swinging. Where a strand sweeps across the water it
 * paints light in the color of its direction, so the close and the open of a wink leave
 * two ribbons of different colors that fade with Persistence.
 */
import { readProperty } from '../../properties';
import type { PropertyValues, Quality } from '../../types';
import { hueTurns } from '../shared/hue';
import { filamentsProperty } from './properties';

/** Most strands simulated at each quality tier (SPEC 14.2). */
export const FILAMENT_TIER_CAPS: Readonly<Record<Quality, number>> = {
  draft: 150,
  standard: 400,
  high: 800,
};

export interface FilamentSimParams {
  /** Strands in play. */
  count: number;
  /** 0..1: compressed (0), fitted (0.5), magnified (1). */
  range: number;
  /** Strand length, short sides. */
  length: number;
  /** Push per unit of signature velocity, 1/s. */
  forceGain: number;
  /** Drag on the strands' motion, 1/s. */
  drag: number;
  /** Low-pass on the push each point feels, seconds. */
  lagSec: number;
  /** Spring pulling each point back to its resting place, 1/s². */
  spring: number;
  /** 0..1: how firmly a strand keeps its resting curve (per step, iteration independent). */
  bend: number;
  /**
   * 0..2: how the resting strands lie. 0 hangs them in a combed curtain; 1 lets them
   * point every way along a smooth flow; above 1 the flow's whorls get smaller (tangled).
   */
  tangle: number;
  /** Seeded scatter of the push (share of the push). */
  scatter: number;
}

export interface FilamentDisplayParams {
  /** Strand width, short sides. */
  width: number;
  /** Multiplies all light. */
  exposure: number;
  /** 1 = as tinted; below toward grey, above more saturated. */
  saturation: number;
  /** Ribbon fade rate, 1/s. */
  trailFade: number;
  /** Hue turn of the strands' and ribbons' colors, in turns (0 = their own). */
  hue: number;
}

export interface FilamentParams {
  sim: FilamentSimParams;
  display: FilamentDisplayParams;
}

const VISCOSITY = filamentsProperty('viscosity');
const ELASTICITY = filamentsProperty('elasticity');
const PERSISTENCE = filamentsProperty('persistence');
const RIGIDITY = filamentsProperty('rigidity');
const BRIGHTNESS = filamentsProperty('brightness');
const INTENSITY = filamentsProperty('intensity');
const DISPERSION = filamentsProperty('dispersion');
const DENSITY = filamentsProperty('density');
const RANGE = filamentsProperty('range');
const LENGTH = filamentsProperty('length');
const THICKNESS = filamentsProperty('thickness');
const HUE = filamentsProperty('hue');

/** Density 0..1 → strand count: 20 → ~125 at baseline → 800 (exponential). */
export function filamentCount(density: number, quality: Quality): number {
  const wanted = Math.round(20 * 40 ** density);
  return Math.max(1, Math.min(FILAMENT_TIER_CAPS[quality], wanted));
}

/** Length 0..1 → strand length in short sides: 0.11 → 0.28 → 0.7. */
export function filamentLength(l: number): number {
  return 0.28 * 2.5 ** (2 * l - 1);
}

/** Thickness 0..1 → strand width in short sides: 0.0007 → 0.002 → 0.006. */
export function filamentWidth(t: number): number {
  return 0.002 * 3 ** (2 * t - 1);
}

/** Viscosity 0..1 → drag, 1/s: 1.8 → 4 → 8.8. */
export function filamentDrag(v: number): number {
  return 4 * 2.2 ** (2 * v - 1);
}

/** Viscosity and Intensity → push per unit of signature velocity, 1/s. */
export function filamentForceGain(v: number, i: number): number {
  return 2.4 * (1.15 - 0.3 * v) * 4 ** (2 * i - 1);
}

/** Elasticity 0..1 → spring toward the resting place, 1/s²: 0 → 15 → 60. */
export function filamentSpring(e: number): number {
  return 60 * e * e;
}

/** Persistence 0..1 → ribbon fade rate, 1/s: 7.2 (a blink) → 1.2 → 0.2 (lingers). */
export function filamentTrailFade(p: number): number {
  return 1.2 * 6 ** (1 - 2 * p);
}

export function filamentParams(props: PropertyValues, quality: Quality): FilamentParams {
  const viscosity = readProperty(props, VISCOSITY);
  const elasticity = readProperty(props, ELASTICITY);
  const persistence = readProperty(props, PERSISTENCE);
  const rigidity = readProperty(props, RIGIDITY);
  const brightness = readProperty(props, BRIGHTNESS);
  const intensity = readProperty(props, INTENSITY);
  const dispersion = readProperty(props, DISPERSION);
  const density = readProperty(props, DENSITY);
  const range = readProperty(props, RANGE);
  const length = readProperty(props, LENGTH);
  const thickness = readProperty(props, THICKNESS);
  return {
    sim: {
      count: filamentCount(density, quality),
      range,
      length: filamentLength(length),
      forceGain: filamentForceGain(viscosity, intensity),
      drag: filamentDrag(viscosity),
      // Like Water's lag: longer would smear the close into the open and cancel both.
      lagSec: 0.12 * viscosity * viscosity,
      spring: filamentSpring(elasticity),
      bend: 0.03 + 0.97 * rigidity ** 1.5,
      tangle: 0.12 + 1.76 * dispersion,
      scatter: 0.8 * dispersion * dispersion,
    },
    display: {
      width: filamentWidth(thickness),
      exposure: 2 ** (2.4 * (brightness - 0.5)),
      saturation: 0.7 + 0.65 * brightness,
      trailFade: filamentTrailFade(persistence),
      hue: hueTurns(readProperty(props, HUE)),
    },
  };
}
