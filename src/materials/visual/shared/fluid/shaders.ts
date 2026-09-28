/*
 * Adapted from WebGL-Fluid-Simulation by Pavel Dobryakov, MIT License,
 * Copyright (c) 2017 Pavel Dobryakov. See LICENSE-webgl-fluid.txt in this folder.
 *
 * Changes from the original: GLSL ES 3.00; highp throughout; mouse splats replaced by
 * signature forcing and dye injection (Range projection, seeded jitter from an exact
 * integer hash); implicit viscous diffusion; exponential decay; the textbook ½ factor
 * in the pressure gradient; resolution-independent vorticity; a display pass with
 * exposure, saturation, tone mapping, "surface light" shading and dithering instead of
 * bloom and sunrays.
 *
 * Shader bodies omit `#version`; see ../gl/shader.ts. Units: velocity is in simulation
 * grid cells per second (as in the original), texture coordinates have y up.
 */

/** Shared vertex shader: full-screen triangle plus the four neighbour coordinates. */
export const BASE_VERTEX = /* glsl */ `
precision highp float;
layout(location = 0) in vec2 aPosition;
uniform vec2 uTexelSize;
out vec2 vUv;
out vec2 vL;
out vec2 vR;
out vec2 vT;
out vec2 vB;
void main () {
  vUv = aPosition * 0.5 + 0.5;
  vL = vUv - vec2(uTexelSize.x, 0.0);
  vR = vUv + vec2(uTexelSize.x, 0.0);
  vT = vUv + vec2(0.0, uTexelSize.y);
  vB = vUv - vec2(0.0, uTexelSize.y);
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

/** Precision header of every fluid pass; material passes run through the hooks use it too. */
export const PRECISION = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2D;
`;

/**
 * Bilinear filtering by hand, for float textures that can't be filtered linearly
 * (compiled in with MANUAL_FILTERING; the textures then use NEAREST). Material passes
 * that read solver targets at another resolution must sample through `sampleLinear`.
 */
export const SAMPLING = /* glsl */ `
vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {
  vec2 st = uv / tsize - 0.5;
  vec2 iuv = floor(st);
  vec2 fuv = fract(st);
  vec4 a = texture(sam, (iuv + vec2(0.5, 0.5)) * tsize);
  vec4 b = texture(sam, (iuv + vec2(1.5, 0.5)) * tsize);
  vec4 c = texture(sam, (iuv + vec2(0.5, 1.5)) * tsize);
  vec4 d = texture(sam, (iuv + vec2(1.5, 1.5)) * tsize);
  return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
}
vec4 sampleLinear (sampler2D sam, vec2 uv, vec2 tsize) {
#ifdef MANUAL_FILTERING
  return bilerp(sam, uv, tsize);
#else
  return texture(sam, uv);
#endif
}
`;

/**
 * The signature's push at a canvas point, in field units (diagonals per second, y up),
 * after the Range projection and the seeded jitter. Shared by the force and dye passes
 * so dye always appears exactly where the water is pushed. Material passes can include it
 * too (Smoke's emission); `FluidSolver.bindSignatureForce()` sets its uniforms.
 *
 * Jitter uses value noise over an integer hash (PCG3D, Jarzynski & Olano 2020), which is
 * exact on every GPU, so a seed always gives the same scatter.
 */
export const SIGNATURE_FORCE = /* glsl */ `
uniform sampler2D uField;
uniform vec4 uRect;        // projected field: x, y, width, height (canvas-normalized)
uniform vec2 uFieldCells;  // columns, rows
uniform vec2 uShortScale;  // canvas-normalized -> short-side units: (w/short, h/short)
uniform vec4 uJitter;      // angle (radians), offset (short sides), phase x, phase y
uniform float uJitterFreq; // noise cells per short side
uniform uint uJitterSeed;

uvec3 pcg3d (uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}

vec3 lattice (ivec2 p) {
  uvec3 h = pcg3d(uvec3(uint(p.x + 65536), uint(p.y + 65536), uJitterSeed));
  return vec3(h >> 8u) * (1.0 / 16777216.0);
}

vec3 valueNoise (vec2 x) {
  vec2 i = floor(x);
  vec2 f = fract(x);
  vec2 u = f * f * (3.0 - 2.0 * f);
  ivec2 p = ivec2(i);
  vec3 a = lattice(p);
  vec3 b = lattice(p + ivec2(1, 0));
  vec3 c = lattice(p + ivec2(0, 1));
  vec3 d = lattice(p + ivec2(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

vec2 signatureForce (vec2 uv) {
  vec3 n = vec3(0.5);
  if (uJitter.x > 0.0 || uJitter.y > 0.0) {
    n = valueNoise(uv * uShortScale * uJitterFreq + uJitter.zw);
  }
  vec2 offset = (n.yz - 0.5) * 2.0 * uJitter.y / uShortScale;
  vec2 q = (uv + offset - uRect.xy) / uRect.zw;
  // Fade out over the outermost half cell so the field has no hard edge.
  vec2 edge = min(q, 1.0 - q) * uFieldCells * 2.0;
  float mask = smoothstep(0.0, 1.0, min(edge.x, edge.y));
  if (mask <= 0.0) return vec2(0.0);
  // Field rows are uploaded top row first (image y down), so flip y to sample and push.
  vec2 f = texture(uField, vec2(q.x, 1.0 - q.y)).xy;
  f = vec2(f.x, -f.y) * mask;
  float a = (n.x - 0.5) * 2.0 * uJitter.x;
  float c = cos(a);
  float s = sin(a);
  return vec2(c * f.x - s * f.y, s * f.x + c * f.y);
}
`;

