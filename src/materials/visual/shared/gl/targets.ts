/**
 * Textures, framebuffers and ping-pong render targets, plus float render-target format
 * selection with the fallbacks from Pavel Dobryakov's WebGL-Fluid-Simulation (MIT):
 *
 * - Prefer half-float targets (RGBA16F / RG16F / R16F). They need EXT_color_buffer_float
 *   (or EXT_color_buffer_half_float) to be renderable, and WebGL2 always filters them
 *   linearly.
 * - When a one- or two-channel format isn't renderable, fall back R → RG → RGBA.
 * - If half-float isn't renderable at all, try 32-bit float. Filtering those needs
 *   OES_texture_float_linear; without it, shaders filter manually (MANUAL_FILTERING).
 */
import type { GlResources } from './resources';

export interface TextureFormat {
  internalFormat: number;
  format: number;
  type: number;
  /** Number of channels the format actually stores (may exceed what was asked for). */
  channels: 1 | 2 | 4;
}

export interface RenderTargetSupport {
  rgba: TextureFormat;
  rg: TextureFormat;
  r: TextureFormat;
  /** gl.HALF_FLOAT or gl.FLOAT. */
  type: number;
  /** True when the formats above can be sampled with LINEAR filtering. */
  linearFiltering: boolean;
  /** One line for Diagnostics, e.g. "half-float, RG, linear filtering". */
  summary: string;
}

/** Test hooks that force the fallback paths on machines that don't need them. */
export interface RenderTargetOverrides {
  /** Pretend linear filtering of float targets is unavailable. */
  forceManualFiltering?: boolean;
  /** Pretend one- and two-channel float targets aren't renderable (use RGBA). */
  forceRgba?: boolean;
}

function canRenderTo(
  gl: WebGL2RenderingContext,
  internalFormat: number,
  format: number,
  type: number,
) {
  const texture = gl.createTexture();
  const fbo = gl.createFramebuffer();
  if (!texture || !fbo) return false;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.deleteFramebuffer(fbo);
  gl.deleteTexture(texture);
  // Swallow INVALID_ENUM etc. from an unsupported combination so later checks start clean.
  while (gl.getError() !== gl.NO_ERROR && !gl.isContextLost()) {
    /* drain */
  }
  return ok;
}

type Channels = 1 | 2 | 4;

function supportedFormat(
  gl: WebGL2RenderingContext,
  channels: Channels,
  type: number,
  forceRgba: boolean,
): TextureFormat | null {
  const half = type === gl.HALF_FLOAT;
  const table: Record<Channels, { internalFormat: number; format: number }> = {
    1: { internalFormat: half ? gl.R16F : gl.R32F, format: gl.RED },
    2: { internalFormat: half ? gl.RG16F : gl.RG32F, format: gl.RG },
    4: { internalFormat: half ? gl.RGBA16F : gl.RGBA32F, format: gl.RGBA },
  };
  const wanted = forceRgba ? 4 : channels;
  const { internalFormat, format } = table[wanted];
  if (canRenderTo(gl, internalFormat, format, type)) {
    return { internalFormat, format, type, channels: wanted };
  }
  // Dobryakov's fallback chain: R → RG → RGBA.
  if (wanted === 1) return supportedFormat(gl, 2, type, false);
  if (wanted === 2) return supportedFormat(gl, 4, type, false);
  return null;
}

/**
 * Pick float render-target formats for this context, or null if the context can't
 * render to any float format (the app then blocks with an explanation, SPEC 14.1).
 */
export function detectRenderTargets(
  gl: WebGL2RenderingContext,
  overrides: RenderTargetOverrides = {},
): RenderTargetSupport | null {
  const colorBufferFloat = gl.getExtension('EXT_color_buffer_float') !== null;
  if (!colorBufferFloat) gl.getExtension('EXT_color_buffer_half_float');
  const floatLinear = gl.getExtension('OES_texture_float_linear') !== null;
  const forceRgba = overrides.forceRgba ?? false;

  for (const type of [gl.HALF_FLOAT, gl.FLOAT]) {
    const rgba = supportedFormat(gl, 4, type, forceRgba);
    if (!rgba) continue;
    const rg = supportedFormat(gl, 2, type, forceRgba) ?? rgba;
    const r = supportedFormat(gl, 1, type, forceRgba) ?? rg;
    // Half-float textures are always filterable in WebGL2; 32-bit float needs an extension.
    const filterable = type === gl.HALF_FLOAT || floatLinear;
    const linearFiltering = filterable && !(overrides.forceManualFiltering ?? false);
    const summary = [
      type === gl.HALF_FLOAT ? 'half-float' : 'float',
      rg.channels === 2 ? 'RG' : 'RGBA only',
      linearFiltering ? 'linear filtering' : 'manual filtering',
    ].join(', ');
    return { rgba, rg, r, type, linearFiltering, summary };
  }
  return null;
}

