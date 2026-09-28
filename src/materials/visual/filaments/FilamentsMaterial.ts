/**
 * V5 Filaments (SPEC 9.4): fine strands like kelp or hair, rooted across the water. The
 * movement sweeps them along; wherever a strand sweeps it paints a ribbon of light in the
 * color of its direction, and the ribbons fade (Persistence) while the strands spring
 * back (Elasticity).
 *
 * The strands are simulated on the CPU (`FilamentSim`, typed arrays). The ribbons are
 * GPU state: `step()` fades the ribbon buffer and paints the bands the strands swept, so
 * like the simulation they advance exactly once per step; `draw()` only shows the ribbon
 * buffer and draws the strands on top, so drawing never changes the state.
 */
import type { SignatureFrame } from '../../../signature/types';
import { baselineValues } from '../../properties';
import type { PropertyValues, Quality, VisualContext, VisualMaterial } from '../../types';
import {
  GlResources,
  bindTexture,
  createProgram,
  createRenderTarget,
  createTexture,
  deleteRenderTarget,
  detectRenderTargets,
  resetPassState,
  resetUnpackState,
  type RenderTarget,
  type ShaderProgram,
  type TextureFormat,
} from '../shared/gl';
import { PALETTE_SIZE, WAKE_PALETTE_BYTES } from '../shared/wakePalette';
import { FilamentSim, POINTS_PER_STRAND } from './FilamentSim';
import {
  FILAMENT_TIER_CAPS,
  filamentParams,
  filamentWidth,
  type FilamentDisplayParams,
  type FilamentSimParams,
} from './mapping';
import { FILAMENTS_PROPERTIES } from './properties';
import {
  COPY_FRAGMENT,
  DISPLAY_FRAGMENT,
  FADE_FRAGMENT,
  ONE_FRAGMENT,
  RIBBON_FRAGMENT,
  RIBBON_VERTEX,
  SCREEN_VERTEX,
  STRAND_FRAGMENT,
  STRAND_VERTEX,
} from './shaders';

export const FILAMENTS_META = {
  id: 'filaments',
  version: 1,
  name: 'Filaments',
  description:
    'Fine strands like kelp or hair. The movement sweeps them along and they paint fading ribbons of light, then spring back.',
  properties: FILAMENTS_PROPERTIES,
};

/** Ribbon buffer resolution (short side, pixels) by tier; never finer than the canvas. */
export const RIBBON_SHORT_SIDE: Readonly<Record<Quality, number>> = {
  draft: 540,
  standard: 1080,
  high: 2160,
};
/** Light one full crossing of a strand of baseline width leaves in the ribbon buffer. */
const RIBBON_GAIN = 0.9;
const BASE_WIDTH = filamentWidth(0.5);
/** Sideways speeds (short sides per second) over which painting fades in. */
const RIBBON_SPEED_MIN = 0.025;
const RIBBON_SPEED_MAX = 0.4;
/** Strands at rest: pale silver-blue, dim. */
const REST_COLOR: readonly [number, number, number] = [0.72, 0.8, 0.95];
const REST_LIGHT = 0.4;
/** Moving strands glow in their direction's color. */
const GLOW_SPEED = 0.25;
const GLOW_LIGHT = 1.3;
/** Floats per texel in the point texture. */
const TEXEL = 4;

/** Can this context blend into a render target of this format? (Checked by drawing.) */
function canBlendInto(gl: WebGL2RenderingContext, format: TextureFormat, probe: ShaderProgram) {
  const texture = gl.createTexture();
  const fbo = gl.createFramebuffer();
  if (!texture || !fbo) return false;
  let ok = false;
  try {
    while (gl.getError() !== gl.NO_ERROR && !gl.isContextLost()) {
      /* drain earlier errors */
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      format.internalFormat,
      4,
      4,
      0,
      format.format,
      format.type,
      null,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) {
      gl.viewport(0, 0, 4, 4);
      probe.use();
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      ok = gl.getError() === gl.NO_ERROR;
      gl.disable(gl.BLEND);
    }
  } finally {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(texture);
  }
  return ok;
}

interface Programs {
  ribbon: ShaderProgram;
  fade: ShaderProgram;
  one: ShaderProgram;
  copy: ShaderProgram;
  display: ShaderProgram;
  strand: ShaderProgram;
}

export class FilamentsMaterial implements VisualMaterial {
  readonly id = FILAMENTS_META.id;
  readonly version = FILAMENTS_META.version;
  readonly name = FILAMENTS_META.name;
  readonly description = FILAMENTS_META.description;
  readonly properties = FILAMENTS_META.properties;

