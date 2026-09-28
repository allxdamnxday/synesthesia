/**
 * V4 Descending bubbles (SPEC 9.4): clear, rim-lit bubbles sinking through dark water.
 * The movement shoves them; pushed bubbles glow in the color of their push, stretch with
 * their speed, wobble after the push, and carry its imprint as they keep falling.
 *
 * The simulation is CPU-side (`BubbleSim`, typed arrays) and advances exactly once per
 * `step()`. `draw()` only packs the current state into an instance buffer and draws one
 * instanced quad per bubble, so drawing any number of times never changes the state.
 */
import type { SignatureFrame } from '../../../signature/types';
import { baselineValues } from '../../properties';
import type { PropertyValues, Quality, VisualContext, VisualMaterial } from '../../types';
import {
  GlResources,
  bindTexture,
  createProgram,
  createTexture,
  resetPassState,
  type ShaderProgram,
} from '../shared/gl';
import { PALETTE_SIZE, WAKE_PALETTE_BYTES } from '../shared/wakePalette';
import { BubbleSim } from './BubbleSim';
import {
  BUBBLE_TIER_CAPS,
  bubbleParams,
  type BubbleDisplayParams,
  type BubbleSimParams,
} from './mapping';
import { BUBBLES_PROPERTIES } from './properties';
import { BUBBLE_FRAGMENT, BUBBLE_VERTEX } from './shaders';

export const BUBBLES_META = {
  id: 'bubbles',
  version: 1,
  name: 'Descending bubbles',
  description:
    'Clear bubbles sinking through dark water. The movement shoves them aside; they glow, wobble, and carry its shape as they fall.',
  properties: BUBBLES_PROPERTIES,
};

/** Floats per bubble in the instance buffer: centre, glow, shape matrix, light. */
const FLOATS_PER_BUBBLE = 10;
/** Motion stretch per short side per second of speed, and its cap. */
const STRETCH_PER_SPEED = 2;
const STRETCH_MAX = 2.2;
/** Pearl rims at rest. */
const REST_COLOR: readonly [number, number, number] = [0.8, 0.87, 0.96];
/** Extra light on a fully glowing bubble. */
const GLOW_GAIN = 3.5;
/** A popping bubble swells by this much and flashes by this much before it fades. */
const POP_SWELL = 0.45;
const POP_FLASH = 1.5;

export class BubblesMaterial implements VisualMaterial {
  readonly id = BUBBLES_META.id;
  readonly version = BUBBLES_META.version;
  readonly name = BUBBLES_META.name;
  readonly description = BUBBLES_META.description;
  readonly properties = BUBBLES_META.properties;

  private gl: WebGL2RenderingContext | null = null;
  private res: GlResources | null = null;
  private program: ShaderProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private buffer: WebGLBuffer | null = null;
  private paletteTex: WebGLTexture | null = null;
  private sim: BubbleSim | null = null;
  private instances = new Float32Array(0);
  private quality: Quality = 'standard';
  private simParams: BubbleSimParams;
  private display: BubbleDisplayParams;