/** Adds the signature's push to velocity. */
export const FORCE_FRAGMENT = /* glsl */ `
${PRECISION}
${SIGNATURE_FORCE}
in vec2 vUv;
uniform sampler2D uVelocity;
uniform float uGain;  // field units -> velocity change this step (cells/s)
out vec4 fragColor;
void main () {
  vec2 v = texture(uVelocity, vUv).xy;
  fragColor = vec4(v + signatureForce(vUv) * uGain, 0.0, 1.0);
}
`;

/**
 * Releases dye where the signature pushes, in proportion to the push, colored by its
 * direction (the palette is a 1D texture indexed by angle: 0 right, ¼ up, ½ left).
 *
 * Optionally the release is concentrated in a seeded pattern of round spots that stays
 * fixed in the bowl (spots.ts): each spot keeps releasing while the movement passes over
 * it, so the dye draws streaks that follow the flow (streaklines) instead of a
 * featureless cloud. Each deposit is smeared along this step's motion (three taps) so
 * fast flow draws continuous streaks rather than a row of dots.
 *
 * Compiled with DYE_STREAK (a separate program, so the plain one is untouched), each
 * deposit is also drawn out along the push into a stroke (five taps): a slow fluid
 * (Honey) then shows strokes from the moment of release instead of round spots.
 */
export const DYE_FRAGMENT = /* glsl */ `
${PRECISION}
${SIGNATURE_FORCE}
in vec2 vUv;
uniform sampler2D uDye;
uniform sampler2D uPalette;
uniform sampler2D uSpotTex;    // RG: spot profile, spot rank; tiles once per short side
uniform sampler2D uVelocity;
uniform vec2 uVelocityTexel;
uniform float uDt;
uniform float uAmount;         // dye per field unit this step
uniform vec3 uSpots;           // amount 0..1, coverage 0..1, gain
#ifdef DYE_STREAK
uniform float uStreak;         // stroke length, short sides
#endif
out vec4 fragColor;

float spotRelease (vec2 uv) {
  vec2 travel = texture(uVelocity, uv).xy * uVelocityTexel * uDt;
  float sum = 0.0;
  for (int k = 0; k < 3; k++) {
    vec2 s = texture(uSpotTex, (uv + travel * (float(k) / 3.0)) * uShortScale).rg;
    sum += s.r * smoothstep(s.g - 0.03, s.g + 0.03, uSpots.y);
  }
  return sum * (uSpots.z / 3.0);
}

#ifdef DYE_STREAK
float spotStroke (vec2 uv, vec2 f) {
  vec2 travel = texture(uVelocity, uv).xy * uVelocityTexel * uDt;
  // Along the push, uStreak short sides long, centred on the point.
  vec2 stroke = f * (uStreak / max(length(f), 1e-6)) / uShortScale;
  float sum = 0.0;
  for (int k = 0; k < 5; k++) {
    vec2 at = uv + travel * (float(k) / 5.0) + stroke * (float(k) / 4.0 - 0.5);
    vec2 s = texture(uSpotTex, at * uShortScale).rg;
    sum += s.r * smoothstep(s.g - 0.03, s.g + 0.03, uSpots.y);
  }
  return sum * (uSpots.z / 5.0);
}
#endif

void main () {
  vec4 dye = texture(uDye, vUv);
  vec2 f = signatureForce(vUv);
  float m = length(f);
  if (m > 1e-6) {
    float turn = atan(f.y, f.x) * 0.15915494309;
#ifdef DYE_STREAK
    float release = uSpots.x > 0.0 ? mix(1.0, spotStroke(vUv, f), uSpots.x) : 1.0;
#else
    float release = uSpots.x > 0.0 ? mix(1.0, spotRelease(vUv), uSpots.x) : 1.0;
#endif
    dye.rgb += texture(uPalette, vec2(turn, 0.5)).rgb * m * uAmount * release;
  }
  fragColor = vec4(dye.rgb, 1.0);
}
`;

