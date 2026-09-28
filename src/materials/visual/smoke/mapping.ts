/**
 * V3 Smoke: property and feature → solver parameter mapping (SPEC 9.4). Pure, so it is
 * unit tested. Documented as a table in docs/materials/visual-smoke.md.
 *
 * Smoke is the shared solver plus heat: the movement pushes the air and gives off smoke
 * and heat where it moves (energy → emission); warm smoke rises (buoyancy) and curls
 * (strong vorticity confinement and seeded turbulence).
 */
import { readProperty } from '../../properties';
import type { PropertyValues } from '../../types';
import { rangeScale, type FluidDisplayParams, type FluidStepParams } from '../shared/fluid';
import { smokeProperty } from './properties';

export type SmokeStepParams = Omit<
  FluidStepParams,
  'dt' | 'jitterPhaseX' | 'jitterPhaseY' | 'patternSeed'
>;

/** Smoke's own passes, run through the solver's hooks (see plume.ts). */
export interface SmokeEmissionParams {
  /** Smoke released per (field diagonal per second) of push, per second. */
  smokeAmount: number;
  /** 0..1: share of the smoke that leaves from the seeded vents (the rest is haze). */
  vents: number;
  /** 0..1: fraction of the vents that give off smoke. */
  ventCoverage: number;
  /** Each vent's release is drawn out along the push this far, short sides. */
  wispLength: number;
  /** Heat released per (field diagonal per second) of push, per second. */
  heatAmount: number;
  /**
   * Emission radius with no expansion or contraction, short sides. The frame's
   * divergence widens (expanding) or narrows (contracting) it: see `burstRadius()`.
   */
  burstRadius: number;
  /** Buoyancy per unit of heat, short sides/s² (negative: heavy smoke sinks). */
  lift: number;
  /** How fast the heat fades, 1/s. */
  cooling: number;
  /** Seeded turbulence per unit of heat, short sides/s². */
  turbulence: number;
  /** Size of the turbulent eddies: noise cells per short side. */
  turbulenceScale: number;
  /** Speed limit, short sides per second (keeps extreme settings stable). */
  maxSpeed: number;
}

export interface SmokeParams {
  step: SmokeStepParams;
  emit: SmokeEmissionParams;
  display: FluidDisplayParams;
}

const VISCOSITY = smokeProperty('viscosity');
const PERSISTENCE = smokeProperty('persistence');
const DISPERSION = smokeProperty('dispersion');
const BRIGHTNESS = smokeProperty('brightness');
const INTENSITY = smokeProperty('intensity');
const RISE = smokeProperty('rise');
const DENSITY = smokeProperty('density');
const RANGE = smokeProperty('range');

/** ν at Viscosity 1, (short side)²/s: air made syrupy, but far thinner than Honey. */
export const SMOKE_MAX_VISCOSITY = 4e-3;
/** Buoyancy at Rise 1 (and minus this at Rise 0), short sides/s² per unit of heat. */
export const SMOKE_MAX_LIFT = 5;

/** Viscosity 0..1 → ν: zero at 0, exponential above. */
export function smokeViscosity(v: number): number {
  if (v <= 0) return 0;
  const k = 300;
  return (SMOKE_MAX_VISCOSITY * (k ** v - 1)) / (k - 1);
}

/** Persistence 0..1 → smoke fade rate, 1/s: 2.1/s → 0.3/s → ~0.04/s. */
export function smokeDissipation(p: number): number {
  return 0.3 * 7 ** (1 - 2 * p);
}

/** Rise 0..1 → buoyancy: neutral at the middle, rising above it, sinking below it. */
export function smokeLift(rise: number): number {
  return SMOKE_MAX_LIFT * (2 * rise - 1);
}

/** Intensity 0..1 → force gain, 1/s (a quarter to four times the baseline of 6/s). */
export function smokeForceGain(i: number): number {
  return 6 * 4 ** (2 * i - 1);
}

/** Density 0..1 → smoke released per unit of movement (a third to three times 2.5). */
export function smokeAmount(d: number): number {
  return 2.5 * 3 ** (2 * d - 1);
}

/**
 * The burst radius for a frame: expansion (divergence > 0) widens the emission into a
 * puff, contraction (< 0) draws it in. `divergence` is the frame's normalized feature
 * (−1..1); the result is in short sides.
 */
export function burstRadius(base: number, divergence: number): number {
  const d = Number.isFinite(divergence) ? Math.min(1, Math.max(-1, divergence)) : 0;
  return Math.max(0, base) * 2 ** (1.3 * d);
}

export function smokeParams(props: PropertyValues): SmokeParams {
  const viscosity = readProperty(props, VISCOSITY);
  const persistence = readProperty(props, PERSISTENCE);
  const dispersion = readProperty(props, DISPERSION);
  const brightness = readProperty(props, BRIGHTNESS);
  const intensity = readProperty(props, INTENSITY);
  const rise = readProperty(props, RISE);
  const density = readProperty(props, DENSITY);
  const range = readProperty(props, RANGE);

  const nu = smokeViscosity(viscosity);
  return {
    step: {
      range,
      forceGain: smokeForceGain(intensity),
      forceLowPassSec: 0.1 * viscosity * viscosity,
      // Turbulence comes from Smoke's own seeded eddies, not a scatter of the push.
      jitterAngle: 0,
      jitterOffset: 0,
      jitterFrequency: 3,
      // Smoke releases its own emission (with a burst radius), so the solver's dye pass
      // is skipped.
      dyeAmount: 0,
      dyeSpots: 0,
      dyeSpotCoverage: 1,
      dyeDissipation: smokeDissipation(persistence),
      velocityDissipation: 0.1 + 1.4 * viscosity * viscosity,
      viscosity: nu,
      viscosityIterations: nu > 0 ? Math.round(4 + 8 * viscosity) : 0,
      // Swirl keeps smoke curling; thick air can't hold fine curls.
      vorticity: (0.12 + 0.36 * dispersion) * (1 - 0.7 * viscosity),
    },
    emit: {
      smokeAmount: smokeAmount(density),
      vents: 0.8,
      ventCoverage: 0.3 + 0.5 * density,
      wispLength: 0.05,
      heatAmount: 2,
      burstRadius: 0.035 * rangeScale(range),
      lift: smokeLift(rise),
      cooling: 0.5,
      turbulence: 2.4 * dispersion * (1 - 0.6 * viscosity),
      turbulenceScale: 3,
      maxSpeed: 4,
    },
    display: {
      exposure: 2 ** (2.4 * (brightness - 0.5)),
      saturation: 0.6 + 0.5 * brightness,
      surfaceLight: 0,
    },
  };
}
