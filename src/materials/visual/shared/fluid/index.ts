/*
 * Shared fluid solver for Water, Honey and Smoke. Adapted from WebGL-Fluid-Simulation by
 * Pavel Dobryakov, MIT License, Copyright (c) 2017 Pavel Dobryakov
 * (LICENSE-webgl-fluid.txt).
 */
export {
  DEFAULT_STEP_PARAMS,
  FluidSolver,
  type FluidDisplayParams,
  type FluidHookContext,
  type FluidHooks,
  type FluidSolverOptions,
  type FluidStepParams,
  type SignatureField,
  type TexelSized,
} from './FluidSolver';
/** GLSL chunks for material passes run through the solver's hooks. */
export {
  COPY_FRAGMENT,
  PRECISION as FLUID_PRECISION_GLSL,
  SAMPLING as FLUID_SAMPLING_GLSL,
  SIGNATURE_FORCE as SIGNATURE_FORCE_GLSL,
} from './shaders';
export {
  FLUID_TIERS,
  MAX_VISCOSITY_ITERATIONS,
  RANGE_SCALE_MAX,
  RANGE_SCALE_MIN,
  REFERENCE_SHORT_CELLS,
  diffusionAlpha,
  dyeGridForCanvas,
  fieldDiagonalInCells,
  gridForCanvas,
  projectField,
  rangeScale,
  tierIterations,
  type GridSize,
  type ProjectionRect,
} from './projection';
export { SPOT_CELLS, SPOT_MEAN, SPOT_SIGMA, generateSpotTexture } from './spots';
export {
  PALETTE_SIZE,
  buildPalette,
  hsvToRgb,
  luminance,
  paletteColorAt,
  type PaletteStop,
  type Rgb,
} from './palette';