  private gl: WebGL2RenderingContext | null = null;
  private res: GlResources | null = null;
  private programs: Programs | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private pointsTex: WebGLTexture | null = null;
  private paletteTex: WebGLTexture | null = null;
  private ribbons: RenderTarget | null = null;
  private ribbonFormat: TextureFormat | null = null;
  /** True when the ribbon buffer is 8-bit (no float blending): fades need a floor. */
  private lowPrecision = false;
  private sim: FilamentSim | null = null;
  private points = new Float32Array(0);
  private pointsDirty = true;
  private quality: Quality = 'standard';
  private width = 1;
  private height = 1;
  /** The last step's length (the strands' glow reads speed from their last move). */
  private lastDt = 1 / 60;
  private simParams: FilamentSimParams;
  private display: FilamentDisplayParams;

  constructor() {
    const baseline = filamentParams(baselineValues(FILAMENTS_PROPERTIES), this.quality);
    this.simParams = baseline.sim;
    this.display = baseline.display;
  }

  /** Builds everything synchronously; the promise only reports the outcome. */
  init(ctx: VisualContext): Promise<void> {
    try {
      this.dispose();
      const gl = ctx.gl;
      const res = new GlResources(gl);
      this.gl = gl;
      this.res = res;
      this.quality = ctx.quality;
      this.width = Math.max(1, Math.round(ctx.width));
      this.height = Math.max(1, Math.round(ctx.height));
      this.programs = {
        ribbon: createProgram(res, RIBBON_VERTEX, RIBBON_FRAGMENT, { name: 'filament ribbons' }),
        fade: createProgram(res, SCREEN_VERTEX, FADE_FRAGMENT, { name: 'filament fade' }),
        one: createProgram(res, SCREEN_VERTEX, ONE_FRAGMENT, { name: 'filament floor' }),
        copy: createProgram(res, SCREEN_VERTEX, COPY_FRAGMENT, { name: 'filament copy' }),
        display: createProgram(res, SCREEN_VERTEX, DISPLAY_FRAGMENT, { name: 'filament display' }),
        strand: createProgram(res, STRAND_VERTEX, STRAND_FRAGMENT, { name: 'filament strands' }),
      };
      // Everything is drawn from gl_VertexID / gl_InstanceID: no attributes.
      this.vao = res.vertexArray();
      gl.bindVertexArray(this.vao);
      this.ribbonFormat = this.pickRibbonFormat(gl);
      const capacity = FILAMENT_TIER_CAPS[ctx.quality];
      this.points = new Float32Array((POINTS_PER_STRAND + 1) * capacity * TEXEL);
      this.pointsTex = createTexture(
        res,
        POINTS_PER_STRAND + 1,
        capacity,
        { internalFormat: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT, channels: 4 },
        { filter: gl.NEAREST },
      );
      this.paletteTex = createTexture(
        res,
        PALETTE_SIZE,
        1,
        { internalFormat: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, channels: 4 },
        { filter: gl.LINEAR, wrap: gl.REPEAT, data: WAKE_PALETTE_BYTES },
      );
      gl.bindVertexArray(null);
      this.ribbons = this.createRibbons(this.width, this.height);
      this.sim = new FilamentSim(capacity, this.width, this.height);
      this.setProperties(baselineValues(FILAMENTS_PROPERTIES));
      this.reset(ctx.seed);
      return Promise.resolve();
    } catch (error) {
      this.dispose();
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  reset(seed: number): void {
    this.sim?.reset(seed);
    this.pointsDirty = true;
    this.lastDt = 1 / 60;
    const gl = this.gl;
    if (gl && this.ribbons && !gl.isContextLost()) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.ribbons.fbo);
      gl.viewport(0, 0, this.ribbons.width, this.ribbons.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
  }

  step(frame: SignatureFrame, props: PropertyValues, dt: number): void {
    const params = filamentParams(props, this.quality);
    this.simParams = params.sim;
    this.display = params.display;
    const sim = this.sim;
    if (!sim) return;
    sim.step(frame, params.sim, dt);
    if (dt > 0) this.lastDt = dt;
    this.pointsDirty = true;
    this.paintRibbons(sim, dt);
  }

  /** Apply display-only properties (brightness, thickness of the strands) while paused. */
  setProperties(props: PropertyValues): void {
    const params = filamentParams(props, this.quality);
    this.display = params.display;
    if (!this.sim || this.sim.steps === 0) this.simParams = params.sim;
  }

  draw(): void {
    const gl = this.gl;
    const programs = this.programs;
    const sim = this.sim;
    if (!gl || !programs || !sim || !this.ribbons || gl.isContextLost()) return;
    // Before the first step (t = 0, paused), show the strands as the first step lays them out.
    if (!sim.populated) {
      sim.populate(this.simParams);
      this.pointsDirty = true;
    }
    this.uploadPoints(sim);
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    resetPassState(gl);
    gl.bindVertexArray(this.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);

    // The ribbons (this also covers the canvas with true black where there are none).
    const display = programs.display;
    display.use();
    gl.uniform1i(display.u('uRibbons'), bindTexture(gl, 0, this.ribbons.texture));
    gl.uniform1f(display.u('uExposure'), Math.max(0, this.display.exposure));
    gl.uniform1f(display.u('uSaturation'), Math.max(0, this.display.saturation));
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // The strands on top.
    if (sim.count > 0) {
      const strand = programs.strand;
      strand.use();
      this.bindPoints(strand);
      const unit = Math.min(width, height);
      gl.uniform2f(strand.u('uPxPerUnit'), width / sim.worldWidth, height / sim.worldHeight);
      gl.uniform2f(strand.u('uCanvasPx'), width, height);
      gl.uniform1f(strand.u('uWidthPx'), Math.max(0, this.display.width) * unit);
      gl.uniform1f(strand.u('uDt'), this.lastDt);
      gl.uniform1f(strand.u('uUnitPx'), unit);
      gl.uniform3f(strand.u('uRestColor'), REST_COLOR[0], REST_COLOR[1], REST_COLOR[2]);
      gl.uniform1f(strand.u('uRestLight'), REST_LIGHT);
      gl.uniform1f(strand.u('uGlowSpeed'), GLOW_SPEED);
      gl.uniform1f(strand.u('uGlowLight'), GLOW_LIGHT);
      gl.uniform1f(strand.u('uExposure'), Math.max(0, this.display.exposure));
      gl.uniform1f(strand.u('uSaturation'), Math.max(0, this.display.saturation));
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 2 * POINTS_PER_STRAND, sim.count);
      gl.disable(gl.BLEND);
    }
    gl.bindVertexArray(null);
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, Math.round(width));
    this.height = Math.max(1, Math.round(height));
    this.sim?.setCanvas(this.width, this.height);
    const gl = this.gl;
    const programs = this.programs;
    const old = this.ribbons;
    if (!gl || !programs || !old || !this.res) return;
    const size = this.ribbonSize(this.width, this.height);
    if (size.width === old.width && size.height === old.height) return;
    // Keep the ribbons: copy the old buffer into the new one.
    const next = this.createRibbons(this.width, this.height);
    resetPassState(gl);
    gl.bindVertexArray(this.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, next.fbo);
    gl.viewport(0, 0, next.width, next.height);
    programs.copy.use();
    gl.uniform1i(programs.copy.u('uSource'), bindTexture(gl, 0, old.texture));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
    deleteRenderTarget(this.res, old);
    this.ribbons = next;
  }

