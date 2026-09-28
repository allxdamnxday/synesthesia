/**
 * Resonant glide for control programs: an RBJ low-pass biquad run at the control rate on a
 * control value (a pitch in semitones, a filter position in semitones, …).
 *
 * `glideSec` is roughly the 90% rise time with no overshoot at Q 0.5 (critically damped);
 * a higher Q rings past the target, which is how materials express Elasticity's "bounce and
 * overshoot". It is the same filter as A1 Water's pitch glide (water/program.ts), shared here
 * for the materials that came after it.
 *
 * The memory lives in the material's own flat state object (so `ControlProgram.copy` can
 * copy it with the rest), through the `GlideMemory` fields. Pure; no allocation per step.
 */

export interface GlideCoefficients {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** The four memory fields of one glide (Direct Form I). */
export interface GlideMemory {
  gx1: number;
  gx2: number;
  gy1: number;
  gy2: number;
}

/** Coefficients that pass the input straight through (no glide). */
export const IDENTITY_GLIDE: Readonly<GlideCoefficients> = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };

export function glideCoefficients(glideSec: number, q: number, dt: number): GlideCoefficients {
  const rate = 1 / dt;
  const fc = Math.min(0.4 * rate, 0.62 / Math.max(1e-3, glideSec));
  const w0 = (2 * Math.PI * fc) / rate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Math.max(0.1, q));
  const a0 = 1 + alpha;
  return {
    b0: (1 - cos) / 2 / a0,
    b1: (1 - cos) / a0,
    b2: (1 - cos) / 2 / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
}

/**
 * Advance one glide by one control step towards `target` and return the glided value.
 * Direct Form I, so it stays well behaved when the coefficients change live.
 */
export function glideStep(c: Readonly<GlideCoefficients>, m: GlideMemory, target: number): number {
  const y = c.b0 * target + c.b1 * m.gx1 + c.b2 * m.gx2 - c.a1 * m.gy1 - c.a2 * m.gy2;
  m.gx2 = m.gx1;
  m.gx1 = target;
  m.gy2 = m.gy1;
  m.gy1 = y;
  return y;
}

/** Put a glide at rest on `value` (as if it had been there for ever). */
export function glideRestAt(m: GlideMemory, value: number): void {
  m.gx1 = value;
  m.gx2 = value;
  m.gy1 = value;
  m.gy2 = value;
}
