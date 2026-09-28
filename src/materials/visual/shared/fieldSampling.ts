/**
 * The signature's push at any point of a material's canvas, for CPU simulations
 * (particles, strands). It places the field exactly as the fluid solver's force shader
 * does (`shared/fluid/shaders.ts`, SIGNATURE_FORCE), so every material puts the movement
 * in the same place at the same size:
 *
 * - the Range projection (`projectField`): fitted inside the canvas at Range 0.5 with its
 *   aspect kept, compressed toward the centre below, magnified past the edges above;
 * - bilinear sampling like a LINEAR, CLAMP_TO_EDGE texture (texel centres at cell
 *   centres);
 * - faded out over the outermost half cell, so the field has no hard edge;
 * - converted from field diagonals per second (image y down) to canvas short sides per
 *   second (y up): one field diagonal is the projected field's diagonal on the canvas.
 *
 * World coordinates: canvas short sides, origin at the bottom left, y up. The canvas
 * spans [0, width / short] × [0, height / short], so a simulation looks the same at any
 * resolution with the same aspect ratio (a Draft preview and a 1080p render agree).
 */
import { projectField } from './fluid/projection';

/** A signature field as it arrives in a SignatureFrame. */
export interface FieldInput {
  /** rows × cols × 2 (u, v), row-major, top row first; field diagonals per second, y down. */
  field: Float32Array;
  cols: number;
  rows: number;
}

/** Canvas size in world units (short sides). */
export function worldSize(width: number, height: number): { width: number; height: number } {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const short = Math.min(w, h);
  return { width: w / short, height: h / short };
}

export class ProjectedField {
  /** Velocity from the last `sample()`, in short sides per second, y up. */
  u = 0;
  v = 0;
  /** Largest projected speed anywhere in the current frame, short sides per second. */
  maxSpeed = 0;

  private data = new Float32Array(0);
  private cols = 0;
  private rows = 0;
  /** Projected field rectangle, world units. */
  private x0 = 0;
  private y0 = 0;
  private invWidth = 0;
  private invHeight = 0;
  /** Short sides per field diagonal (the projected field's diagonal). */
  private diagonal = 0;
  private active = false;

  /** The projected field's rectangle in world units (for tests and diagnostics). */
  get rect(): { x: number; y: number; width: number; height: number; diagonal: number } {
    return {
      x: this.x0,
      y: this.y0,
      width: this.invWidth > 0 ? 1 / this.invWidth : 0,
      height: this.invHeight > 0 ? 1 / this.invHeight : 0,
      diagonal: this.diagonal,
    };
  }

  /**
   * Use this frame's field, projected with `range` onto a `width` × `height` canvas.
   * The field is copied (non-finite values become 0), so the frame can be reused.
   */
  set(input: FieldInput, range: number, width: number, height: number): void {
    const cols = Math.max(0, Math.floor(input.cols));
    const rows = Math.max(0, Math.floor(input.rows));
    this.cols = cols;
    this.rows = rows;
    this.u = 0;
    this.v = 0;
    if (cols < 1 || rows < 1) {
      this.active = false;
      this.maxSpeed = 0;
      return;
    }
    const n = cols * rows * 2;
    if (this.data.length !== n) this.data = new Float32Array(n);
    const available = Math.min(n, input.field.length);
    let max2 = 0;
    for (let i = 0; i < n; i += 2) {
      let a = i < available ? input.field[i] : 0;
      let b = i + 1 < available ? input.field[i + 1] : 0;
      if (!Number.isFinite(a)) a = 0;
      if (!Number.isFinite(b)) b = 0;
      this.data[i] = a;
      this.data[i + 1] = b;
      const m2 = a * a + b * b;
      if (m2 > max2) max2 = m2;
    }
    const world = worldSize(width, height);
    const rect = projectField(range, cols / rows, world.width / world.height);
    const w = rect.width * world.width;
    const h = rect.height * world.height;
    this.x0 = rect.x * world.width;
    this.y0 = rect.y * world.height;
    this.invWidth = w > 0 ? 1 / w : 0;
    this.invHeight = h > 0 ? 1 / h : 0;
    this.diagonal = Math.hypot(w, h);
    this.maxSpeed = Math.sqrt(max2) * this.diagonal;
    this.active = max2 > 0 && w > 0 && h > 0;
  }

  /**
   * Sample the push at world point (x, y). Writes the velocity to `u`, `v` (short sides
   * per second, y up; zero outside the projected field) and returns the edge fade (0..1).
   */
  sample(x: number, y: number): number {
    if (!this.active) {
      this.u = 0;
      this.v = 0;
      return 0;
    }
    const qx = (x - this.x0) * this.invWidth;
    const qy = (y - this.y0) * this.invHeight;
    const cols = this.cols;
    const rows = this.rows;
    // Fade over the outermost half cell (same as the fluid force shader).
    const ex = Math.min(qx, 1 - qx) * cols * 2;
    const ey = Math.min(qy, 1 - qy) * rows * 2;
    const e = ex < ey ? ex : ey;
    if (!(e > 0)) {
      this.u = 0;
      this.v = 0;
      return 0;
    }
    const t = e >= 1 ? 1 : e;
    const mask = t * t * (3 - 2 * t);
    // Texel space: column c's centre is at qx = (c + 0.5) / cols; row 0 is the top.
    const tx = qx * cols - 0.5;
    const ty = (1 - qy) * rows - 0.5;
    let c0 = Math.floor(tx);
    let r0 = Math.floor(ty);
    const fx = tx - c0;
    const fy = ty - r0;
    let c1 = c0 + 1;
    let r1 = r0 + 1;
    if (c0 < 0) c0 = 0;
    if (c1 < 0) c1 = 0;
    if (c0 > cols - 1) c0 = cols - 1;
    if (c1 > cols - 1) c1 = cols - 1;
    if (r0 < 0) r0 = 0;
    if (r1 < 0) r1 = 0;
    if (r0 > rows - 1) r0 = rows - 1;
    if (r1 > rows - 1) r1 = rows - 1;
    const d = this.data;
    const i00 = (r0 * cols + c0) * 2;
    const i01 = (r0 * cols + c1) * 2;
    const i10 = (r1 * cols + c0) * 2;
    const i11 = (r1 * cols + c1) * 2;
    const uTop = d[i00] + (d[i01] - d[i00]) * fx;
    const uBottom = d[i10] + (d[i11] - d[i10]) * fx;
    const vTop = d[i00 + 1] + (d[i01 + 1] - d[i00 + 1]) * fx;
    const vBottom = d[i10 + 1] + (d[i11 + 1] - d[i10 + 1]) * fx;
    const scale = this.diagonal * mask;
    this.u = (uTop + (uBottom - uTop) * fy) * scale;
    // Image y points down; world y points up.
    this.v = -(vTop + (vBottom - vTop) * fy) * scale;
    return mask;
  }
}