/**
 * One Jacobi iteration of implicit viscous diffusion, (I − ν·dt·∇²) v = v0:
 * v ← (v0 + α(vL + vR + vT + vB)) / (1 + 4α). Clamped edges give zero-gradient walls.
 */
export const VISCOSITY_FRAGMENT = /* glsl */ `
${PRECISION}
in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
uniform sampler2D uVelocity;  // current iterate
uniform sampler2D uSource;    // velocity before diffusion
uniform float uAlpha;
out vec4 fragColor;
void main () {
  vec2 L = texture(uVelocity, vL).xy;
  vec2 R = texture(uVelocity, vR).xy;
  vec2 T = texture(uVelocity, vT).xy;
  vec2 B = texture(uVelocity, vB).xy;
  vec2 b = texture(uSource, vUv).xy;
  fragColor = vec4((b + uAlpha * (L + R + T + B)) / (1.0 + 4.0 * uAlpha), 0.0, 1.0);
}
`;

export const CURL_FRAGMENT = /* glsl */ `
${PRECISION}
in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
uniform sampler2D uVelocity;
out vec4 fragColor;
void main () {
  float L = texture(uVelocity, vL).y;
  float R = texture(uVelocity, vR).y;
  float T = texture(uVelocity, vT).x;
  float B = texture(uVelocity, vB).x;
  float vorticity = R - L - T + B;
  fragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
}
`;

/** Vorticity confinement: re-energises small swirls that the grid would smooth away. */
export const VORTICITY_FRAGMENT = /* glsl */ `
${PRECISION}
in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform float uCurlStrength;  // in grid cells
uniform float uDt;
uniform float uMaxSpeed;      // cells per second
out vec4 fragColor;
void main () {
  float L = texture(uCurl, vL).x;
  float R = texture(uCurl, vR).x;
  float T = texture(uCurl, vT).x;
  float B = texture(uCurl, vB).x;
  float C = texture(uCurl, vUv).x;
  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  force /= length(force) + 0.0001;
  force *= uCurlStrength * C;
  force.y *= -1.0;
  vec2 velocity = texture(uVelocity, vUv).xy;
  velocity += force * uDt;
  velocity = clamp(velocity, -uMaxSpeed, uMaxSpeed);
  fragColor = vec4(velocity, 0.0, 1.0);
}
`;

export const DIVERGENCE_FRAGMENT = /* glsl */ `
${PRECISION}
in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
uniform sampler2D uVelocity;
out vec4 fragColor;
void main () {
  float L = texture(uVelocity, vL).x;
  float R = texture(uVelocity, vR).x;
  float T = texture(uVelocity, vT).y;
  float B = texture(uVelocity, vB).y;
  vec2 C = texture(uVelocity, vUv).xy;
  // Walls: mirror the normal component so nothing flows out of the bowl.
  if (vL.x < 0.0) { L = -C.x; }
  if (vR.x > 1.0) { R = -C.x; }
  if (vT.y > 1.0) { T = -C.y; }
  if (vB.y < 0.0) { B = -C.y; }
  float div = 0.5 * (R - L + T - B);
  fragColor = vec4(div, 0.0, 0.0, 1.0);
}
`;

/** Multiplies a texture by a constant (pressure warm start between steps). */
export const SCALE_FRAGMENT = /* glsl */ `
${PRECISION}
in vec2 vUv;
uniform sampler2D uTexture;
uniform float uValue;
out vec4 fragColor;
void main () {
  fragColor = uValue * texture(uTexture, vUv);
}
`;

export const COPY_FRAGMENT = /* glsl */ `
${PRECISION}
in vec2 vUv;
uniform sampler2D uTexture;
out vec4 fragColor;
void main () {
  fragColor = texture(uTexture, vUv);
}
`;

export const PRESSURE_FRAGMENT = /* glsl */ `
${PRECISION}
in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
out vec4 fragColor;
void main () {
  float L = texture(uPressure, vL).x;
  float R = texture(uPressure, vR).x;
  float T = texture(uPressure, vT).x;
  float B = texture(uPressure, vB).x;
  float divergence = texture(uDivergence, vUv).x;
  float pressure = (L + R + B + T - divergence) * 0.25;
  fragColor = vec4(pressure, 0.0, 0.0, 1.0);
}
`;

