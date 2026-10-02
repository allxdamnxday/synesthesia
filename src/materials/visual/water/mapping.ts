/**
 * V1 Water: property → solver parameter mapping (SPEC 9.4). Pure, so it is unit tested.
 * Documented as a table in docs/MATERIALS.md.
 *
 * | Property      | Solver parameter                                            |
 * |---------------|-------------------------------------------------------------|
 * | Viscosity     | ν (low range, 0–3e-3), Jacobi iterations, drag, slight lag  |
 * | Persistence   | dye fade rate (3/s → 0.08/s)                                |
 * | Dispersion    | vorticity confinement + seeded scatter of the push          |
 * | Brightness    | exposure and saturation of the dye (highlights glow white)  |
 * | Intensity     | force gain (how much of the movement's speed the water gets)|
 * | Density       | dye released per unit of movement                           |
 * | Range         | projection scale (compressed ↔ magnified)                   |
 * | Palette       | direction → dye color                                       |
 * | Surface light | shading, refraction and glints from the dye's thickness     |
 * | Hue           | turn of the dye's colors about grey, where it is drawn      |
 *
 * The signature field drives force and dye everywhere it moves: the per-cell speed is the
 * spatially resolved `energy` feature, so energy → dye emission falls out directly.
 */
import { readProperty } from '../../properties';
import type { PropertyValues } from '../../types';
import type { FluidDisplayParams, FluidStepParams } from '../shared/fluid';
import { hueTurns } from '../shared/hue';
import { waterProperty } from './properties';

export type WaterStepParams = Omit<
  FluidStepParams,
  'dt' | 'jitterPhaseX' | 'jitterPhaseY' | 'patternSeed'
>;

export interface WaterParams {
  step: WaterStepParams;
  display: FluidDisplayParams;
  /** Index into WATER_PALETTE_BYTES. */
  palette: number;
}

const VISCOSITY = waterProperty('viscosity');
const PERSISTENCE = waterProperty('persistence');
const DISPERSION = waterProperty('dispersion');
const BRIGHTNESS = waterProperty('brightness');
const INTENSITY = waterProperty('intensity');
const DENSITY = waterProperty('density');
const RANGE = waterProperty('range');
const PALETTE = waterProperty('palette');
const SURFACE_LIGHT = waterProperty('surfaceLight');
const HUE = waterProperty('hue');

/** ν at Viscosity 1, (short side)²/s. Low for water; Honey uses a much higher range. */
export const WATER_MAX_VISCOSITY = 6e-3;

/** Viscosity 0..1 → ν: zero at 0, exponential above (each step feels alike). */
export function waterViscosity(v: number): number {
  if (v <= 0) return 0;
  const k = 300;
  return (WATER_MAX_VISCOSITY * (k ** v - 1)) / (k - 1);
}

/** Persistence 0..1 → dye fade rate, 1/s: 3/s (gone in a blink) → 0.5/s → ~0.08/s. */
export function waterDyeDissipation(p: number): number {
  return 0.5 * 6 ** (1 - 2 * p);
}

/** Intensity 0..1 → force gain, 1/s (a quarter to four times the baseline of 6/s). */
export function waterForceGain(i: number): number {
  return 6 * 4 ** (2 * i - 1);
}

/** Density 0..1 → dye released per unit of movement (a third to three times 4). */
export function waterDyeAmount(d: number): number {
  return 4 * 3 ** (2 * d - 1);
}

export function waterParams(props: PropertyValues): WaterParams {
  const viscosity = readProperty(props, VISCOSITY);
  const persistence = readProperty(props, PERSISTENCE);
  const dispersion = readProperty(props, DISPERSION);
  const brightness = readProperty(props, BRIGHTNESS);
  const intensity = readProperty(props, INTENSITY);
  const density = readProperty(props, DENSITY);
  const range = readProperty(props, RANGE);
  const palette = readProperty(props, PALETTE);
  const surfaceLight = readProperty(props, SURFACE_LIGHT);

  const nu = waterViscosity(viscosity);
  return {
    step: {
      range,
      forceGain: waterForceGain(intensity),
      // Thicker water lags a little behind the movement.
      forceLowPassSec: 0.12 * viscosity * viscosity,
      jitterAngle: 1.1 * dispersion * dispersion,
      jitterOffset: 0.05 * dispersion * dispersion,
      jitterFrequency: 3,
      dyeAmount: waterDyeAmount(density),
      // Dye leaves from a scatter of spots, so it draws streaks along the flow; more
      // density covers more of the water.
      dyeSpots: 0.7,
      dyeSpotCoverage: 0.25 + 0.5 * density,
      dyeDissipation: waterDyeDissipation(persistence),
      // Thicker water drags: its movement dies away sooner.
      velocityDissipation: 0.12 + 1.6 * viscosity * viscosity,
      viscosity: nu,
      viscosityIterations: nu > 0 ? Math.round(4 + 8 * viscosity) : 0,
      // Thick water can't hold fine swirls, whatever the dispersion.
      vorticity: 0.42 * dispersion * (1 - 0.5 * viscosity),
    },
    display: {
      exposure: 2 ** (2.4 * (brightness - 0.5)),
      saturation: 0.7 + 0.65 * brightness,
      surfaceLight,
      hue: hueTurns(readProperty(props, HUE)),
    },
    palette,
  };
}
