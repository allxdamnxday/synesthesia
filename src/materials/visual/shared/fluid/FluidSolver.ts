/*
 * Adapted from WebGL-Fluid-Simulation by Pavel Dobryakov, MIT License,
 * Copyright (c) 2017 Pavel Dobryakov. See LICENSE-webgl-fluid.txt in this folder.
 */

/**
 * The shared stable-fluids solver (SPEC 9.4) that Water, Honey and Smoke are built on.
 *
 * One `step()` advances the fluid by a fixed dt of composition time:
 *   1. upload the signature field (optionally low-passed, for Honey's lag)
 *   2. force: add the projected field × gain × dt to velocity
 *   3. dye: release dye ∝ |field| × amount, coloured by direction (palette texture);
 *      skipped when the amount is 0 (a material releasing its own)
 *   4. viscosity: implicit diffusion of velocity (Jacobi), true viscosity
 *   5. vorticity confinement
 *   6. hooks.beforeProjection (body forces: buoyancy, springs)
 *   7. pressure projection (divergence, warm-started Jacobi, gradient subtract)
 *   8. advect velocity and dye (semi-Lagrangian, exponential decay)
 *   9. hooks.afterAdvection (update custom fields)
 * `display()` draws the dye to the canvas.
 *
 * There is no randomness and no clock inside: every step is a pure function of the
 * previous state, the field, and the parameters (jitter phase and seed come from the
 * caller's seeded rng). Parameters are resolution-independent (lengths are in canvas
 * short sides), so a Standard preview and a High render show the same wake.
 *
 * Extending: materials add fields with `createFieldTarget()` and passes with
 * `createPass()`, run them in the hooks, and `advect()` their fields. A pass that needs
 * the signature's push includes SIGNATURE_FORCE_GLSL and calls `bindSignatureForce()`;
 * `fieldMagnitude()` says whether anything moves this step.
 * - Honey (visual/honey): a lagging push (`forceLowPassSec`) with dye released from the
 *   field as it arrives (`dyeFromRawField`) and drawn into strokes (`dyeStrokeLength`);
 *   viscous diffusion by a Gaussian kernel and an elastic spring −k·D in
 *   `beforeProjection`, the displacement D carried with the flow in `afterAdvection`.
 * - Smoke (visual/smoke): its own emission pass (burst radius, vents) instead of the dye
 *   pass, heat and buoyancy in `beforeProjection`, heat carried in `afterAdvection`, and
 *   its own simulation grid (`simCells`) solved to convergence at every tier.
 */
import type { Quality } from '../../../types';
import {
  GlResources,
  bindTexture,
  clearTarget,
  createDoubleRenderTarget,
  createFullscreenTriangle,
  createProgram,
  createRenderTarget,
  createTexture,
  compileShader,
  deleteDoubleRenderTarget,
  deleteRenderTarget,
  detectRenderTargets,
  resetPassState,
  resetUnpackState,
  withHeader,
  type DoubleRenderTarget,
  type FullscreenTriangle,
  type RenderTarget,
  type RenderTargetOverrides,
  type RenderTargetSupport,
  type ShaderProgram,
  type TextureFormat,
} from '../gl';
import { HueTurn } from '../hue';
import { PALETTE_SIZE } from './palette';
import { SPOT_MEAN, SPOT_TEXTURE_SIZE, generateSpotTexture } from './spots';
import {
  FLUID_TIERS,
  diffusionAlpha,
  dyeGridForCanvas,
  fieldDiagonalInCells,
  gridForCanvas,
  projectField,
  tierIterations,
  type GridSize,
  type ProjectionRect,
} from './projection';
import {
  ADVECTION_FRAGMENT,
  BASE_VERTEX,
  COPY_FRAGMENT,
  CURL_FRAGMENT,
  DISPLAY_FRAGMENT,
  DIVERGENCE_FRAGMENT,
  DYE_FRAGMENT,
  FORCE_FRAGMENT,
  GRADIENT_SUBTRACT_FRAGMENT,
  PRESSURE_FRAGMENT,
  SCALE_FRAGMENT,
  VISCOSITY_FRAGMENT,
  VORTICITY_FRAGMENT,
} from './shaders';

export interface FluidSolverOptions {
  quality: Quality;
  /** Canvas drawing-buffer size; the grids follow its aspect ratio. */
  width: number;
  height: number;
  /** Force the capability fallbacks (tests and Diagnostics only). */
  overrides?: RenderTargetOverrides;
  /**
   * Simulation grid short side, cells, instead of the tier's (dye resolution still
   * follows the tier). For a material whose flow must be solved to convergence, which
   * is only affordable on a coarse grid (Smoke).
   */
  simCells?: number;
}

/** A signature field as it arrives in a SignatureFrame. */
export interface SignatureField {
  /** rows × cols × 2 (u, v), row-major, top row first; field diagonals per second, y down. */
  field: Float32Array;
  cols: number;
  rows: number;
}

