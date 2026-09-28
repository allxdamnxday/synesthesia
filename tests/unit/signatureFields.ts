/** Synthetic vector fields for signature unit tests (field coordinates 0..1, y down). */

export type VectorFn = (x: number, y: number) => [number, number];

/** One frame: rows × cols × 2 values, sampled at cell centers. */
export function frameOf(cols: number, rows: number, fn: VectorFn): Float32Array {
  const out = new Float32Array(cols * rows * 2);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const [u, v] = fn((c + 0.5) / cols, (r + 0.5) / rows);
      out[(r * cols + c) * 2] = u;
      out[(r * cols + c) * 2 + 1] = v;
    }
  }
  return out;
}

/** frameCount frames, frame f given by fnAt(f). */
export function fieldOf(
  cols: number,
  rows: number,
  frameCount: number,
  fnAt: (f: number) => VectorFn,
): Float32Array {
  const out = new Float32Array(frameCount * cols * rows * 2);
  for (let f = 0; f < frameCount; f++) out.set(frameOf(cols, rows, fnAt(f)), f * cols * rows * 2);
  return out;
}

export const rightward: VectorFn = () => [1, 0];
export const upward: VectorFn = () => [0, -1];
export const still: VectorFn = () => [0, 0];
/** Linear radial field about the center: k > 0 expands, k < 0 contracts. */
export const radial =
  (k: number): VectorFn =>
  (x, y) => [k * (x - 0.5), k * (y - 0.5)];
/** Rigid rotation about the center; ω > 0 is clockwise on screen (y down). */
export const swirl =
  (omega: number): VectorFn =>
  (x, y) => [-omega * (y - 0.5), omega * (x - 0.5)];