  constructor() {
    const baseline = bubbleParams(baselineValues(BUBBLES_PROPERTIES), this.quality);
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
      this.program = createProgram(res, BUBBLE_VERTEX, BUBBLE_FRAGMENT, { name: 'bubbles' });
      this.paletteTex = createTexture(
        res,
        PALETTE_SIZE,
        1,
        { internalFormat: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, channels: 4 },
        { filter: gl.LINEAR, wrap: gl.REPEAT, data: WAKE_PALETTE_BYTES },
      );
      const capacity = BUBBLE_TIER_CAPS[ctx.quality];
      this.instances = new Float32Array(capacity * FLOATS_PER_BUBBLE);
      this.vao = res.vertexArray();
      this.buffer = res.buffer();
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, this.instances.byteLength, gl.DYNAMIC_DRAW);
      const stride = FLOATS_PER_BUBBLE * 4;
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 4, gl.FLOAT, false, stride, 0);
      gl.vertexAttribDivisor(0, 1);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 16);
      gl.vertexAttribDivisor(1, 1);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 32);
      gl.vertexAttribDivisor(2, 1);
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      this.sim = new BubbleSim(capacity, ctx.width, ctx.height);
      this.setProperties(baselineValues(BUBBLES_PROPERTIES));
      this.reset(ctx.seed);
      return Promise.resolve();
    } catch (error) {
      this.dispose();
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  reset(seed: number): void {
    this.sim?.reset(seed);
  }

  step(frame: SignatureFrame, props: PropertyValues, dt: number): void {
    const params = bubbleParams(props, this.quality);
    this.simParams = params.sim;
    this.display = params.display;
    this.sim?.step(frame, params.sim, dt);
  }

  /** Apply display-only properties (brightness, size) without advancing time. */
  setProperties(props: PropertyValues): void {
    const params = bubbleParams(props, this.quality);
    this.display = params.display;
    // Also what a not-yet-stepped simulation shows at t = 0.
    if (!this.sim || this.sim.steps === 0) this.simParams = params.sim;
  }

  draw(): void {
    const gl = this.gl;
    const program = this.program;
    const sim = this.sim;
    if (!gl || !program || !sim || !this.vao || !this.buffer || gl.isContextLost()) return;
    // Before the first step (t = 0, paused), show the water as the first step will fill it.
    if (!sim.populated) sim.populate(this.simParams);
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    resetPassState(gl);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const count = this.pack(sim);
    if (count === 0) return;

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instances, 0, count * FLOATS_PER_BUBBLE);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    program.use();
    gl.uniform2f(program.u('uWorld'), sim.worldWidth, sim.worldHeight);
    gl.uniform1f(program.u('uPxPerUnit'), Math.min(width, height));
    gl.uniform1i(program.u('uPalette'), bindTexture(gl, 0, this.paletteTex as WebGLTexture));
    gl.uniform3f(program.u('uRestColor'), REST_COLOR[0], REST_COLOR[1], REST_COLOR[2]);
    gl.uniform1f(program.u('uExposure'), Math.max(0, this.display.exposure));
    gl.uniform1f(program.u('uSaturation'), Math.max(0, this.display.saturation));
    gl.uniform1f(program.u('uGlowGain'), GLOW_GAIN);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  resize(width: number, height: number): void {
    this.sim?.setCanvas(width, height);
  }

  dispose(): void {
    this.res?.dispose();
    this.res = null;
    this.gl = null;
    this.program = null;
    this.vao = null;
    this.buffer = null;
    this.paletteTex = null;
    this.sim = null;
  }

  /** Diagnostics: bubbles in play and the tier's cap. */
  describe(): string {
    const sim = this.sim;
    if (!sim) return 'not initialized';
    return `${this.quality}: ${sim.count} bubbles (up to ${sim.capacity} at this tier)`;
  }

  /** Write each bubble's centre, glow, shape and light into the instance buffer. */
  private pack(sim: BubbleSim): number {
    const out = this.instances;
    const n = Math.min(sim.count, out.length / FLOATS_PER_BUBBLE);
    const radius = Math.max(0, this.display.radius);
    const fallSpeed = this.simParams.fallSpeed;
    const { px, py, dx, dy, vx, vy, wx, wy, gx, gy, wob, axX, axY, size, fall, wear } = sim;
    let o = 0;
    for (let i = 0; i < n; i++) {
      // Velocity as seen: pushed motion + wandering + the fall.
      const tvx = vx[i] + wx[i];
      const tvy = vy[i] + wy[i] - fallSpeed * fall[i];
      const speed = Math.sqrt(tvx * tvx + tvy * tvy);
      // Motion stretch along the velocity (slightly thinner across).
      const along = 1 + Math.min(STRETCH_MAX, speed * STRETCH_PER_SPEED);
      const across = 1 / Math.sqrt(Math.sqrt(along));
      let mx = 0;
      let my = 1;
      if (speed > 1e-9) {
        mx = tvx / speed;
        my = tvy / speed;
      }
      // S_motion = across·I + (along − across)·m mᵀ
      const ka = along - across;
      const s00 = across + ka * mx * mx;
      const s01 = ka * mx * my;
      const s11 = across + ka * my * my;
      // S_wobble = (1 − w/2)·I + (3w/2)·a aᵀ
      const w = wob[i];
      const base = 1 - 0.5 * w;
      const kw = 1.5 * w;
      const ax = axX[i];
      const ay = axY[i];
      const w00 = base + kw * ax * ax;
      const w01 = kw * ax * ay;
      const w11 = base + kw * ay * ay;
      // Popping: swell, flash, and fade. Re-forming: grow and fade back in.
      let grow = 1;
      let alpha = 1;
      const state = wear[i];
      if (state >= 2) {
        const t = Math.min(1, state - 2);
        const s = t * t * (3 - 2 * t);
        grow = 0.35 + 0.65 * s;
        alpha = s;
      } else if (state >= 1) {
        const t = state - 1;
        const left = 1 - t;
        grow = 1 + POP_SWELL * Math.sqrt(t);
        alpha = left * left * (1 + POP_FLASH * left);
      }
      const r = radius * size[i] * grow;
      // M = r · S_motion · S_wobble (column-major: columns (m00, m10), (m01, m11)).
      out[o] = px[i] + dx[i];
      out[o + 1] = py[i] + dy[i];
      out[o + 2] = gx[i];
      out[o + 3] = gy[i];
      out[o + 4] = r * (s00 * w00 + s01 * w01);
      out[o + 5] = r * (s01 * w00 + s11 * w01);
      out[o + 6] = r * (s00 * w01 + s01 * w11);
      out[o + 7] = r * (s01 * w01 + s11 * w11);
      // Smaller (farther) bubbles are a little dimmer.
      out[o + 8] = 0.3 + 0.26 * Math.min(1.6, size[i]);
      out[o + 9] = alpha;
      o += FLOATS_PER_BUBBLE;
    }
    return n;
  }
}
