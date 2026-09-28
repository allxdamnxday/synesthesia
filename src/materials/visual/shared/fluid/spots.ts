/**
 * The seeded pattern of dye-release spots (see DYE_FRAGMENT). Generated on the CPU with
 * the seeded PRNG, so a seed gives the same pattern on every machine.
 *
 * The texture tiles once per canvas short side. Channel R is the spot profile (a soft
 * round Gaussian around a jittered point in each cell, 0..1); channel G is that spot's
 * random rank, so the shader can show only the spots whose rank is below a coverage
 * value (more density, more spots) without regenerating the texture.
 */
import { createRng } from '../../../../chance/prng';

export const SPOT_TEXTURE_SIZE = 256;
/** Spot cells per tile (per canvas short side). */
export const SPOT_CELLS = 22;
/** Spot radius (Gaussian sigma), in cells. */
export const SPOT_SIGMA = 0.3;
/**
 * Mean of the R channel when every spot shows: a Gaussian's integral over its cell
 * (2πσ²; the tails into neighbours average out).
 */
export const SPOT_MEAN = 2 * Math.PI * SPOT_SIGMA * SPOT_SIGMA;

/** RG8 bytes, SPOT_TEXTURE_SIZE² texels, row 0 at the bottom (GL order). */
export function generateSpotTexture(
  seed: number,
  size = SPOT_TEXTURE_SIZE,
  cells = SPOT_CELLS,
  sigma = SPOT_SIGMA,
): Uint8Array {
  const rng = createRng(seed >>> 0);
  const count = cells * cells;
  const sx = new Float64Array(count);
  const sy = new Float64Array(count);
  const rank = new Float64Array(count);
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const k = j * cells + i;
      sx[k] = i + 0.2 + 0.6 * rng();
      sy[k] = j + 0.2 + 0.6 * rng();
      rank[k] = rng();
    }
  }
  const out = new Uint8Array(size * size * 2);
  const inv2s2 = 1 / (2 * sigma * sigma);
  for (let y = 0; y < size; y++) {
    const v = ((y + 0.5) / size) * cells;
    const cy = Math.floor(v);
    for (let x = 0; x < size; x++) {
      const u = ((x + 0.5) / size) * cells;
      const cx = Math.floor(u);
      let best = 0;
      let bestRank = 1;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          // Wrap so the texture tiles seamlessly.
          const ci = (((cx + dx) % cells) + cells) % cells;
          const cj = (((cy + dy) % cells) + cells) % cells;
          const k = cj * cells + ci;
          const px = sx[k] + (cx + dx - ci);
          const py = sy[k] + (cy + dy - cj);
          const d2 = (u - px) * (u - px) + (v - py) * (v - py);
          const g = Math.exp(-d2 * inv2s2);
          if (g > best) {
            best = g;
            bestRank = rank[k];
          }
        }
      }
      const o = (y * size + x) * 2;
      out[o] = Math.round(best * 255);
      out[o + 1] = Math.round(bestRank * 255);
    }
  }
  return out;
}
