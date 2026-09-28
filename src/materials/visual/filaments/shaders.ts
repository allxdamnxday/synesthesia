/**
 * Filaments shaders.
 *
 * Point data arrive in an RGBA32F texture: texel (j, f) holds (x, y, ox, oy) of point j of
 * strand f in world units (short sides, y up): its position now and at the start of the
 * last step. Column POINTS holds per-strand looks (tint, brightness, appearance).
 *
 * - RIBBON: paints, for every segment, the quadrilateral it swept during the last step
 *   (old segment, new segment, and the paths of its two ends) into the ribbon buffer.
 *   The next step's quadrilateral starts on this one's new edge and the next segment's
 *   shares this one's end path, so the pieces tile: a strand crossing a pixel leaves the
 *   same light however fast it moves, with no gaps and no double-painted seams. Coverage
 *   is a box filter as wide as the strand (at least a pixel) applied across each pair of
 *   opposite edges, computed from signed distances; for edges shared with a neighbour
 *   the two coverages add up to exactly one. This is the long exposure of a strand that
 *   wide, and it also handles sweeps thinner than a pixel. Sliding along itself paints
 *   nothing (a uniform strand sliding along its length looks the same).
 * - FADE: multiplies the ribbon buffer by a constant through blending (dst × α).
 * - DISPLAY: ribbon buffer → screen with exposure, saturation and a soft tone curve.
 * - STRAND: the strands themselves as tapered, anti-aliased strips (one instance per
 *   strand, two vertices per point), dim at rest and glowing in the color of their
 *   direction while they move.
 */

const HEADER = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2D;
`;

/** Shared by RIBBON and STRAND: point lookups and the direction palette. */
const POINTS = /* glsl */ `
uniform sampler2D uPoints;   // RGBA32F: (x, y, ox, oy); column uPerStrand: looks
uniform int uPerStrand;      // points per strand
uniform sampler2D uPalette;  // direction colors by turns (0 right, 1/4 up)
vec4 pointAt (int f, int j) { return texelFetch(uPoints, ivec2(j, f), 0); }
vec4 looksOf (int f) { return texelFetch(uPoints, ivec2(uPerStrand, f), 0); }
// The palette's colors differ a lot in lightness (ultramarine is far darker than
// sea-glass); even them out partly so a close and an open read equally strongly.
vec3 directionColor (vec2 d) {
  float turn = atan(d.y, d.x) * 0.15915494309;
  vec3 c = textureLod(uPalette, vec2(turn, 0.5), 0.0).rgb;
  float luma = max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 0.05);
  return c * pow(0.55 / luma, 0.6);
}
`;

export const RIBBON_VERTEX = /* glsl */ `
${HEADER}
${POINTS}
uniform vec2 uPxPerUnit;     // target pixels per world unit (x, y)
uniform vec2 uTargetPx;      // target size in pixels
uniform float uFilterPx;     // box filter width: the strand's width, at least a pixel
uniform float uDt;           // step, seconds
uniform vec2 uSpeedRange;    // sideways speeds (short sides/s) where painting fades in
uniform float uGain;         // light added by one full crossing
uniform float uUnitPx;       // target pixels per short side (for speeds)
flat out vec4 vOld;          // the segment's old ends (a0, b0), target pixels
flat out vec4 vNew;          // its new ends (a1, b1)
out vec3 vColor;