  dispose(): void {
    this.res?.dispose();
    this.res = null;
    this.gl = null;
    this.programs = null;
    this.vao = null;
    this.pointsTex = null;
    this.paletteTex = null;
    this.ribbons = null;
    this.ribbonFormat = null;
    this.sim = null;
  }

  /** Diagnostics: strands in play, the tier's cap, and the ribbon buffer. */
  describe(): string {
    const sim = this.sim;
    const r = this.ribbons;
    if (!sim || !r) return 'not initialized';
    const precision = this.lowPrecision ? '8-bit' : 'float';
    return `${this.quality}: ${sim.count} strands (up to ${sim.capacity} at this tier), ribbons ${r.width}×${r.height} ${precision}`;
  }

  // ---------------------------------------------------------------------------------

  /** Half-float (or float) with blending if the context allows it, else 8-bit. */
  private pickRibbonFormat(gl: WebGL2RenderingContext): TextureFormat {
    const programs = this.programs;
    const support = detectRenderTargets(gl);
    if (support && programs && canBlendInto(gl, support.rgba, programs.fade)) {
      this.lowPrecision = false;
      return support.rgba;
    }
    this.lowPrecision = true;
    return { internalFormat: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, channels: 4 };
  }

  private ribbonSize(width: number, height: number): { width: number; height: number } {
    const short = Math.min(width, height);
    const scale = Math.min(1, RIBBON_SHORT_SIDE[this.quality] / short);
    return {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
    };
  }