/**
 * Per-step parameters. Lengths are in canvas short sides and times in seconds, so the
 * same values give the same wake at every quality tier.
 */
export interface FluidStepParams {
  /** Fixed step, normally FIXED_DT. */
  dt: number;
  /** 0..1: compressed (0), fitted (0.5), magnified (1). See projection.ts. */
  range: number;
  /**
   * Fraction of the signature's velocity added to the fluid per second of push, 1/s.
   * Signature strength is already applied to the field by the sampler.
   */
  forceGain: number;
  /** Low-pass time constant for the field (Honey's lag), seconds; 0 = off. */
  forceLowPassSec: number;
  /** Seeded scatter of the push: rotation amplitude, radians. */
  jitterAngle: number;
  /** Seeded scatter of the push: displacement amplitude, short sides. */
  jitterOffset: number;
  /** Size of the scatter pattern: noise cells per short side. */
  jitterFrequency: number;
  /** Where in the scatter pattern this step samples (from the caller's seeded rng). */
  jitterPhaseX: number;
  jitterPhaseY: number;
  /** Selects the seeded patterns: scatter and dye spots (from the caller's seed). */
  patternSeed: number;
  /** Dye released per (field diagonal per second) of push, per second. */
  dyeAmount: number;
  /**
   * 0..1: how much the release is concentrated in a seeded pattern of spots fixed in the
   * bowl (0 = everywhere the movement is). Spots leave streaks that trace the flow.
   */
  dyeSpots: number;
  /** 0..1: fraction of the spots that release dye (more = denser streaks). */
  dyeSpotCoverage: number;
  /** Dye fade rate, 1/s (exponential). */
  dyeDissipation: number;
  /** Velocity fade rate, 1/s (drag). */
  velocityDissipation: number;
  /** Kinematic viscosity ν, (short side)²/s. 0 = inviscid. */
  viscosity: number;
  /**
   * Jacobi iterations for viscosity at the Standard grid (0 skips it). The solver scales
   * this by (grid / 128)² (see `tierIterations`): with large α, Jacobi's convergence per
   * iteration falls with the square of the resolution, so this keeps a Standard preview
   * and a High render equally viscous.
   */
  viscosityIterations: number;
  /** Vorticity confinement strength, short sides (the original's CURL 30 at 128 ≈ 0.23). */
  vorticity: number;
  /** Pressure Jacobi iterations; defaults to the tier's count. */
  pressureIterations?: number;
  /** Fraction of last step's pressure kept as the starting guess (original: 0.8). */
  pressureWarmStart?: number;
  /**
   * Release dye from the field as it arrives instead of the low-passed push (default
   * false). With `forceLowPassSec`, the dye then marks the moment of movement while the
   * fluid's response lags behind it (Honey). No effect without a low-pass.
   */
  dyeFromRawField?: boolean;
  /**
   * Draw each spot's release out into a stroke this long along the push, in short sides
   * (default 0: round spots, smeared only by the flow). A slow fluid (Honey) then shows
   * strokes from the moment of release.
   */
  dyeStrokeLength?: number;
}

export interface FluidDisplayParams {
  /** Multiplies dye before tone mapping. */
  exposure: number;
  /** 1 = as dyed; below 1 toward grey, above 1 more saturated. */
  saturation: number;
  /** 0..1: shading, refraction and glints that suggest looking up through liquid. */
  surfaceLight: number;
  /** Hue turn of the dye's colors, in turns (0 or absent: as dyed). */
  hue?: number;
}

export const DEFAULT_STEP_PARAMS: Readonly<Omit<FluidStepParams, 'dt'>> = {
  range: 0.5,
  forceGain: 6,
  forceLowPassSec: 0,
  jitterAngle: 0,
  jitterOffset: 0,
  jitterFrequency: 3,
  jitterPhaseX: 0,
  jitterPhaseY: 0,
  patternSeed: 0,
  dyeAmount: 4,
  dyeSpots: 0,
  dyeSpotCoverage: 1,
  dyeDissipation: 0.6,
  velocityDissipation: 0.2,
  viscosity: 0,
  viscosityIterations: 0,
  vorticity: 0.2,
};

/**
 * Surface light: how hard the dye-thickness gradient tilts the surface, over what
 * footprint the gradient is measured (short sides), and how far the tilt refracts.
 */
const SURFACE_SLOPE_SCALE = 0.05;
const SURFACE_SLOPE_REACH = 0.008;
const SURFACE_REFRACTION = 0.015;
/** Velocity clamp after vorticity confinement, in short sides per second. */
const MAX_SPEED_SHORT_SIDES = 8;

export interface FluidHookContext {
  gl: WebGL2RenderingContext;
  solver: FluidSolver;
  params: Readonly<FluidStepParams>;
}

