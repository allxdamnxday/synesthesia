/**
 * Pool per-pixel optical flow into the signature grid and convert units
 * (SPEC 8.1 steps 6–7).
 *
 * Units: Farneback gives pixels per frame in the analysis frame. The signature stores
 * **field diagonals per second**: displacement ÷ the analysis frame's diagonal × fps. A
 * small wink boxed by a focus area therefore reads like a large gesture filling a frame.
 */

/** Fewest cells along either side of the grid. */
export const MIN_GRID_CELLS = 8;
/** Most cells along the longer side (the `gridCols` option). */
export const MAX_GRID_LONG = 64;
/** Most cells along the shorter side. */
export const MAX_GRID_SHORT = 48;

/**
 * Grid for an analysis frame (SPEC 8.1 step 7, adjusted like the analysis size; see
 * DECISIONS): the `gridCols` option (default 32, 8–64) sets the cells along the **longer**
 * side, and the shorter side gets round(gridCols × short / long), clamped 8–48. Landscape
 * is unchanged (320×180 → 32×18); portrait mirrors it (180×320 → 18×32), so a portrait
 * signature is the same size and shape of work as a landscape one. `cols` always count
 * across (x) and `rows` down (y).
 */
export function gridSize(
  colsOption: number,
  width: number,
  height: number,
): { cols: number; rows: number } {
  const long = Math.round(
    Math.min(
      MAX_GRID_LONG,
      Math.max(MIN_GRID_CELLS, Number.isFinite(colsOption) ? colsOption : 32),
    ),
  );
  const landscape = !(height > width);
  const ratio = width > 0 && height > 0 ? Math.min(width, height) / Math.max(width, height) : 1;
  const short = Math.round(
    Math.min(MAX_GRID_SHORT, Math.max(MIN_GRID_CELLS, Math.round(long * ratio))),
  );
  return landscape ? { cols: long, rows: short } : { cols: short, rows: long };
}

/** Pixel range [start, end) of cell `index` of `count` cells over `size` pixels (≥ 1 px). */
export function cellRange(index: number, count: number, size: number): [number, number] {
  const start = Math.min(size - 1, Math.floor((index * size) / count));
  const end = Math.max(start + 1, Math.min(size, Math.floor(((index + 1) * size) / count)));
  return [start, end];
}

/** Scale from pixels per frame to field diagonals per second. */
export function flowUnitScale(width: number, height: number, fps: number): number {
  return fps / Math.hypot(width, height);
}

/**
 * Average `flow` (width × height × 2 interleaved u, v in px/frame, row-major) over each
 * of cols × rows cells and write field diagonals per second into `out` (rows × cols × 2).
 */
export function poolFlow(
  flow: ArrayLike<number>,
  width: number,
  height: number,
  cols: number,
  rows: number,
  fps: number,
  out: Float32Array,
): Float32Array {
  if (flow.length < width * height * 2) throw new Error('Flow buffer is too small');
  if (out.length < cols * rows * 2) throw new Error('Output buffer is too small');
  const scale = flowUnitScale(width, height, fps);
  for (let r = 0; r < rows; r++) {
    const [y0, y1] = cellRange(r, rows, height);
    for (let c = 0; c < cols; c++) {
      const [x0, x1] = cellRange(c, cols, width);
      let su = 0;
      let sv = 0;
      for (let y = y0; y < y1; y++) {
        let i = (y * width + x0) * 2;
        for (let x = x0; x < x1; x++, i += 2) {
          su += flow[i];
          sv += flow[i + 1];
        }
      }
      const n = (y1 - y0) * (x1 - x0);
      const o = (r * cols + c) * 2;
      const u = (su / n) * scale;
      const v = (sv / n) * scale;
      out[o] = Number.isFinite(u) ? u : 0;
      out[o + 1] = Number.isFinite(v) ? v : 0;
    }
  }
  return out;
}
