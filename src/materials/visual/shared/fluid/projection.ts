/**
 * Pure geometry for projecting a signature field onto a material's canvas (SPEC 9.2
 * Range) and for sizing the fluid grids by quality tier (SPEC 14.2). No GL here, so it
 * is unit tested directly.
 *
 * Coordinates: "canvas-normalized" means 0..1 across the canvas on each axis with the
 * origin at the bottom left (GL texture convention, y up).
 */
import type { Quality } from '../../../types';

/** Range 0: the movement occupies this fraction of its fitted size (compressed). */
export const RANGE_SCALE_MIN = 0.4;
/** Range 1: the movement is magnified this much beyond its fitted size (expanded). */
export const RANGE_SCALE_MAX = 2.5;

/**
 * How much the projected field is scaled relative to fitting the canvas, for Range 0..1.
 * Exponential, so equal slider steps feel like equal zoom steps; Range 0.5 gives 1.
 */
export function rangeScale(range: number): number {
  const r = Number.isFinite(range) ? Math.min(1, Math.max(0, range)) : 0.5;
  return r < 0.5 ? RANGE_SCALE_MIN ** ((0.5 - r) * 2) : RANGE_SCALE_MAX ** ((r - 0.5) * 2);
}

export interface ProjectionRect {
  /** Bottom-left corner, canvas-normalized. */
  x: number;
  y: number;
  /** Size, canvas-normalized. */
  width: number;
  height: number;
}

/**
 * Where the signature field lands on the canvas. At Range 0.5 the field is fitted
 * (contained) with its aspect ratio kept, so directions are never distorted and nothing
 * is cropped; it fills the canvas whenever the aspect ratios match. Lower Range shrinks it
 * toward the centre (compressed); higher Range magnifies it past the edges (expanded).
 * Outside the rectangle the signature exerts no force.
 *
 * @param fieldAspect grid columns / rows (the analysis frame's aspect ratio)
 * @param canvasAspect canvas width / height
 */
export function projectField(
  range: number,
  fieldAspect: number,
  canvasAspect: number,
): ProjectionRect {
  const fa = fieldAspect > 0 && Number.isFinite(fieldAspect) ? fieldAspect : 1;
  const ca = canvasAspect > 0 && Number.isFinite(canvasAspect) ? canvasAspect : 1;
  let width = 1;
  let height = 1;
  if (fa > ca) height = ca / fa;
  else width = fa / ca;
  const s = rangeScale(range);
  width *= s;
  height *= s;
  return { x: 0.5 - width / 2, y: 0.5 - height / 2, width, height };
}

/**
 * Signature velocities are in field diagonals per second. This returns how many grid
 * cells (of a grid `gridWidth` × `gridHeight` spanning the canvas) one field diagonal
 * covers once projected, i.e. the factor that turns a signature velocity into grid
 * cells per second. It grows with Range: a magnified movement travels further.
 */
export function fieldDiagonalInCells(
  rect: ProjectionRect,
  gridWidth: number,
  gridHeight: number,
): number {
  return Math.hypot(rect.width * gridWidth, rect.height * gridHeight);
}

/** Fluid grid sizes by quality tier (SPEC 14.2): the short side of each grid, in cells. */
export const FLUID_TIERS: Readonly<
  Record<Quality, { sim: number; dye: number; pressureIterations: number }>
> = {
  draft: { sim: 64, dye: 256, pressureIterations: 16 },
  standard: { sim: 128, dye: 512, pressureIterations: 20 },
  high: { sim: 256, dye: 1024, pressureIterations: 28 },
};

export interface GridSize {
  width: number;
  height: number;
}

/**
 * Grid size for a canvas: the short side gets `base` cells and the long side is scaled
 * by the aspect ratio (as in the original solver), capped at `maxSize` per side.
 */
export function gridForCanvas(
  base: number,
  canvasWidth: number,
  canvasHeight: number,
  maxSize = 4096,
): GridSize {
  const w = Math.max(1, canvasWidth);
  const h = Math.max(1, canvasHeight);
  const aspect = w >= h ? w / h : h / w;
  const short = Math.max(1, Math.round(base));
  const long = Math.min(maxSize, Math.max(short, Math.round(base * aspect)));
  return w >= h ? { width: long, height: short } : { width: short, height: long };
}

/**
 * Dye grid for a canvas: the tier's dye resolution, but never finer than the canvas
 * itself (small previews don't pay for detail they can't show) and never coarser than
 * the simulation grid.
 */
export function dyeGridForCanvas(
  quality: Quality,
  canvasWidth: number,
  canvasHeight: number,
  maxSize = 4096,
): GridSize {
  const tier = FLUID_TIERS[quality];
  const canvasShort = Math.max(1, Math.min(canvasWidth, canvasHeight));
  const base = Math.max(tier.sim, Math.min(tier.dye, canvasShort));
  return gridForCanvas(base, canvasWidth, canvasHeight, maxSize);
}

/**
 * Implicit viscous diffusion (backward Euler, solved with Jacobi iterations) uses
 * alpha = ν·dt/h². With ν in (canvas short side)²/s and h = 1/shortCells, that is
 * ν·dt·shortCells².
 */
export function diffusionAlpha(viscosity: number, dt: number, shortCells: number): number {
  return Math.max(0, viscosity) * dt * shortCells * shortCells;
}

/** Grid size (short side) that viscosity iteration counts are specified for. */
export const REFERENCE_SHORT_CELLS = FLUID_TIERS.standard.sim;
/** Most viscosity iterations per step at any tier. */
export const MAX_VISCOSITY_ITERATIONS = 64;

/**
 * Scale a viscosity iteration count given for the Standard grid to another grid. For the
 * large-α case the low-frequency error shrinks per iteration by about 1/(4α) and α grows
 * with the square of the grid, so the count does too; this keeps the viscous look the same
 * at every tier (draft needs a quarter, high four times as many).
 */
export function tierIterations(standardIterations: number, shortCells: number): number {
  if (!(standardIterations > 0)) return 0;
  const ratio = shortCells / REFERENCE_SHORT_CELLS;
  return Math.min(
    MAX_VISCOSITY_ITERATIONS,
    Math.max(1, Math.round(standardIterations * ratio * ratio)),
  );
}