export const GRADIENT_SUBTRACT_FRAGMENT = /* glsl */ `
${PRECISION}
in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
uniform float uGradientScale;
out vec4 fragColor;
void main () {
  float L = texture(uPressure, vL).x;
  float R = texture(uPressure, vR).x;
  float T = texture(uPressure, vT).x;
  float B = texture(uPressure, vB).x;
  vec2 velocity = texture(uVelocity, vUv).xy;
  velocity -= uGradientScale * vec2(R - L, T - B);
  fragColor = vec4(velocity, 0.0, 1.0);
}
`;

/** Semi-Lagrangian advection with exponential decay (uDecay = exp(−dissipation·dt)). */
export const ADVECTION_FRAGMENT = /* glsl */ `
${PRECISION}
${SAMPLING}
in vec2 vUv;
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 uVelocityTexel;
uniform vec2 uSourceTexel;
uniform float uDt;
uniform float uDecay;
out vec4 fragColor;
void main () {
  vec2 coord = vUv - uDt * sampleLinear(uVelocity, vUv, uVelocityTexel).xy * uVelocityTexel;
  fragColor = sampleLinear(uSource, coord, uSourceTexel) * uDecay;
}
`;

/**
 * Dye to screen. Exposure and saturation, a soft tone curve whose highlights roll off
 * toward white (the "glow"), optional surface light, and a tiny ordered dither so slow
 * fades don't band. Empty water stays exactly black.
 *
 * Surface light treats the dye as a thin layer whose thickness tilts the surface seen
 * from below: the layer is shaded by a light above the bowl, refracts what is behind it
 * a little, and glints on its slopes.
 */
export const DISPLAY_FRAGMENT = /* glsl */ `
${PRECISION}
${SAMPLING}
in vec2 vUv;
uniform sampler2D uDye;
uniform vec2 uDyeTexel;
uniform float uExposure;
uniform float uSaturation;
uniform float uSurfaceLight;
uniform float uSlopeScale;  // dye thickness gradient -> surface slope
uniform float uSlopeReach;  // half the slope footprint, in short sides
uniform float uRefraction;  // how far the tilted layer shifts the view (short sides)
uniform vec2 uAspectScale;  // (w/short, h/short), keeps the light isotropic
out vec4 fragColor;

float luma (vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 dyeAt (vec2 uv) { return sampleLinear(uDye, uv, uDyeTexel).rgb; }
// Layer thickness from dye: linear for faint dye (faint traces stay flat), saturating
// for dense dye (so relief gathers at the edges of the bold trails).
float thickness (vec2 uv) { return 1.0 - exp(-2.5 * luma(dyeAt(uv))); }

uint ditherHash (uvec2 p) {
  uint h = p.x * 1664525u + p.y * 22695477u + 1013904223u;
  h ^= h >> 16u;
  h *= 2246822519u;
  h ^= h >> 13u;
  return h;
}

void main () {
  vec3 c = dyeAt(vUv);
  if (uSurfaceLight > 0.0) {
    // A wide footprint (in short sides) keeps the surface smooth rather than grainy.
    vec2 o = uSlopeReach / uAspectScale;
    float l = thickness(vUv - vec2(o.x, 0.0));
    float r = thickness(vUv + vec2(o.x, 0.0));
    float t = thickness(vUv + vec2(0.0, o.y));
    float b = thickness(vUv - vec2(0.0, o.y));
    // Thickness gradient per canvas short side -> surface slope.
    vec2 slope = vec2(r - l, t - b) / (2.0 * o * uAspectScale) * uSlopeScale;
    vec3 n = normalize(vec3(-slope, 1.0));
    // Refraction: look through the tilted layer.
    c = mix(c, dyeAt(vUv - n.xy * uRefraction / uAspectScale), uSurfaceLight);
    vec3 light = normalize(vec3(-0.35, 0.5, 1.0));
    float diffuse = clamp(dot(n, light) / light.z, 0.0, 1.6);
    c *= mix(1.0, 0.55 + 0.45 * diffuse, uSurfaceLight);
    // Glints only where the layer tilts toward the light (flat water adds nothing).
    vec3 h = normalize(light + vec3(0.0, 0.0, 1.0));
    float glint = max(pow(max(dot(n, h), 0.0), 32.0) - pow(h.z, 32.0), 0.0);
    float presence = smoothstep(0.03, 0.25, luma(c));
    c += glint * presence * uSurfaceLight * 0.9 * vec3(0.92, 0.96, 1.0);
  }
  c *= uExposure;
  float y = luma(c);
  c = max(mix(vec3(y), c, uSaturation), 0.0);
  c = vec3(1.0) - exp(-c);
  float peak = max(c.r, max(c.g, c.b));
  float dither = (float(ditherHash(uvec2(gl_FragCoord.xy)) & 1023u) / 1023.0 - 0.5) / 255.0;
  c += dither * step(2.0 / 255.0, peak);
  fragColor = vec4(c, 1.0);
}
`;
