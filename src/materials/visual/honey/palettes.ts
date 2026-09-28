/**
 * Honey's palettes. As in Water, every direction of movement has its own color (0 turns
 * = rightward, ¼ = upward, ½ = leftward, ¾ = downward), so a wink's close (down) and
 * open (up) fold two different shades into the honey; here they stay within honey tones.
 */
import { buildPalette, type PaletteStop } from '../shared/fluid';

/** Amber: deep amber falling, pale gold rising, honey orange and gold to the sides. */
export const AMBER: PaletteStop[] = [
  { turn: 0, color: [0.96, 0.52, 0.1] },
  { turn: 0.25, color: [1, 0.8, 0.36] },
  { turn: 0.5, color: [0.93, 0.66, 0.2] },
  { turn: 0.75, color: [0.8, 0.32, 0.05] },
];

/** Dark honey: buckwheat and chestnut; mahogany falling, burnt orange rising. */
export const DARK_HONEY: PaletteStop[] = [
  { turn: 0, color: [0.78, 0.34, 0.07] },
  { turn: 0.25, color: [0.95, 0.56, 0.14] },
  { turn: 0.5, color: [0.72, 0.4, 0.1] },
  { turn: 0.75, color: [0.58, 0.2, 0.05] },
];

/** Pale gold: acacia and clover honey; warm gold falling, cream rising. */
export const PALE_GOLD: PaletteStop[] = [
  { turn: 0, color: [1, 0.8, 0.42] },
  { turn: 0.25, color: [1, 0.92, 0.64] },
  { turn: 0.5, color: [0.96, 0.84, 0.5] },
  { turn: 0.75, color: [0.92, 0.6, 0.2] },
];

/** Palette texture bytes by the `palette` choice index. */
export const HONEY_PALETTE_BYTES: readonly Uint8Array[] = [
  buildPalette(AMBER),
  buildPalette(DARK_HONEY),
  buildPalette(PALE_GOLD),
];
