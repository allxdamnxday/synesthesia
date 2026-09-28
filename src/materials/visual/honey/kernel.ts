/**
 * The Gaussian diffusion kernel behind Honey's viscosity. Pure, so it is unit tested.
 *
 * Viscous diffusion over one step is exactly a Gaussian blur of the velocity with
 * variance 2·ν·dt (the heat kernel). At honey viscosities the solver's Jacobi iterations
 * can't converge (α = ν·dt/h² is large), so Honey applies the kernel directly: a
 * separable blur, 2 × (2·BLUR_TAPS + 1) texture reads per cell, whatever the width.
 */

/** Taps on each side of the centre. */
export const BLUR_TAPS = 4;

export interface BlurKernel {
  /** Distance between taps, in texels (taps between texels read bilinearly). */
  spacing: number;
  /** Weights for the centre tap and taps 1..BLUR_TAPS on each side; they sum to 1. */
  weights: number[];
}

/** Standard deviation of one step's viscous diffusion, in texels. */
export function diffusionSigmaTexels(viscosity: number, dt: number, shortCells: number): number {
  const nu = Number.isFinite(viscosity) ? Math.max(0, viscosity) : 0;
  return Math.sqrt(2 * nu * Math.max(0, dt)) * Math.max(0, shortCells);
}

/**
 * Tap spacing and weights for a Gaussian of `sigma` texels. The taps reach ±3σ (never
 * closer together than half a texel), and the weights are the Gaussian at the taps,
 * normalized.
 */
export function gaussianKernel(sigma: number): BlurKernel {
  const weights = new Array<number>(BLUR_TAPS + 1).fill(0);
  if (!(sigma > 1e-3) || !Number.isFinite(sigma)) {
    weights[0] = 1;
    return { spacing: 0, weights };
  }
  const spacing = Math.max(0.5, (3 * sigma) / BLUR_TAPS);
  let sum = 0;
  for (let k = 0; k <= BLUR_TAPS; k++) {
    const x = k * spacing;
    const w = Math.exp(-(x * x) / (2 * sigma * sigma));
    weights[k] = w;
    sum += k === 0 ? w : 2 * w;
  }
  for (let k = 0; k <= BLUR_TAPS; k++) weights[k] = (weights[k] ?? 0) / sum;
  return { spacing, weights };
}

/** Variance (texels²) of the discrete kernel: what it actually diffuses per step. */
export function kernelVariance(kernel: BlurKernel): number {
  let v = 0;
  for (let k = 1; k <= BLUR_TAPS; k++) {
    const x = k * kernel.spacing;
    v += 2 * (kernel.weights[k] ?? 0) * x * x;
  }
  return v;
}