/** Anything with texel sizes: a RenderTarget or a DoubleRenderTarget. */
export interface TexelSized {
  readonly texelSizeX: number;
  readonly texelSizeY: number;
}

/** Extension points for materials that add fields or body forces (see file header). */
export interface FluidHooks {
  beforeProjection?: (ctx: FluidHookContext) => void;
  afterAdvection?: (ctx: FluidHookContext) => void;
}

interface Programs {
  force: ShaderProgram;
  dye: ShaderProgram;
  /** The dye pass compiled with DYE_STREAK (`dyeStrokeLength`). */
  dyeStreak: ShaderProgram;
  viscosity: ShaderProgram;
  curl: ShaderProgram;
  vorticity: ShaderProgram;
  divergence: ShaderProgram;
  scale: ShaderProgram;
  pressure: ShaderProgram;
  gradient: ShaderProgram;
  advection: ShaderProgram;
  display: ShaderProgram;
  copy: ShaderProgram;
}

const FIELD_FORMAT = (gl: WebGL2RenderingContext): TextureFormat => ({
  internalFormat: gl.RG16F,
  format: gl.RG,
  type: gl.FLOAT,
  channels: 2,
});

export class FluidSolver {
  readonly gl: WebGL2RenderingContext;
  readonly quality: Quality;
  readonly support: RenderTargetSupport;
  /** Every GL object the solver (and its hooks' passes) owns. */
  readonly resources: GlResources;
  hooks: FluidHooks = {};

  /** Velocity grid (cells per second). */
  velocity!: DoubleRenderTarget;
  /** Dye grid (RGB). */
  dye!: DoubleRenderTarget;
  simGrid: GridSize;
  dyeGrid: GridSize;

  private readonly programs: Programs;
  private readonly triangle: FullscreenTriangle;
  private readonly vertexShader: WebGLShader;
  private readonly filter: number;
  private width: number;
  private height: number;
  private readonly simCells: number | undefined;
  private scratch!: DoubleRenderTarget;
  private pressure!: DoubleRenderTarget;
  private divergence!: RenderTarget;
  private curl!: RenderTarget;
  private fieldTex: WebGLTexture | null = null;
  /** The field before the low-pass, for `dyeFromRawField`; created on first use. */
  private rawFieldTex: WebGLTexture | null = null;
  private fieldCols = 0;
  private fieldRows = 0;
  private lowPass: Float32Array | null = null;
  private upload: Float32Array = new Float32Array(0);
  /** This step's projection, parameters and largest push, for hook passes. */
  private stepRect: ProjectionRect = { x: 0, y: 0, width: 1, height: 1 };
  private stepParams: FluidStepParams | null = null;
  private stepForceMagnitude = 0;
  private stepRawMagnitude = 0;
  private readonly paletteTex: WebGLTexture;
  private readonly spotTex: WebGLTexture;
  private spotSeed: number | null = null;
  private readonly hueTurn = new HueTurn();
  private disposed = false;

  constructor(gl: WebGL2RenderingContext, options: FluidSolverOptions) {
    this.gl = gl;
    this.quality = options.quality;
    this.simCells =
      options.simCells !== undefined && options.simCells >= 8
        ? Math.round(options.simCells)
        : undefined;
    this.width = Math.max(1, Math.round(options.width));
    this.height = Math.max(1, Math.round(options.height));
    const support = detectRenderTargets(gl, options.overrides);
    if (!support) {
      throw new Error(
        'This graphics card cannot draw into floating-point textures, which the fluid needs.',
      );
    }
    this.support = support;
    this.filter = support.linearFiltering ? gl.LINEAR : gl.NEAREST;
    this.resources = new GlResources(gl);
    try {
      this.triangle = createFullscreenTriangle(this.resources);
      this.vertexShader = compileShader(
        this.resources,
        gl.VERTEX_SHADER,
        withHeader(BASE_VERTEX),
        'fluid base',
      );
      this.programs = this.compilePrograms();
      this.paletteTex = createTexture(
        this.resources,
        PALETTE_SIZE,
        1,
        { internalFormat: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, channels: 4 },
        { filter: gl.LINEAR, wrap: gl.REPEAT, data: new Uint8Array(PALETTE_SIZE * 4).fill(255) },
      );
      this.spotTex = createTexture(
        this.resources,
        SPOT_TEXTURE_SIZE,
        SPOT_TEXTURE_SIZE,
        { internalFormat: gl.RG8, format: gl.RG, type: gl.UNSIGNED_BYTE, channels: 2 },
        { filter: gl.LINEAR, wrap: gl.REPEAT },
      );
      this.simGrid = this.simGridFor(this.width, this.height);
      this.dyeGrid = this.dyeGridFor(this.width, this.height);
      this.allocate(null, null);
    } catch (error) {
      this.resources.dispose();
      throw error;
    }
  }

