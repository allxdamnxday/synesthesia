/**
 * Read the frame-index barcode drawn by scripts/make-spike-clips.mjs: 12 equal-width
 * blocks across the displayed frame (most significant bit on the left, white = 1) in rows
 * 0..H/4, and the same blocks inverted in rows H/4..H/2. Returns null for a bad read (a
 * block and its inverse agree, or the picture is the wrong way round).
 */
export const BARCODE_BITS = 12;

export function readBarcode(rgba: Uint8ClampedArray, width: number, height: number): number | null {
  const barH = Math.floor(height / 4);
  const mean = (x0: number, x1: number, y0: number, y1: number): number => {
    let sum = 0;
    let n = 0;
    for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
      for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
        const i = (y * width + x) * 4;
        sum += ((rgba[i] ?? 0) + (rgba[i + 1] ?? 0) + (rgba[i + 2] ?? 0)) / 3;
        n++;
      }
    }
    return n > 0 ? sum / n : 0;
  };
  let value = 0;
  for (let bit = 0; bit < BARCODE_BITS; bit++) {
    const bx0 = (bit * width) / BARCODE_BITS;
    const bw = width / BARCODE_BITS;
    const x0 = bx0 + 0.25 * bw;
    const x1 = bx0 + 0.75 * bw;
    const top = mean(x0, x1, 0.25 * barH, 0.75 * barH);
    const bottom = mean(x0, x1, barH + 0.25 * barH, barH + 0.75 * barH);
    const on = top > 128;
    const inverseOn = bottom > 128;
    if (on === inverseOn || Math.abs(top - bottom) < 64) return null;
    value = (value << 1) | (on ? 1 : 0);
  }
  return value;
}
