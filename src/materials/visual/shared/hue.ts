/**
 * Hue: turning a material's colors around the color wheel (docs/DECISIONS.md, 2026-10-01).
 *
 * The turn is a rotation of RGB about the grey axis. Greys and white stay as they are,
 * black stays black, and any two colors stay exactly as far apart as they were, so a
 * wink's close and open still read as two colors. It is linear, so turning what a material
 * has already laid down (dye, ribbons) gives the same picture as turning its palette
 * first: materials apply it where they draw, never where they step, and it shows at once
 * while paused.
 *
 * A rotation about the grey axis mixes each channel with the other two by the same three
 * weights: out = k·rgb + n·gbr + p·brg.
 */
import type { Rgb } from './fluid/palette';

/** Hue property value 0..1 (0.5 = the material's own colors) → turns, 0..1 (0 = no turn). */
export function hueTurns(value: number): number {
  return (value + 0.5) % 1;
}

function weights(turns: number): [number, number, number] {
  const t = Number.isFinite(turns) ? turns - Math.floor(turns) : 0;
  if (t === 0) return [1, 0, 0];
  const angle = 2 * Math.PI * t;
  const c = Math.cos(angle);
  const s = Math.sin(angle) / Math.sqrt(3);
  const m = (1 - c) / 3;
  return [(1 + 2 * c) / 3, m - s, m + s];
}

/**
 * The three weights of a turn (1 = all the way round): how much each channel keeps of
 * itself, takes from the next channel (red from green, green from blue, blue from red)
 * and takes from the one before. Exactly (1, 0, 0) for no turn. A third of a turn is
 * (0, 0, 1): red becomes green, green blue and blue red.
 */
export function hueWeights(turns: number, out: Float32Array = new Float32Array(3)): Float32Array {
  const [k, n, p] = weights(turns);
  out[0] = k;
  out[1] = n;
  out[2] = p;
  return out;
}

/** A color turned by `turns`: what the shader's turnHue does, for tests. */
export function turnHue(color: Rgb, turns: number): Rgb {
  const [k, n, p] = weights(turns);
  const [r, g, b] = color;
  return [k * r + n * g + p * b, k * g + n * b + p * r, k * b + n * r + p * g];
}

/**
 * GLSL for shaders that draw (never those that step): the weights and the turn of a linear
 * RGB color. With no turn the color comes back untouched, so a material at its baseline
 * does exactly the arithmetic it did before Hue existed. (The Signature view has a `uHue`
 * of its own, hence the name.)
 */
export const HUE_GLSL = /* glsl */ `
uniform vec3 uHueTurn;  // weights: kept, from the next channel, from the one before
vec3 turnHue (vec3 c) {
  if (uHueTurn.yz == vec2(0.0)) return c;
  return uHueTurn.x * c + uHueTurn.y * c.gbr + uHueTurn.z * c.brg;
}
`;

/** Sets `uHueTurn`, working the weights out again only when the turn changes. */
export class HueTurn {
  private turns = 0;
  private readonly weights = hueWeights(0);

  apply(gl: WebGL2RenderingContext, location: WebGLUniformLocation | null, turns: number): void {
    if (turns !== this.turns) {
      hueWeights(turns, this.weights);
      this.turns = turns;
    }
    gl.uniform3fv(location, this.weights);
  }
}