void main () {
  int segs = uPerStrand - 1;
  int f = gl_InstanceID / segs;
  int j = gl_InstanceID - f * segs;
  vec4 A = pointAt(f, j);
  vec4 B = pointAt(f, j + 1);
  vec4 looks = looksOf(f);
  vec2 a1 = A.xy * uPxPerUnit;
  vec2 a0 = A.zw * uPxPerUnit;
  vec2 b1 = B.xy * uPxPerUnit;
  vec2 b0 = B.zw * uPxPerUnit;
  vOld = vec4(a0, b0);
  vNew = vec4(a1, b1);
  // A box around the four corners, along the segment, padded for the filter.
  vec2 ma = 0.5 * (a0 + a1);
  vec2 axis = 0.5 * (b0 + b1) - ma;
  float len = length(axis);
  vec2 e = len > 1e-4 ? axis / len : vec2(1.0, 0.0);
  vec2 n = vec2(-e.y, e.x);
  vec4 u = vec4(dot(a0 - ma, e), dot(b0 - ma, e), dot(a1 - ma, e), dot(b1 - ma, e));
  vec4 w = vec4(dot(a0 - ma, n), dot(b0 - ma, n), dot(a1 - ma, n), dot(b1 - ma, n));
  float pad = 0.5 * uFilterPx + 1.0;
  int v = gl_VertexID;
  float along = (v == 0 || v == 2)
    ? min(min(u.x, u.y), min(u.z, u.w)) - pad
    : max(max(u.x, u.y), max(u.z, u.w)) + pad;
  float across = v < 2
    ? min(min(w.x, w.y), min(w.z, w.w)) - pad
    : max(max(w.x, w.y), max(w.z, w.w)) + pad;
  vec2 pos = ma + e * along + n * across;
  gl_Position = vec4(pos / uTargetPx * 2.0 - 1.0, 0.0, 1.0);
  // Light: fades in with the sideways speed, colored by the direction of the sweep.
  float sa = abs(dot(a1 - a0, n));
  float sb = abs(dot(b1 - b0, n));
  float speed = 0.5 * (sa + sb) / (uUnitPx * max(uDt, 1e-6));
  float k = uGain * smoothstep(uSpeedRange.x, uSpeedRange.y, speed) * looks.y * looks.z;
  vec2 d = 0.5 * ((a1 - a0) + (b1 - b0));
  vColor = length(d) > 1e-6 ? directionColor(d) * k : vec3(0.0);
}
`;

export const RIBBON_FRAGMENT = /* glsl */ `
${HEADER}
flat in vec4 vOld;
flat in vec4 vNew;
in vec3 vColor;
uniform float uFilterPx;
out vec4 fragColor;

vec2 unit (vec2 v, vec2 fallback) {
  float l = length(v);
  return l > 1e-4 ? v / l : fallback;
}

// Unit normal of a line along dir, turned to point the same way as toward.
vec2 normalToward (vec2 dir, vec2 toward) {
  vec2 n = vec2(-dir.y, dir.x);
  return dot(n, toward) < 0.0 ? -n : n;
}

// Box filter of width w across the strip between two opposite edges: d1 and d2 are the
// distances inside each edge. Neighbours sharing an edge get complementary coverage, and
// coinciding edges (no strip) give none.
float strip (float d1, float d2, float w) {
  float h = 0.5 * w;
  return clamp(min(h, d1) + min(h, d2), 0.0, w) / w;
}

void main () {
  vec2 x = gl_FragCoord.xy;
  vec2 a0 = vOld.xy;
  vec2 b0 = vOld.zw;
  vec2 a1 = vNew.xy;
  vec2 b1 = vNew.zw;
  vec2 axis = unit(0.5 * (b0 + b1) - 0.5 * (a0 + a1), vec2(1.0, 0.0));
  vec2 normal = vec2(-axis.y, axis.x);
  // Across the sweep, between the old segment and the new one: inside is ahead of the
  // old edge and behind the new one.
  float ahead = dot(0.5 * ((a1 - a0) + (b1 - b0)), normal) < 0.0 ? -1.0 : 1.0;
  vec2 nOld = normalToward(unit(b0 - a0, axis), normal);
  vec2 nNew = normalToward(unit(b1 - a1, axis), normal);
  float dOld = ahead * dot(x - a0, nOld);
  float dNew = -ahead * dot(x - a1, nNew);
  // Along the strand, between the paths of its two ends: inside is past a, before b.
  vec2 nA = normalToward(unit(a1 - a0, normal), axis);
  vec2 nB = normalToward(unit(b1 - b0, normal), axis);
  float dA = dot(x - a0, nA);
  float dB = -dot(x - b0, nB);
  float coverage = strip(dOld, dNew, uFilterPx) * strip(dA, dB, uFilterPx);
  fragColor = vec4(vColor * coverage, 1.0);
}
`;

/** Full-screen triangle from gl_VertexID (no attributes). */
export const SCREEN_VERTEX = /* glsl */ `
${HEADER}
out vec2 vUv;
void main () {
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}
`;

/** Output is ignored: blending (ZERO, CONSTANT_ALPHA) scales what is there. */
export const FADE_FRAGMENT = /* glsl */ `
${HEADER}
out vec4 fragColor;
void main () {
  fragColor = vec4(0.0);
}
`;

/** Constant one: with reverse-subtract blending, takes a fixed amount away (8-bit fades). */
export const ONE_FRAGMENT = /* glsl */ `
${HEADER}
out vec4 fragColor;
void main () {
  fragColor = vec4(1.0);
}
`;

/** Copies a texture (resizing the ribbon buffer keeps the ribbons). */
export const COPY_FRAGMENT = /* glsl */ `
${HEADER}
in vec2 vUv;
uniform sampler2D uSource;
out vec4 fragColor;
void main () {
  fragColor = texture(uSource, vUv);
}
`;

export const DISPLAY_FRAGMENT = /* glsl */ `
${HEADER}
in vec2 vUv;
uniform sampler2D uRibbons;
uniform float uExposure;
uniform float uSaturation;
out vec4 fragColor;

