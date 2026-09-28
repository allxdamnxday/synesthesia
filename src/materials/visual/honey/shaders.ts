/**
 * Honey's own passes, run through the fluid solver's hooks at simulation resolution.
 * Units: velocity in grid cells per second (as in the solver), displacement in canvas
 * short sides; texture coordinates have y up.
 */
import { FLUID_PRECISION_GLSL, FLUID_SAMPLING_GLSL } from '../shared/fluid';
import { BLUR_TAPS } from './kernel';

const blurBody = (withSpring: boolean) => /* glsl */ `
${FLUID_PRECISION_GLSL}
${FLUID_SAMPLING_GLSL}
in vec2 vUv;
uniform sampler2D uVelocity;
uniform vec2 uVelocityTexel;
uniform vec2 uStep;                       // canvas-normalized offset between taps
uniform float uWeights[${BLUR_TAPS + 1}];  // centre, then taps 1..${BLUR_TAPS} on each side
${
  withSpring
    ? `uniform sampler2D uDisplacement;  // short sides, same grid as velocity
uniform float uSpring;               // velocity change per short side of displacement
uniform float uMaxSpeed;             // cells per second`
    : ''
}
out vec4 fragColor;
void main () {
  vec2 v = sampleLinear(uVelocity, vUv, uVelocityTexel).xy * uWeights[0];
  for (int k = 1; k <= ${BLUR_TAPS}; k++) {
    vec2 o = uStep * float(k);
    vec2 a = sampleLinear(uVelocity, vUv + o, uVelocityTexel).xy;
    vec2 b = sampleLinear(uVelocity, vUv - o, uVelocityTexel).xy;
    v += (a + b) * uWeights[k];
  }
${
  withSpring
    ? `  // The spring pulls displaced honey back toward where it was.
  v -= uSpring * texture(uDisplacement, vUv).xy;
  float s = length(v);
  if (s > uMaxSpeed) v *= uMaxSpeed / s;`
    : ''
}
  fragColor = vec4(v, 0.0, 1.0);
}
`;

/**
 * Viscous diffusion, first half: a Gaussian blur of velocity along one axis. With large
 * taps spacing the reads fall between texels and are filtered bilinearly.
 */
export const BLUR_FRAGMENT = blurBody(false);

/**
 * Viscous diffusion, second half (the other axis), plus the elastic spring −k·D and a
 * speed limit, in the same pass.
 */
export const BLUR_SPRING_FRAGMENT = blurBody(true);

/**
 * Displacement: how far the honey at each point has moved from where it rested. It is
 * carried with the flow (semi-Lagrangian) and integrates velocity, D ← D(x − v·dt) + v·dt,
 * slowly relaxing (the honey accepts its new shape) and limited in size.
 */
export const DISPLACEMENT_FRAGMENT = /* glsl */ `
${FLUID_PRECISION_GLSL}
${FLUID_SAMPLING_GLSL}
in vec2 vUv;
uniform sampler2D uVelocity;
uniform sampler2D uDisplacement;
uniform vec2 uTexel;              // simulation texel (velocity and displacement share it)
uniform float uDt;
uniform float uDecay;             // exp(−relax·dt)
uniform float uCellToShort;       // 1 / simulation cells per short side
uniform float uMaxDisplacement;   // short sides
out vec4 fragColor;
void main () {
  vec2 v = texture(uVelocity, vUv).xy;
  vec2 coord = vUv - uDt * v * uTexel;
  vec2 d = sampleLinear(uDisplacement, coord, uTexel).xy * uDecay + v * (uDt * uCellToShort);
  float m = length(d);
  if (m > uMaxDisplacement) d *= uMaxDisplacement / m;
  fragColor = vec4(d, 0.0, 1.0);
}
`;
