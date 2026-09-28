/**
 * Descending bubbles shaders. One instanced quad per bubble. The vertex shader places a
 * unit disc through the bubble's 2×2 shape matrix (size, motion stretch and wobble) and
 * picks its tint: pearl at rest, the direction color of its last push while it glows.
 * The fragment shader draws a bright rim that fades toward a clear centre, light from
 * above (brighter top rim), a small highlight and a faint caustic, anti-aliased over one
 * device pixel so bubbles stay crisp at any pixel ratio. Bubbles too small to show a rim
 * become soft dots with the same light. Additive on true black.
 */

export const BUBBLE_VERTEX = /* glsl */ `
precision highp float;
precision highp sampler2D;
layout(location = 0) in vec4 aCenterGlow;  // centre (world units), glow vector
layout(location = 1) in vec4 aShape;       // shape matrix columns: (m00, m10), (m01, m11)
layout(location = 2) in vec2 aLight;       // brightness, alpha
uniform vec2 uWorld;         // canvas size in world units (short sides)
uniform float uPxPerUnit;    // device pixels per short side
uniform sampler2D uPalette;  // direction colors, indexed by turns (0 = right, 1/4 = up)
uniform vec3 uRestColor;
uniform float uExposure;
uniform float uSaturation;
uniform float uGlowGain;     // extra light at full glow
out vec2 vLocal;
out float vRadiusPx;
out vec3 vRim;
out float vHighlight;

void main () {
  int id = gl_VertexID;
  vec2 corner = vec2((id == 1 || id == 3) ? 1.0 : -1.0, id >= 2 ? 1.0 : -1.0);
  mat2 m = mat2(aShape.xy, aShape.zw);
  // Smallest singular value of the shape matrix: the bubble's thinnest radius.
  float sumSq = dot(aShape, aShape);
  float det = abs(aShape.x * aShape.w - aShape.z * aShape.y);
  float disc = sqrt(max(sumSq * sumSq - 4.0 * det * det, 0.0));
  float thinnest = sqrt(max(0.5 * (sumSq - disc), 0.0));
  float radiusPx = max(thinnest * uPxPerUnit, 1e-3);
  // Pad the quad by a pixel and a half for anti-aliasing.
  vec2 local = corner * (1.0 + 1.5 / radiusPx);
  vec2 world = aCenterGlow.xy + m * local;
  gl_Position = vec4(world / uWorld * 2.0 - 1.0, 0.0, 1.0);
  vLocal = local;
  vRadiusPx = radiusPx;

  vec2 g = aCenterGlow.zw;
  float glow = length(g);
  float amount = 1.0 - exp(-1.6 * glow);
  vec3 tint = uRestColor;
  if (glow > 1e-5) {
    float turn = atan(g.y, g.x) * 0.15915494309;
    tint = mix(uRestColor, textureLod(uPalette, vec2(turn, 0.5), 0.0).rgb, amount);
  }
  float luma = dot(tint, vec3(0.2126, 0.7152, 0.0722));
  tint = max(mix(vec3(luma), tint, uSaturation), 0.0);
  float light = aLight.x * aLight.y * uExposure;
  vRim = tint * light * (1.0 + uGlowGain * amount);
  vHighlight = light * (1.0 + 0.5 * amount);
}
`;

export const BUBBLE_FRAGMENT = /* glsl */ `
precision highp float;
in vec2 vLocal;
in float vRadiusPx;
in vec3 vRim;
in float vHighlight;
out vec4 fragColor;

void main () {
  float r = length(vLocal);
  // Coverage of the bubble's outer edge, over one device pixel.
  float edge = clamp((1.0 - r) * vRadiusPx + 0.5, 0.0, 1.0);
  if (edge <= 0.0) discard;
  // Rim: brightest at the edge, falling off inward; never thinner than ~1.5 px.
  float rimWidth = max(0.14, 1.5 / vRadiusPx);
  float inside = max(1.0 - r, 0.0) / rimWidth;
  float ring = exp(-2.2 * inside * inside);
  // A little Fresnel glow inside the rim, and a faint body so the centre reads as glass.
  float fresnel = 0.3 * pow(min(r, 1.0), 5.0);
  float body = 0.03;
  // Light from above: the top of the rim is brighter than the bottom.
  vec2 dir = r > 1e-4 ? vLocal / r : vec2(0.0, 1.0);
  float lit = 0.74 + 0.26 * dot(dir, vec2(-0.45, 0.89));
  vec3 color = vRim * ((0.95 * ring + fresnel) * lit + body);
  // Specular highlight up and to the left; a faint caustic low on the right.
  vec2 h = vLocal - vec2(-0.36, 0.42);
  vec2 c = vLocal - vec2(0.3, -0.5);
  float spot = exp(-dot(h, h) / 0.02) + 0.3 * exp(-dot(c, c) / 0.012);
  color += vec3(1.0, 0.98, 0.94) * (vHighlight * spot);
  // Bubbles only a few pixels wide can't show a ring: a soft dot with similar light.
  float detail = smoothstep(1.2, 3.5, vRadiusPx);
  vec3 dotColor = (vRim + 0.25 * vec3(vHighlight)) * (0.6 * exp(-2.5 * r * r));
  color = mix(dotColor, color, detail);
  fragColor = vec4(color * edge, 1.0);
}
`;