  private createRibbons(width: number, height: number): RenderTarget {
    const res = this.res as GlResources;
    const gl = res.gl;
    const size = this.ribbonSize(width, height);
    return createRenderTarget(
      res,
      size.width,
      size.height,
      this.ribbonFormat as TextureFormat,
      gl.LINEAR,
    );
  }

  /** Copy the strands' points (now and at the start of the step) and looks to the GPU. */
  private uploadPoints(sim: FilamentSim): void {
    const gl = this.gl;
    if (!gl || !this.pointsTex || !this.pointsDirty) return;
    const N = POINTS_PER_STRAND;
    const row = (N + 1) * TEXEL;
    const out = this.points;
    const count = Math.min(sim.count, out.length / row);
    const { x, y, ox, oy, tint, glow, appear } = sim;
    for (let f = 0; f < count; f++) {
      let o = f * row;
      const base = f * N;
      for (let j = 0; j < N; j++) {
        const i = base + j;
        out[o] = x[i];
        out[o + 1] = y[i];
        out[o + 2] = ox[i];
        out[o + 3] = oy[i];
        o += TEXEL;
      }
      out[o] = tint[f];
      out[o + 1] = glow[f];
      out[o + 2] = appear[f];
      out[o + 3] = 0;
    }
    if (count > 0) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.pointsTex);
      resetUnpackState(gl);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, N + 1, count, gl.RGBA, gl.FLOAT, out, 0);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
    this.pointsDirty = false;
  }

  private bindPoints(program: ShaderProgram): void {
    const gl = this.gl as WebGL2RenderingContext;
    gl.uniform1i(program.u('uPoints'), bindTexture(gl, 0, this.pointsTex as WebGLTexture));
    gl.uniform1i(program.u('uPalette'), bindTexture(gl, 1, this.paletteTex as WebGLTexture));
    gl.uniform1i(program.u('uPerStrand'), POINTS_PER_STRAND);
  }

  /** Fade the ribbon buffer by one step and paint the bands the strands just swept. */
  private paintRibbons(sim: FilamentSim, dt: number): void {
    const gl = this.gl;
    const programs = this.programs;
    const ribbons = this.ribbons;
    if (!gl || !programs || !ribbons || gl.isContextLost()) return;
    this.uploadPoints(sim);
    resetPassState(gl);
    gl.bindVertexArray(this.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, ribbons.fbo);
    gl.viewport(0, 0, ribbons.width, ribbons.height);
    gl.enable(gl.BLEND);

    // Fade: dst × e^(−rate·dt).
    programs.fade.use();
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ZERO, gl.CONSTANT_ALPHA);
    gl.blendColor(0, 0, 0, Math.exp(-Math.max(0, this.display.trailFade) * dt));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (this.lowPrecision) {
      // 8-bit values would stick at small levels: also take away one level per step.
      gl.blendEquation(gl.FUNC_REVERSE_SUBTRACT);
      gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE);
      gl.blendColor(0, 0, 0, 1 / 255);
      programs.one.use();
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.blendEquation(gl.FUNC_ADD);
    }

    // Paint the swept bands.
    const segments = sim.count * (POINTS_PER_STRAND - 1);
    if (segments > 0) {
      const ribbon = programs.ribbon;
      ribbon.use();
      this.bindPoints(ribbon);
      const pxX = ribbons.width / sim.worldWidth;
      const pxY = ribbons.height / sim.worldHeight;
      const unit = Math.min(ribbons.width, ribbons.height);
      const width = Math.max(0, this.display.width);
      gl.uniform2f(ribbon.u('uPxPerUnit'), pxX, pxY);
      gl.uniform2f(ribbon.u('uTargetPx'), ribbons.width, ribbons.height);
      gl.uniform1f(ribbon.u('uFilterPx'), Math.max(1, width * unit));
      gl.uniform1f(ribbon.u('uDt'), dt);
      gl.uniform2f(ribbon.u('uSpeedRange'), RIBBON_SPEED_MIN, RIBBON_SPEED_MAX);
      // Thicker strands leave more light (a long exposure of a wider strand).
      gl.uniform1f(ribbon.u('uGain'), RIBBON_GAIN * (width / BASE_WIDTH) ** 0.7);
      gl.uniform1f(ribbon.u('uUnitPx'), unit);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, segments);
    }
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
  }
}
