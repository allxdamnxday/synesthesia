/**
 * Direction palettes for dye. A palette gives each direction of push its own colour, so
 * the wake shows which way the movement went (the wink's close and open read as two
 * colours). Stored as a PALETTE_SIZE × 1 RGBA texture indexed by angle.
 */
/** Palette textures have this many entries around the circle of directions. */
export const PALETTE_SIZE = 64;

export type Rgb = readonly [number, number, number];

export interface PaletteStop {
  /** Direction in turns: 0 = right, 0.25 = up, 0.5 = left, 0.75 = down. */
  turn: number;
  /** 0..1 */
  color: Rgb;
}

const toByte = (x: number): number => Math.round(Math.min(1, Math.max(0, x)) * 255);

/** Colour at a direction (turns), interpolating cyclically between sorted stops. */
export function paletteColorAt(stops: readonly PaletteStop[], turn: number): Rgb {
  if (stops.length === 0) return [1, 1, 1];
  const sorted = [...stops].sort((a, b) => a.turn - b.turn);
  const t = ((turn % 1) + 1) % 1;
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    const b = sorted[(i + 1) % sorted.length];
    const start = a.turn;
    const end = i + 1 < sorted.length ? b.turn : b.turn + 1;
    const x = t < start ? t + 1 : t;
    if (x >= start && x <= end) {
      const k = end > start ? (x - start) / (end - start) : 0;
      const s = k * k * (3 - 2 * k);
      return [
        a.color[0] + (b.color[0] - a.color[0]) * s,
        a.color[1] + (b.color[1] - a.color[1]) * s,
        a.color[2] + (b.color[2] - a.color[2]) * s,
      ];
    }
  }
  return sorted[0].color;
}

/** Build palette texture bytes from stops or a function of direction (turns). */
export function buildPalette(source: readonly PaletteStop[] | ((turn: number) => Rgb)): Uint8Array {
  const bytes = new Uint8Array(PALETTE_SIZE * 4);
  for (let i = 0; i < PALETTE_SIZE; i++) {
    const turn = (i + 0.5) / PALETTE_SIZE;
    const [r, g, b] = typeof source === 'function' ? source(turn) : paletteColorAt(source, turn);
    bytes[i * 4] = toByte(r);
    bytes[i * 4 + 1] = toByte(g);
    bytes[i * 4 + 2] = toByte(b);
    bytes[i * 4 + 3] = 255;
  }
  return bytes;
}

/** HSV (all 0..1) to RGB. */
export function hsvToRgb(h: number, s: number, v: number): Rgb {
  const hh = (((h % 1) + 1) % 1) * 6;
  const i = Math.floor(hh);
  const f = hh - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i) {
    case 0:
      return [v, t, p];
    case 1:
      return [q, v, p];
    case 2:
      return [p, v, t];
    case 3:
      return [p, q, v];
    case 4:
      return [t, p, v];
    default:
      return [v, p, q];
  }
}

/** Relative luminance of a display colour (Rec. 709 weights). */
export function luminance(c: Rgb): number {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