export interface RenderTarget {
  texture: WebGLTexture;
  fbo: WebGLFramebuffer;
  width: number;
  height: number;
  texelSizeX: number;
  texelSizeY: number;
  format: TextureFormat;
  filter: number;
}

export interface DoubleRenderTarget {
  read: RenderTarget;
  write: RenderTarget;
  readonly width: number;
  readonly height: number;
  readonly texelSizeX: number;
  readonly texelSizeY: number;
  swap(): void;
}

export interface TextureOptions {
  filter: number;
  wrap?: number;
  data?: ArrayBufferView | null;
}

/** A 2D texture with filtering and wrap set; `data` may be null (zero-filled). */
export function createTexture(
  res: GlResources,
  width: number,
  height: number,
  format: TextureFormat,
  options: TextureOptions,
): WebGLTexture {
  const gl = res.gl;
  const texture = res.texture();
  const wrap = options.wrap ?? gl.CLAMP_TO_EDGE;
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, options.filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, options.filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  resetUnpackState(gl);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    format.internalFormat,
    width,
    height,
    0,
    format.format,
    format.type,
    options.data ?? null,
  );
  gl.bindTexture(gl.TEXTURE_2D, null);
  return texture;
}

/**
 * Pixel-store state is global to the context and other code may have changed it; set
 * the values every upload in this project assumes (no flip, no premultiply, tight rows).
 */
export function resetUnpackState(gl: WebGL2RenderingContext): void {
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
  gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
  gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
}

export function createRenderTarget(
  res: GlResources,
  width: number,
  height: number,
  format: TextureFormat,
  filter: number,
): RenderTarget {
  const gl = res.gl;
  const texture = createTexture(res, width, height, format, { filter });
  const fbo = res.framebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.viewport(0, 0, width, height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return {
    texture,
    fbo,
    width,
    height,
    texelSizeX: 1 / width,
    texelSizeY: 1 / height,
    format,
    filter,
  };
}

export function createDoubleRenderTarget(
  res: GlResources,
  width: number,
  height: number,
  format: TextureFormat,
  filter: number,
): DoubleRenderTarget {
  let a = createRenderTarget(res, width, height, format, filter);
  let b = createRenderTarget(res, width, height, format, filter);
  return {
    get read() {
      return a;
    },
    set read(value: RenderTarget) {
      a = value;
    },
    get write() {
      return b;
    },
    set write(value: RenderTarget) {
      b = value;
    },
    width,
    height,
    texelSizeX: 1 / width,
    texelSizeY: 1 / height,
    swap() {
      const t = a;
      a = b;
      b = t;
    },
  };
}

export function deleteRenderTarget(res: GlResources, target: RenderTarget): void {
  res.deleteFramebuffer(target.fbo);
  res.deleteTexture(target.texture);
}

export function deleteDoubleRenderTarget(res: GlResources, target: DoubleRenderTarget): void {
  deleteRenderTarget(res, target.read);
  deleteRenderTarget(res, target.write);
}

/** Clear a render target (or both halves of a double target) to zero. */
export function clearTarget(gl: WebGL2RenderingContext, target: RenderTarget | DoubleRenderTarget) {
  const targets = 'swap' in target ? [target.read, target.write] : [target];
  gl.clearColor(0, 0, 0, 0);
  for (const t of targets) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.viewport(0, 0, t.width, t.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

/** Bind a texture to a texture unit and return the unit index (for gl.uniform1i). */
export function bindTexture(
  gl: WebGL2RenderingContext,
  unit: number,
  texture: WebGLTexture,
): number {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  return unit;
}