uint ditherHash (uvec2 p) {
  uint h = p.x * 1664525u + p.y * 22695477u + 1013904223u;
  h ^= h >> 16u;
  h *= 2246822519u;
  h ^= h >> 13u;
  return h;
}

void main () {
  vec3 c = max(texture(uRibbons, vUv).rgb, 0.0) * uExposure;
  float y = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = max(mix(vec3(y), c, uSaturation), 0.0);
  c = vec3(1.0) - exp(-c);
  float peak = max(c.r, max(c.g, c.b));
  float dither = (float(ditherHash(uvec2(gl_FragCoord.xy)) & 1023u) / 1023.0 - 0.5) / 255.0;
  c += dither * step(2.0 / 255.0, peak);
  fragColor = vec4(c, 1.0);
}
`;

export const STRAND_VERTEX = /* glsl */ `
${HEADER}
${POINTS}
uniform vec2 uPxPerUnit;     // canvas pixels per world unit (x, y)
uniform vec2 uCanvasPx;
uniform float uWidthPx;      // width at the root, canvas pixels
uniform float uDt;
uniform float uUnitPx;       // canvas pixels per short side
uniform vec3 uRestColor;
uniform float uRestLight;    // light of a strand at rest
uniform float uGlowSpeed;    // speed (short sides/s) at which a strand fully glows
uniform float uGlowLight;    // extra light of a fully glowing strand
uniform float uExposure;
uniform float uSaturation;
out float vAcross;           // pixels from the centre line
out float vHalfWidth;        // drawn half width, pixels
out vec3 vColor;

void main () {
  int f = gl_InstanceID;
  int j = gl_VertexID >> 1;
  float side = (gl_VertexID & 1) == 1 ? 1.0 : -1.0;
  int last = uPerStrand - 1;
  vec4 P = pointAt(f, j);
  vec2 prev = pointAt(f, max(j - 1, 0)).xy * uPxPerUnit;
  vec2 next = pointAt(f, min(j + 1, last)).xy * uPxPerUnit;
  vec2 p = P.xy * uPxPerUnit;
  vec2 t = next - prev;
  float tl = length(t);
  vec2 dir = tl > 1e-5 ? t / tl : vec2(0.0, 1.0);
  vec2 n = vec2(-dir.y, dir.x);
  float along = float(j) / float(last);
  // Taper toward the tip; hairlines stay a pixel wide and dim instead of vanishing.
  float width = uWidthPx * mix(1.0, 0.45, along);
  float drawn = max(width, 1.0);
  float thin = width / drawn;
  float halfWidth = 0.5 * drawn;
  vec2 pos = p + n * side * (halfWidth + 1.0);
  gl_Position = vec4(pos / uCanvasPx * 2.0 - 1.0, 0.0, 1.0);
  vAcross = side * (halfWidth + 1.0);
  vHalfWidth = halfWidth;

  vec4 looks = looksOf(f);
  vec2 moved = (P.xy - P.zw) * uPxPerUnit;
  float speed = length(moved) / (uUnitPx * max(uDt, 1e-6));
  float glow = 1.0 - exp(-speed / uGlowSpeed);
  vec3 tint = uRestColor * (1.0 + 0.08 * vec3(looks.x, -0.3 * looks.x, -looks.x));
  vec3 moving = length(moved) > 1e-6 ? directionColor(moved) : tint;
  vec3 c = tint * uRestLight + moving * (uGlowLight * glow);
  float y = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = max(mix(vec3(y), c, uSaturation), 0.0);
  // Fainter toward the tip.
  float fade = mix(1.0, 0.55, along * along);
  vColor = c * (uExposure * looks.y * looks.z * thin * fade);
}
`;

export const STRAND_FRAGMENT = /* glsl */ `
${HEADER}
in float vAcross;
in float vHalfWidth;
in vec3 vColor;
out vec4 fragColor;
void main () {
  float coverage = clamp(vHalfWidth + 0.5 - abs(vAcross), 0.0, 1.0);
  fragColor = vec4(vColor * coverage, 1.0);
}
`;