  /** Compile a full-screen pass sharing the solver's vertex shader (freed on dispose). */
  createPass(fragmentBody: string, name: string, defines: string[] = []): ShaderProgram {
    return createProgram(this.resources, this.vertexShader, fragmentBody, { name, defines });
  }

  /** A ping-pong target at simulation (or dye) resolution for a custom field. */
  createFieldTarget(
    channels: 'r' | 'rg' | 'rgba',
    grid: 'sim' | 'dye' = 'sim',
  ): DoubleRenderTarget {
    const size = grid === 'sim' ? this.simGrid : this.dyeGrid;
    return createDoubleRenderTarget(
      this.resources,
      size.width,
      size.height,
      this.support[channels],
      this.filter,
    );
  }

  /** Draw the bound program into a target (null = the canvas). */
  blit(target: RenderTarget | null): void {
    this.triangle.blit(target);
  }

  /** The current signature field texture (RG, linear), or null before the first step. */
  get fieldTexture(): WebGLTexture | null {
    return this.fieldTex;
  }

  /**
   * Largest |push| in this step's field (field diagonals per second): the low-passed
   * field when a low-pass is on, or the field as it arrived with `raw`. Hooks use it to
   * skip work while nothing moves.
   */
  fieldMagnitude(raw = false): number {
    return raw ? this.stepRawMagnitude : this.stepForceMagnitude;
  }

  /**
   * For hook passes whose shader includes SIGNATURE_FORCE_GLSL: set its uniforms for the
   * current step (Range projection and seeded scatter, exactly as the force and dye
   * passes use them), set `uTexelSize` for `target`, and bind the field on texture unit 1.
   * `raw` binds the field before the low-pass (when `dyeFromRawField` keeps one).
   * Returns false before the first step, when there is no field yet.
   */
  bindSignatureForce(prog: ShaderProgram, target: TexelSized, raw = false): boolean {
    const p = this.stepParams;
    if (!p || !this.fieldTex) return false;
    const texture = raw && this.rawFieldTex ? this.rawFieldTex : this.fieldTex;
    this.setForceUniforms(prog, this.stepRect, p, target, texture);
    return true;
  }

  /** Semi-Lagrangian advection of any target through the current velocity. */
  advect(target: DoubleRenderTarget, dt: number, dissipation: number): void {
    const gl = this.gl;
    const p = this.programs.advection;
    p.use();
    gl.uniform2f(p.u('uTexelSize'), target.texelSizeX, target.texelSizeY);
    gl.uniform2f(p.u('uVelocityTexel'), this.velocity.texelSizeX, this.velocity.texelSizeY);
    gl.uniform2f(p.u('uSourceTexel'), target.texelSizeX, target.texelSizeY);
    gl.uniform1f(p.u('uDt'), dt);
    gl.uniform1f(p.u('uDecay'), Math.exp(-Math.max(0, dissipation) * dt));
    gl.uniform1i(p.u('uVelocity'), bindTexture(gl, 0, this.velocity.read.texture));
    gl.uniform1i(p.u('uSource'), bindTexture(gl, 1, target.read.texture));
    this.blit(target.write);
    target.swap();
  }

  /**
   * Set the direction palette: PALETTE_SIZE RGBA bytes, entry i is the dye colour for
   * a push in direction angle (i + 0.5) / PALETTE_SIZE × 2π (0 = right, ¼ turn = up).
   */
  setPalette(rgba: Uint8Array): void {
    if (this.disposed) return;
    if (rgba.length !== PALETTE_SIZE * 4) {
      throw new Error(`A palette needs ${PALETTE_SIZE * 4} bytes, got ${rgba.length}.`);
    }
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);
    resetUnpackState(gl);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, PALETTE_SIZE, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  /**
   * Prepare the seeded patterns (dye spots) now, e.g. from the material's reset(), so the
   * first step doesn't pay for generating them. Steps pass the same seed in their params.
   */
  setPatternSeed(seed: number): void {
    if (!this.disposed) this.ensureSpotPattern(seed);
  }

  /** Clear velocity, pressure, dye and the forcing history: the state at t = 0. */
  reset(): void {
    if (this.disposed) return;
    const gl = this.gl;
    for (const t of [this.velocity, this.scratch, this.pressure, this.dye]) clearTarget(gl, t);
    clearTarget(gl, this.divergence);
    clearTarget(gl, this.curl);
    this.lowPass = null;
  }

