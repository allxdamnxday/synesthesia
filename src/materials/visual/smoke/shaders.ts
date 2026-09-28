/**
 * Smoke's own passes, run through the fluid solver's hooks. Units: velocity in grid
 * cells per second (as in the solver), lengths in canvas short sides, heat unitless;
 * texture coordinates have y up.
 */
import { FLUID_PRECISION_GLSL, FLUID_SAMPLING_GLSL, SIGNATURE_FORCE_GLSL } from '../shared/fluid';

/** Taps of the emission disk, besides the centre (a Vogel spiral covers it evenly). */
export const EMISSION_TAPS = 24;

/**
 * Emission, at simulation resolution: the strongest push within the burst radius
 * (gently weighted by distance), so the smoke is given off over the movement grown by
 * that radius: an expanding movement gives off a wider puff, a contracting one a tighter
 * one. RG: the push averaged over the disk (its direction tints the smoke), B: how much
 * is released.
 */
export const EMISSION_FRAGMENT = /* glsl */ `
${FLUID_PRECISION_GLSL}
${SIGNATURE_FORCE_GLSL}
in vec2 vUv;
uniform float uRadius;  // short sides
out vec4 fragColor;
void main () {
  vec2 f = signatureForce(vUv);
  vec2 sum = f;
  float release = length(f);
  float weight = 1.0;
  for (int k = 0; k < ${EMISSION_TAPS}; k++) {
    float r = sqrt((float(k) + 0.5) / ${EMISSION_TAPS}.0);
    float a = float(k) * 2.39996323;
    vec2 o = vec2(cos(a), sin(a)) * (r * uRadius) / uShortScale;
    vec2 g = signatureForce(vUv + o);
    float w = 1.0 - 0.4 * r * r;
    sum += g * w;
    weight += w;
    release = max(release, length(g) * w);
  }
  fragColor = vec4(sum / weight, release, 1.0);
}
`;

/**
 * Smoke released into the dye, at dye resolution, tinted by the direction of the push.
 * Most of it leaves from a seeded pattern of small vents fixed in the air, each drawn out
 * along the push and smeared along this step's motion, so the smoke comes off in
 * threads that the flow draws into wisps (instead of a flat glow).
 */
export const SMOKE_FRAGMENT = /* glsl */ `
${FLUID_PRECISION_GLSL}
${FLUID_SAMPLING_GLSL}
in vec2 vUv;
uniform sampler2D uDye;
uniform sampler2D uEmission;
uniform vec2 uEmissionTexel;
uniform sampler2D uVelocity;
uniform vec2 uVelocityTexel;
uniform sampler2D uVents;      // RG: vent profile, vent rank; tiles once per short side
uniform vec2 uShortScale;      // canvas-normalized -> short sides: (w/short, h/short)
uniform float uDt;
uniform float uAmount;         // smoke per unit of push this step
uniform vec3 uVentMix;         // share from vents 0..1, coverage 0..1, gain
uniform float uWisp;           // length each vent's release is drawn out along the push, short sides
uniform vec3 uRising;
uniform vec3 uLevel;
uniform vec3 uFalling;
out vec4 fragColor;

float vents (vec2 uv, vec2 push) {
  vec2 travel = texture(uVelocity, uv).xy * uVelocityTexel * uDt;
  vec2 wisp = push * (uWisp / max(length(push), 1e-6)) / uShortScale;
  float sum = 0.0;
  for (int k = 0; k < 5; k++) {
    vec2 at = uv + travel * (float(k) / 5.0) + wisp * (float(k) / 4.0 - 0.5);
    vec2 s = texture(uVents, at * uShortScale).rg;
    sum += s.r * smoothstep(s.g - 0.03, s.g + 0.03, uVentMix.y);
  }
  return sum * (uVentMix.z / 5.0);
}

void main () {
  vec4 dye = texture(uDye, vUv);
  vec3 e = sampleLinear(uEmission, vUv, uEmissionTexel).xyz;
  if (e.z > 1e-6) {
    float s = e.y / max(length(e.xy), 1e-6);
    vec3 tint = s >= 0.0 ? mix(uLevel, uRising, s) : mix(uLevel, uFalling, -s);
    float release = mix(1.0, vents(vUv, e.xy), uVentMix.x);
    dye.rgb += tint * e.z * uAmount * release;
  }
  fragColor = vec4(dye.rgb, 1.0);
}
`;

/** Heat released where the movement is, at simulation resolution. */
export const HEAT_FRAGMENT = /* glsl */ `
${FLUID_PRECISION_GLSL}
in vec2 vUv;
uniform sampler2D uHeat;
uniform sampler2D uEmission;
uniform float uAmount;       // heat per unit of push this step
uniform float uMaxHeat;
out vec4 fragColor;
void main () {
  float h = texture(uHeat, vUv).x + texture(uEmission, vUv).z * uAmount;
  fragColor = vec4(min(h, uMaxHeat), 0.0, 0.0, 1.0);
}
`;

/**
 * Buoyancy and turbulence: warm smoke rises (or sinks, with negative lift), and where it
 * is warm, seeded eddies (the curl of value noise, so they add no divergence) stir it.
 * Value noise over an integer hash (PCG2D), exact on every GPU.
 */
export const BUOYANCY_FRAGMENT = /* glsl */ `
${FLUID_PRECISION_GLSL}
in vec2 vUv;
uniform sampler2D uVelocity;
uniform sampler2D uHeat;
uniform float uLift;          // velocity change per unit of heat this step (cells/s)
uniform float uTurbulence;    // velocity change per unit of heat this step (cells/s)
uniform vec3 uNoise;          // phase x, phase y, noise cells per short side
uniform uint uNoiseSeed;
uniform vec2 uShortScale;     // canvas-normalized -> short sides: (w/short, h/short)
uniform float uMaxSpeed;      // cells per second
out vec4 fragColor;

uvec2 pcg2d (uvec2 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * 1664525u;
  v.y += v.x * 1664525u;
  v = v ^ (v >> 16u);
  v.x += v.y * 1664525u;
  v.y += v.x * 1664525u;
  v = v ^ (v >> 16u);
  return v;
}

float lattice (ivec2 p) {
  uvec2 h = pcg2d(uvec2(p + 65536) ^ uvec2(uNoiseSeed, uNoiseSeed * 747796405u));
  return float(h.x >> 8u) * (1.0 / 16777216.0);
}

float valueNoise (vec2 x) {
  vec2 i = floor(x);
  vec2 f = fract(x);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  ivec2 p = ivec2(i);
  float a = lattice(p);
  float b = lattice(p + ivec2(1, 0));
  float c = lattice(p + ivec2(0, 1));
  float d = lattice(p + ivec2(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

vec2 curlNoise (vec2 p) {
  const float e = 0.12;
  float n = valueNoise(p + vec2(0.0, e));
  float s = valueNoise(p - vec2(0.0, e));
  float east = valueNoise(p + vec2(e, 0.0));
  float west = valueNoise(p - vec2(e, 0.0));
  return vec2(n - s, west - east) / (2.0 * e);
}

void main () {
  vec2 v = texture(uVelocity, vUv).xy;
  float heat = texture(uHeat, vUv).x;
  if (heat > 1e-5) {
    v.y += uLift * heat;
    if (uTurbulence > 0.0) {
      vec2 p = vUv * uShortScale * uNoise.z + uNoise.xy;
      v += curlNoise(p) * (uTurbulence * min(heat, 1.0));
    }
    float s = length(v);
    if (s > uMaxSpeed) v *= uMaxSpeed / s;
  }
  fragColor = vec4(v, 0.0, 1.0);
}
`;
