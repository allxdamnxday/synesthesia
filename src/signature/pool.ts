/**
 * Pool per-pixel optical flow into the signature grid and convert units
 * (SPEC 8.1 steps 6–7).
 *
 * Units: Farneback gives pixels per frame in the analysis frame. The signature stores
 * **field diagonals per second**: displacement ÷ the analysis frame's diagonal × fps. A
 * small wink boxed by a focus area therefore reads like a large gesture filling a frame.
 */

export const MIN_GRID_COLS = 4;
export const MAX_GRID_COLS = 64;
export const MIN_GRID_ROWS = 8;
export const MAX_GRID_ROWS = 48;

/** Grid for an analysis frame: `cols` (default 32), rows = round(cols × h / w), 8–48. */
export function gridSize(
  colsOption: number,
  width: number,
  height: number,
): { cols: number; rows: number } {
  const cols = Math.round(
    Math.min(MAX_GRID_COLS, Math.max(MIN_GRID_COLS, Number.isFinite(colsOption) ? colsOption : 32)),
  );
  const rows = Math.round(
    Math.min(MAX_GRID_ROWS, Math.max(MIN_GRID_ROWS, Math.round((cols * height) / width))),
  );
  return { cols, rows };
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
