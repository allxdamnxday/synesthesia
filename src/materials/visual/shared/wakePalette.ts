/**
 * Direction colors for the particle and strand materials (Descending bubbles, Filaments).
 * They match Water's "Deep water" palette, so the same movement reads in the same colors
 * across materials: ultramarine falling, sea-glass rising, teal to the right, blue to the
 * left. A wink's close and open arrive in two different colors in every material.
 */
import { PALETTE_SIZE, buildPalette, type PaletteStop } from './fluid/palette';

export const WAKE_DIRECTION_STOPS: readonly PaletteStop[] = [
  { turn: 0, color: [0.1, 0.62, 0.74] },
  { turn: 0.25, color: [0.42, 0.95, 0.84] },
  { turn: 0.5, color: [0.2, 0.45, 1] },
  { turn: 0.75, color: [0.36, 0.26, 1] },
];

/** PALETTE_SIZE × 1 RGBA bytes: entry i is the color for direction (i + 0.5) / size turns. */
export const WAKE_PALETTE_BYTES: Uint8Array = buildPalette(WAKE_DIRECTION_STOPS);

export { PALETTE_SIZE };
