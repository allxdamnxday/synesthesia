/**
 * Water's dye palettes. Each gives every direction of movement its own color (0 turns =
 * rightward, ¼ = upward, ½ = leftward, ¾ = downward), so a wink's close (down) and open
 * (up) arrive in two different colors.
 */
import { buildPalette, hsvToRgb, type PaletteStop } from '../shared/fluid';

/** Deep water: teal, sea-glass, blue and ultramarine. */
const DEEP_WATER: PaletteStop[] = [
  { turn: 0, color: [0.1, 0.62, 0.74] },
  { turn: 0.25, color: [0.42, 0.95, 0.84] },
  { turn: 0.5, color: [0.2, 0.45, 1] },
  { turn: 0.75, color: [0.36, 0.26, 1] },
];

/** Ink: silvery, low-saturation greys lit from above; pearl rising, slate falling. */
const INK: PaletteStop[] = [
  { turn: 0, color: [0.6, 0.66, 0.76] },
  { turn: 0.25, color: [0.95, 0.9, 0.8] },
  { turn: 0.5, color: [0.64, 0.58, 0.78] },
  { turn: 0.75, color: [0.42, 0.48, 0.7] },
];

/** Prism: the full spectrum around the circle of directions. */
const prism = (turn: number) => hsvToRgb(turn, 0.8, 1);

/** Palette texture bytes by the `palette` choice index. */
export const WATER_PALETTE_BYTES: readonly Uint8Array[] = [
  buildPalette(DEEP_WATER),
  buildPalette(INK),
  buildPalette(prism),
];