  /** Advance one fixed step. */
  step(input: SignatureField, params: FluidStepParams): void {
    if (this.disposed || this.gl.isContextLost()) return;
    const gl = this.gl;
    const p = params;
    const dt = p.dt;
    resetPassState(gl);
    this.triangle.bind();

    const maxMagnitude = this.uploadField(input, p);
    const rect = projectField(p.range, input.cols / input.rows, this.width / this.height);
    this.stepRect = rect;
    this.stepParams = p;
    if (maxMagnitude > 1e-9) {
      const cellsPerDiagonal = fieldDiagonalInCells(rect, this.simGrid.width, this.simGrid.height);
      this.applyForce(rect, cellsPerDiagonal * p.forceGain * dt, p);
      if (!this.rawDye(p) && p.dyeAmount > 0) this.injectDye(rect, p.dyeAmount * dt, p);
    }
    // Dye from the field as it arrived: it can move while the low-passed push is still
    // (the start of a movement) and vice versa (the lag after it).
    if (this.rawDye(p) && this.stepRawMagnitude > 1e-9 && p.dyeAmount > 0) {
      this.injectDye(rect, p.dyeAmount * dt, p);
    }
    const short = this.simShort();
    const alpha = diffusionAlpha(p.viscosity, dt, short);
    if (alpha > 0 && p.viscosityIterations > 0) {
      this.diffuse(alpha, tierIterations(p.viscosityIterations, short));
    }
    if (p.vorticity > 0) this.confineVorticity(p.vorticity * short, dt);
    this.hooks.beforeProjection?.({ gl, solver: this, params: p });
    this.project(
      p.pressureIterations ?? FLUID_TIERS[this.quality].pressureIterations,
      p.pressureWarmStart ?? 0.8,
    );
    this.advect(this.velocity, dt, p.velocityDissipation);
    this.advect(this.dye, dt, p.dyeDissipation);
    this.hooks.afterAdvection?.({ gl, solver: this, params: p });
  }

  /** Draw the dye to the canvas's default framebuffer. */
  display(params: FluidDisplayParams): void {
    if (this.disposed || this.gl.isContextLost()) return;
    const gl = this.gl;
    resetPassState(gl);
    const p = this.programs.display;
    p.use();
    const short = Math.min(this.width, this.height);
    gl.uniform2f(p.u('uTexelSize'), 1 / gl.drawingBufferWidth, 1 / gl.drawingBufferHeight);
    gl.uniform2f(p.u('uDyeTexel'), this.dye.texelSizeX, this.dye.texelSizeY);
    gl.uniform1f(p.u('uExposure'), Math.max(0, params.exposure));
    gl.uniform1f(p.u('uSaturation'), Math.max(0, params.saturation));
    gl.uniform1f(p.u('uSurfaceLight'), Math.min(1, Math.max(0, params.surfaceLight)));
    gl.uniform1f(p.u('uSlopeScale'), SURFACE_SLOPE_SCALE);
    gl.uniform1f(p.u('uSlopeReach'), SURFACE_SLOPE_REACH);
    gl.uniform1f(p.u('uRefraction'), SURFACE_REFRACTION);
    gl.uniform2f(p.u('uAspectScale'), this.width / short, this.height / short);
    this.hueTurn.apply(gl, p.u('uHueTurn'), params.hue ?? 0);
    gl.uniform1i(p.u('uDye'), bindTexture(gl, 0, this.dye.read.texture));
    this.blit(null);
  }

  /** The canvas changed size: re-grid (keeping the current wake) if the aspect changed. */
  resize(width: number, height: number): void {
    if (this.disposed) return;
    this.width = Math.max(1, Math.round(width));
    this.height = Math.max(1, Math.round(height));
    const sim = this.simGridFor(this.width, this.height);
    const dye = this.dyeGridFor(this.width, this.height);
    if (sameSize(sim, this.simGrid) && sameSize(dye, this.dyeGrid)) return;
    const oldVelocity = this.velocity;
    const oldDye = this.dye;
    this.releaseWorkGrids();
    this.simGrid = sim;
    this.dyeGrid = dye;
    this.allocate(oldVelocity, oldDye);
    deleteDoubleRenderTarget(this.resources, oldVelocity);
    deleteDoubleRenderTarget(this.resources, oldDye);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.resources.dispose();
    this.lowPass = null;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  // ---------------------------------------------------------------------------------

  private simShort(): number {
    return Math.min(this.simGrid.width, this.simGrid.height);
  }

  private simGridFor(width: number, height: number): GridSize {
    const max = this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) as number;
    return gridForCanvas(this.simCells ?? FLUID_TIERS[this.quality].sim, width, height, max);
  }

