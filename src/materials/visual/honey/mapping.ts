/**
 * V2 Honey: property → solver parameter mapping (SPEC 9.4). Pure, so it is unit tested.
 * Documented as a table in docs/materials/visual-honey.md.
 *
 * Honey is Water's solver made thick: a heavy, lagging push, momentum that spreads wide
 * (true viscous diffusion) and is dragged to a stop, color that is folded in and stays.
 */
import { readProperty } from '../../properties';
import type { PropertyValues } from '../../types';
import type { FluidDisplayParams, FluidStepParams } from '../shared/fluid';
import { honeyProperty } from './properties';

export type HoneyStepParams = Omit<
  FluidStepParams,
  'dt' | 'jitterPhaseX' | 'jitterPhaseY' | 'patternSeed'
>;

/** Honey's own passes, run through the solver's hooks (see viscoElastic.ts). */
export interface HoneyBodyParams {
  /** Kinematic viscosity ν for the Gaussian diffusion kernel, (short side)²/s. */
  viscosity: number;
  /** Spring stiffness pulling displaced honey back, 1/s². 0 = no spring. */
  springStiffness: number;
  /** How fast the honey accepts its new shape (the spring forgets), 1/s. */
  displacementRelax: number;
  /** Speed limit, short sides per second (keeps extreme settings stable). */
  maxSpeed: number;
}

export interface HoneyParams {
  step: HoneyStepParams;
  body: HoneyBodyParams;
  display: FluidDisplayParams;
  /** Index into HONEY_PALETTE_BYTES. */
  palette: number;
}

const VISCOSITY = honeyProperty('viscosity');
const ELASTICITY = honeyProperty('elasticity');
const PERSISTENCE = honeyProperty('persistence');
const DISPERSION = honeyProperty('dispersion');
const BRIGHTNESS = honeyProperty('brightness');
const INTENSITY = honeyProperty('intensity');
const DENSITY = honeyProperty('density');
const RANGE = honeyProperty('range');
const PALETTE = honeyProperty('palette');
const SURFACE_LIGHT = honeyProperty('surfaceLight');

/** Viscosity 0..1 → ν, (short side)²/s: runny syrup to stiff honey (exponential). */
export function honeyViscosity(v: number): number {
  return 0.012 * 8 ** v;
}

/** Viscosity 0..1 → drag, 1/s: how fast the honey stops once the push ends. */
export function honeyDrag(v: number): number {
  return 2.5 * 4 ** v;
}

/** Viscosity 0..1 → lag of the push, seconds (a heavy, delayed response). */
export function honeyLag(v: number): number {
  return 0.05 + 0.55 * v * v;
}

/**
 * Viscosity 0..1 → mobility: steady speed per unit of push (force gain ÷ drag). Thicker
 * honey follows the movement less far.
 */
export function honeyMobility(v: number): number {
  return 6 * 0.4 ** v;
}

/** Intensity 0..1 → multiplier of the push (a quarter to four times the baseline). */
export function honeyIntensity(i: number): number {
  return 4 ** (2 * i - 1);
}

/** Elasticity 0..1 → spring stiffness, 1/s². */
export function honeySpring(e: number): number {
  return 70 * e * e;
}

/** Elasticity 0..1 → how fast the honey forgets where it was, 1/s. */
export function honeyRelax(e: number): number {
  return 0.05 + 0.5 * (1 - e) * (1 - e);
}

/** Persistence 0..1 → color fade rate, 1/s: ~1/s → 0.12/s → 0.015/s. */
export function honeyDyeDissipation(p: number): number {
  return 0.12 * 8 ** (1 - 2 * p);
}

/** Density 0..1 → color released per unit of movement (a third to three times 2.5). */
export function honeyDyeAmount(d: number): number {
  return 2.5 * 3 ** (2 * d - 1);
}

export function honeyParams(props: PropertyValues): HoneyParams {
  const viscosity = readProperty(props, VISCOSITY);
  const elasticity = readProperty(props, ELASTICITY);
  const persistence = readProperty(props, PERSISTENCE);
  const dispersion = readProperty(props, DISPERSION);
  const brightness = readProperty(props, BRIGHTNESS);
  const intensity = readProperty(props, INTENSITY);
  const density = readProperty(props, DENSITY);
  const range = readProperty(props, RANGE);
  const palette = readProperty(props, PALETTE);
  const surfaceLight = readProperty(props, SURFACE_LIGHT);

  const drag = honeyDrag(viscosity);
  return {
    step: {
      range,
      forceGain: honeyMobility(viscosity) * drag * honeyIntensity(intensity),
      forceLowPassSec: honeyLag(viscosity),
      // The color marks the moment of movement; the honey's response lags behind it.
      dyeFromRawField: true,
      jitterAngle: 0.8 * dispersion * dispersion,
      jitterOffset: 0.04 * dispersion * dispersion,
      jitterFrequency: 2.5,
      dyeAmount: honeyDyeAmount(density),
      // Color leaves from a scatter of spots, each drawn out along the push into a
      // stroke, so the slow honey shows drawn strands from the first moment.
      // Thicker honey takes the color in more smoothly.
      dyeSpots: 0.55 - 0.25 * viscosity,
      dyeStrokeLength: 0.06,
      dyeSpotCoverage: 0.3 + 0.5 * density,
      dyeDissipation: honeyDyeDissipation(persistence),
      velocityDissipation: drag,
      // Viscous diffusion runs in Honey's own Gaussian pass (see body.viscosity).
      viscosity: 0,
      viscosityIterations: 0,
      vorticity: 0.08 * dispersion * (1 - viscosity),
    },
    body: {
      viscosity: honeyViscosity(viscosity),
      springStiffness: honeySpring(elasticity),
      displacementRelax: honeyRelax(elasticity),
      maxSpeed: 3,
    },
    display: {
      exposure: 1.3 * 2 ** (2.4 * (brightness - 0.5)),
      saturation: 0.8 + 0.5 * brightness,
      surfaceLight,
    },
    palette,
  };
}
