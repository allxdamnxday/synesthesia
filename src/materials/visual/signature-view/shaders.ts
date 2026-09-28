/**
 * V0 Signature view shaders. One instanced quad per grid cell draws a tapered stroke:
 * a thin, dim tail and a brighter head pointing the way the cell moves. Anti-aliased
 * analytically over one device pixel, so it is crisp at any pixel ratio. The stroke
 * mapping mirrors layout.ts (constants arrive as uniforms).
 */

export const STROKE_VERTEX = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D uField;     // RG32F, cols × rows, top row first, field units, y down
uniform ivec2 uCells;         // cols, rows
uniform vec4 uRect;           // projected field in canvas pixels (x, y, w, h), y up
uniform vec2 uCanvas;         // canvas size in pixels
uniform float uCellPx;
uniform float uDiagonalPx;
uniform float uStrokePx;
uniform float uTravelSec;     // STROKE_TRAVEL_SEC
uniform float uMaxCells;      // STROKE_MAX_CELLS
uniform float uBrightSpeed;   // STROKE_BRIGHT_SPEED
uniform float uRest;          // REST_BRIGHTNESS
uniform float uHue;           // 0..1: how much direction tints the stroke
out vec2 vLocal;
out float vLength;
out float vBrightness;
out vec3 vColor;

vec3 hue (float turn) {
  vec3 k = clamp(abs(fract(turn + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
  return mix(vec3(1.0), k, 0.65);
}

void main () {
  int c = gl_InstanceID % uCells.x;
  int r = gl_InstanceID / uCells.x;
  vec2 f = texelFetch(uField, ivec2(c, r), 0).xy;
  vec2 dir = vec2(f.x, -f.y);
  float speed = length(dir);
  vec2 d = speed > 1e-6 ? dir / speed : vec2(1.0, 0.0);
  vec2 n = vec2(-d.y, d.x);
  vec2 cell = vec2((float(c) + 0.5) / float(uCells.x), 1.0 - (float(r) + 0.5) / float(uCells.y));
  vec2 center = uRect.xy + cell * uRect.zw;

  float maxLen = uCellPx * uMaxCells;
  float len = maxLen * (1.0 - exp(-speed * uDiagonalPx * uTravelSec / maxLen));
  float pad = uStrokePx * 0.5 + 1.0;
  int v = gl_VertexID;
  float along = (v == 0 || v == 2) ? -pad : len + pad;
  float across = v < 2 ? -pad : pad;
  vec2 tail = center - d * len * 0.5;
  vec2 pos = tail + d * along + n * across;

  vLocal = vec2(along, across);
  vLength = len;
  vBrightness = uRest + (1.0 - uRest) * (1.0 - exp(-speed / uBrightSpeed));
  // atan(0, 0) is undefined in GLSL, so only ask for a hue when the cell moves.
  vColor = vec3(0.91, 0.89, 0.85);
  if (speed > 1e-6) vColor = mix(vColor, hue(atan(dir.y, dir.x) * 0.15915494309), uHue);
  gl_Position = vec4(pos / uCanvas * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const STROKE_FRAGMENT = /* glsl */ `
precision highp float;
in vec2 vLocal;
in float vLength;
in float vBrightness;
in vec3 vColor;
uniform float uStrokePx;
out vec4 fragColor;
void main () {
  float t = vLength > 0.0 ? clamp(vLocal.x / vLength, 0.0, 1.0) : 1.0;
  float halfWidth = mix(0.28, 0.5, t) * uStrokePx;
  vec2 closest = vec2(clamp(vLocal.x, 0.0, vLength), 0.0);
  float dist = length(vLocal - closest) - halfWidth;
  float coverage = clamp(0.5 - dist, 0.0, 1.0);
  float fade = mix(0.3, 1.0, t);
  fragColor = vec4(vColor * (vBrightness * coverage * fade), 1.0);
}
`;

/** Draws the readout panel texture (premultiplied alpha) into a pixel rectangle. */
export const PANEL_VERTEX = /* glsl */ `
precision highp float;
uniform vec4 uRect;    // panel in canvas pixels (x, y, w, h), y up
uniform vec2 uCanvas;
out vec2 vUv;
void main () {
  int v = gl_VertexID;
  vec2 corner = vec2((v == 1 || v == 3) ? 1.0 : 0.0, v >= 2 ? 1.0 : 0.0);
  vUv = vec2(corner.x, 1.0 - corner.y);  // canvas rows are top-first
  vec2 pos = uRect.xy + corner * uRect.zw;
  gl_Position = vec4(pos / uCanvas * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const PANEL_FRAGMENT = /* glsl */ `
precision highp float;
precision highp sampler2D;
in vec2 vUv;
uniform sampler2D uPanel;
out vec4 fragColor;
void main () {
  fragColor = texture(uPanel, vUv);
}
`;