  private dyeGridFor(width: number, height: number): GridSize {
    const max = this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) as number;
    return dyeGridForCanvas(this.quality, width, height, max);
  }

  private compilePrograms(): Programs {
    const manual = this.support.linearFiltering ? [] : ['MANUAL_FILTERING'];
    return {
      force: this.createPass(FORCE_FRAGMENT, 'fluid force'),
      dye: this.createPass(DYE_FRAGMENT, 'fluid dye'),
      dyeStreak: this.createPass(DYE_FRAGMENT, 'fluid dye (strokes)', ['DYE_STREAK']),
      viscosity: this.createPass(VISCOSITY_FRAGMENT, 'fluid viscosity'),
      curl: this.createPass(CURL_FRAGMENT, 'fluid curl'),
      vorticity: this.createPass(VORTICITY_FRAGMENT, 'fluid vorticity'),
      divergence: this.createPass(DIVERGENCE_FRAGMENT, 'fluid divergence'),
      scale: this.createPass(SCALE_FRAGMENT, 'fluid scale'),
      pressure: this.createPass(PRESSURE_FRAGMENT, 'fluid pressure'),
      gradient: this.createPass(GRADIENT_SUBTRACT_FRAGMENT, 'fluid gradient'),
      advection: this.createPass(ADVECTION_FRAGMENT, 'fluid advection', manual),
      display: this.createPass(DISPLAY_FRAGMENT, 'fluid display', manual),
      copy: this.createPass(COPY_FRAGMENT, 'fluid copy'),
    };
  }

  /** Allocate every grid; when resizing, resample the old velocity and dye into the new. */
  private allocate(oldVelocity: DoubleRenderTarget | null, oldDye: DoubleRenderTarget | null) {
    const res = this.resources;
    const { rgba, rg, r } = this.support;
    const sim = this.simGrid;
    const dye = this.dyeGrid;
    this.velocity = createDoubleRenderTarget(res, sim.width, sim.height, rg, this.filter);
    this.scratch = createDoubleRenderTarget(res, sim.width, sim.height, rg, this.filter);
    this.dye = createDoubleRenderTarget(res, dye.width, dye.height, rgba, this.filter);
    this.pressure = createDoubleRenderTarget(res, sim.width, sim.height, r, this.gl.NEAREST);
    this.divergence = createRenderTarget(res, sim.width, sim.height, r, this.gl.NEAREST);
    this.curl = createRenderTarget(res, sim.width, sim.height, r, this.gl.NEAREST);
    if (oldVelocity) this.copyInto(oldVelocity.read, this.velocity.read);
    if (oldDye) this.copyInto(oldDye.read, this.dye.read);
  }

  /** Free the grids that carry no state between steps (all but velocity and dye). */
  private releaseWorkGrids(): void {
    const res = this.resources;
    deleteDoubleRenderTarget(res, this.scratch);
    deleteDoubleRenderTarget(res, this.pressure);
    deleteRenderTarget(res, this.divergence);
    deleteRenderTarget(res, this.curl);
  }

  private copyInto(source: RenderTarget, target: RenderTarget): void {
    const gl = this.gl;
    resetPassState(gl);
    const p = this.programs.copy;
    p.use();
    gl.uniform2f(p.u('uTexelSize'), target.texelSizeX, target.texelSizeY);
    gl.uniform1i(p.u('uTexture'), bindTexture(gl, 0, source.texture));
    this.blit(target);
  }

  /** (Re)generate the dye-spot texture when the pattern seed changes. */
  private ensureSpotPattern(seed: number): void {
    const s = seed >>> 0;
    if (this.spotSeed === s) return;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.spotTex);
    resetUnpackState(gl);
    const size = SPOT_TEXTURE_SIZE;
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      size,
      size,
      gl.RG,
      gl.UNSIGNED_BYTE,
      generateSpotTexture(s),
    );
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.spotSeed = s;
  }

  /** Dye comes from the field before the low-pass this step. */
  private rawDye(p: FluidStepParams): boolean {
    return p.dyeFromRawField === true && p.forceLowPassSec > 0;
  }

  /**
   * Upload the (optionally low-passed) field; returns its largest |v| for skipping. With
   * `dyeFromRawField`, the field before the low-pass is uploaded to a second texture.
   */
  private uploadField(input: SignatureField, p: FluidStepParams): number {
    const gl = this.gl;
    this.stepForceMagnitude = 0;
    this.stepRawMagnitude = 0;
    const cols = Math.max(0, Math.floor(input.cols));
    const rows = Math.max(0, Math.floor(input.rows));
    if (cols < 1 || rows < 1) return 0;
    const n = cols * rows * 2;
    if (!this.fieldTex || cols !== this.fieldCols || rows !== this.fieldRows) {
      if (this.fieldTex) this.resources.deleteTexture(this.fieldTex);
      if (this.rawFieldTex) this.resources.deleteTexture(this.rawFieldTex);
      this.rawFieldTex = null;
      this.fieldTex = createTexture(this.resources, cols, rows, FIELD_FORMAT(gl), {
        filter: gl.LINEAR,
      });
      this.fieldCols = cols;
      this.fieldRows = rows;
      this.lowPass = null;
      this.upload = new Float32Array(n);
    }
    // Copy (zero-padding a short field) so the frame's buffer can be reused right away.
    const upload = this.upload;
    const available = Math.min(n, input.field.length);
    upload.set(input.field.subarray(0, available));
    if (available < n) upload.fill(0, available);
    for (let i = 0; i < n; i++) if (!Number.isFinite(upload[i])) upload[i] = 0;
    if (this.rawDye(p)) {
      if (!this.rawFieldTex) {
        this.rawFieldTex = createTexture(this.resources, cols, rows, FIELD_FORMAT(gl), {
          filter: gl.LINEAR,
        });
      }
      this.stepRawMagnitude = maxVectorMagnitude(upload, n);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.rawFieldTex);
      resetUnpackState(gl);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cols, rows, gl.RG, gl.FLOAT, upload);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
    if (p.forceLowPassSec > 0) {
      if (!this.lowPass) this.lowPass = Float32Array.from(upload);
      const k = 1 - Math.exp(-p.dt / p.forceLowPassSec);
      const lp = this.lowPass;
      for (let i = 0; i < n; i++) lp[i] += (upload[i] - lp[i]) * k;
      upload.set(lp);
    } else {
      this.lowPass = null;
    }
    const max = maxVectorMagnitude(upload, n);
    this.stepForceMagnitude = max;
    if (!this.rawDye(p)) this.stepRawMagnitude = max;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fieldTex);
    resetUnpackState(gl);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cols, rows, gl.RG, gl.FLOAT, upload);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return max;
  }

  private setForceUniforms(
    prog: ShaderProgram,
    rect: { x: number; y: number; width: number; height: number },
    p: FluidStepParams,
    target: TexelSized,
    field: WebGLTexture | null = this.fieldTex,
  ): void {
    const gl = this.gl;
    const short = Math.min(this.width, this.height);
    gl.uniform2f(prog.u('uTexelSize'), target.texelSizeX, target.texelSizeY);
    gl.uniform4f(prog.u('uRect'), rect.x, rect.y, rect.width, rect.height);
    gl.uniform2f(prog.u('uFieldCells'), this.fieldCols, this.fieldRows);
    gl.uniform2f(prog.u('uShortScale'), this.width / short, this.height / short);
    gl.uniform4f(
      prog.u('uJitter'),
      Math.max(0, p.jitterAngle),
      Math.max(0, p.jitterOffset),
      p.jitterPhaseX,
      p.jitterPhaseY,
    );
    gl.uniform1f(prog.u('uJitterFreq'), Math.max(0.01, p.jitterFrequency));
    gl.uniform1ui(prog.u('uJitterSeed'), p.patternSeed >>> 0);
    if (field) gl.uniform1i(prog.u('uField'), bindTexture(gl, 1, field));
  }

  private applyForce(
    rect: { x: number; y: number; width: number; height: number },
    gain: number,
    p: FluidStepParams,
  ): void {
    const gl = this.gl;
    const prog = this.programs.force;
    prog.use();
    this.setForceUniforms(prog, rect, p, this.velocity);
    gl.uniform1f(prog.u('uGain'), gain);
    gl.uniform1i(prog.u('uVelocity'), bindTexture(gl, 0, this.velocity.read.texture));
    this.blit(this.velocity.write);
    this.velocity.swap();
  }

  private injectDye(
    rect: { x: number; y: number; width: number; height: number },
    amount: number,
    p: FluidStepParams,
  ): void {
    const gl = this.gl;
    const stroke = Math.max(0, p.dyeStrokeLength ?? 0);
    const prog = stroke > 0 ? this.programs.dyeStreak : this.programs.dye;
    prog.use();
    const field = this.rawDye(p) ? this.rawFieldTex : this.fieldTex;
    this.setForceUniforms(prog, rect, p, this.dye, field);
    if (stroke > 0) gl.uniform1f(prog.u('uStreak'), stroke);
    const spots = Math.min(1, Math.max(0, p.dyeSpots));
    const coverage = Math.min(1, Math.max(0.05, p.dyeSpotCoverage));
    if (spots > 0) this.ensureSpotPattern(p.patternSeed);
    gl.uniform1f(prog.u('uAmount'), amount);
    gl.uniform1f(prog.u('uDt'), p.dt);
    // Brighter spots when fewer show, so density changes coverage more than total dye.
    gl.uniform3f(prog.u('uSpots'), spots, coverage, 1 / Math.sqrt(SPOT_MEAN * coverage));
    gl.uniform2f(prog.u('uVelocityTexel'), this.velocity.texelSizeX, this.velocity.texelSizeY);
    gl.uniform1i(prog.u('uDye'), bindTexture(gl, 0, this.dye.read.texture));
    gl.uniform1i(prog.u('uPalette'), bindTexture(gl, 2, this.paletteTex));
    gl.uniform1i(prog.u('uSpotTex'), bindTexture(gl, 3, this.spotTex));
    gl.uniform1i(prog.u('uVelocity'), bindTexture(gl, 4, this.velocity.read.texture));
    this.blit(this.dye.write);
    this.dye.swap();
  }

  /** Implicit viscosity: Jacobi iterations of (I − α∇²) v = v0, starting from v0. */
  private diffuse(alpha: number, iterations: number): void {
    const gl = this.gl;
    const prog = this.programs.viscosity;
    prog.use();
    gl.uniform2f(prog.u('uTexelSize'), this.velocity.texelSizeX, this.velocity.texelSizeY);
    gl.uniform1f(prog.u('uAlpha'), alpha);
    gl.uniform1i(prog.u('uSource'), bindTexture(gl, 0, this.velocity.read.texture));
    let current = this.velocity.read;
    for (let i = 0; i < iterations; i++) {
      gl.uniform1i(prog.u('uVelocity'), bindTexture(gl, 1, current.texture));
      this.blit(this.scratch.write);
      this.scratch.swap();
      current = this.scratch.read;
    }
    // The result is in scratch.read: exchange it with velocity.read (same size and format).
    const previous = this.velocity.read;
    this.velocity.read = this.scratch.read;
    this.scratch.read = previous;
  }

  private confineVorticity(strengthCells: number, dt: number): void {
    const gl = this.gl;
    const texel = [this.velocity.texelSizeX, this.velocity.texelSizeY] as const;
    const curl = this.programs.curl;
    curl.use();
    gl.uniform2f(curl.u('uTexelSize'), texel[0], texel[1]);
    gl.uniform1i(curl.u('uVelocity'), bindTexture(gl, 0, this.velocity.read.texture));
    this.blit(this.curl);

    const vort = this.programs.vorticity;
    vort.use();
    gl.uniform2f(vort.u('uTexelSize'), texel[0], texel[1]);
    gl.uniform1i(vort.u('uVelocity'), bindTexture(gl, 0, this.velocity.read.texture));
    gl.uniform1i(vort.u('uCurl'), bindTexture(gl, 1, this.curl.texture));
    gl.uniform1f(vort.u('uCurlStrength'), strengthCells);
    gl.uniform1f(vort.u('uDt'), dt);
    gl.uniform1f(vort.u('uMaxSpeed'), MAX_SPEED_SHORT_SIDES * this.simShort());
    this.blit(this.velocity.write);
    this.velocity.swap();
  }

  private project(iterations: number, warmStart: number): void {
    const gl = this.gl;
    const texelX = this.velocity.texelSizeX;
    const texelY = this.velocity.texelSizeY;

    const div = this.programs.divergence;
    div.use();
    gl.uniform2f(div.u('uTexelSize'), texelX, texelY);
    gl.uniform1i(div.u('uVelocity'), bindTexture(gl, 0, this.velocity.read.texture));
    this.blit(this.divergence);

    const scale = this.programs.scale;
    scale.use();
    gl.uniform2f(scale.u('uTexelSize'), texelX, texelY);
    gl.uniform1i(scale.u('uTexture'), bindTexture(gl, 0, this.pressure.read.texture));
    gl.uniform1f(scale.u('uValue'), warmStart);
    this.blit(this.pressure.write);
    this.pressure.swap();

    const pressure = this.programs.pressure;
    pressure.use();
    gl.uniform2f(pressure.u('uTexelSize'), texelX, texelY);
    gl.uniform1i(pressure.u('uDivergence'), bindTexture(gl, 0, this.divergence.texture));
    for (let i = 0; i < iterations; i++) {
      gl.uniform1i(pressure.u('uPressure'), bindTexture(gl, 1, this.pressure.read.texture));
      this.blit(this.pressure.write);
      this.pressure.swap();
    }

    const gradient = this.programs.gradient;
    gradient.use();
    gl.uniform2f(gradient.u('uTexelSize'), texelX, texelY);
    gl.uniform1f(gradient.u('uGradientScale'), 0.5);
    gl.uniform1i(gradient.u('uPressure'), bindTexture(gl, 0, this.pressure.read.texture));
    gl.uniform1i(gradient.u('uVelocity'), bindTexture(gl, 1, this.velocity.read.texture));
    this.blit(this.velocity.write);
    this.velocity.swap();
  }
}

function sameSize(a: GridSize, b: GridSize): boolean {
  return a.width === b.width && a.height === b.height;
}

/** Largest |(u, v)| over the first `n` values of an interleaved uv array. */
function maxVectorMagnitude(uv: Float32Array, n: number): number {
  let max2 = 0;
  for (let i = 0; i < n; i += 2) {
    const u = uv[i];
    const v = uv[i + 1];
    const m2 = u * u + v * v;
    if (m2 > max2) max2 = m2;
  }
  return Math.sqrt(max2);
}
