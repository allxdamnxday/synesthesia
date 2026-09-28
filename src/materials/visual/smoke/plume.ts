/**
 * Smoke's plume: emission with a burst radius, heat, buoyancy and seeded turbulence,
 * added to the shared fluid solver through its hooks.
 *
 * - beforeProjection: while the signature moves, find where it pushes within the burst
 *   radius (emission), release tinted smoke into the dye and heat into the heat field;
 *   then warm smoke rises (or sinks) and seeded eddies stir it.
 * - afterAdvection: carry the heat with the flow as it cools.
 *
 * Lengths are in canvas short sides, so every quality tier shows the same smoke.
 */
import { generateSpotTexture, type FluidHookContext, type FluidSolver } from '../shared/fluid';
import {
  bindTexture,
  clearTarget,
  createTexture,
  deleteDoubleRenderTarget,
  resetUnpackState,
  type DoubleRenderTarget,
  type ShaderProgram,
} from '../shared/gl';
import type { SmokeEmissionParams } from './mapping';
import { SMOKE_TINTS } from './palette';
import { BUOYANCY_FRAGMENT, EMISSION_FRAGMENT, HEAT_FRAGMENT, SMOKE_FRAGMENT } from './shaders';

/** Heat never builds up beyond this (keeps a long, slow movement from boiling over). */
const MAX_HEAT = 4;
/** Vent pattern texture size (it tiles once per short side). */
export const VENT_TEXTURE_SIZE = 256;

/** How the vents are laid out: vents per short side, and vent radius (Gaussian σ, cells). */
export interface VentLayout {
  cells: number;
  sigma: number;
}

export const VENT_LAYOUT: Readonly<VentLayout> = { cells: 30, sigma: 0.24 };

export interface PlumeNoise {
  phaseX: number;
  phaseY: number;
  seed: number;
}

export class SmokePlume {
  params: SmokeEmissionParams;
  /** Emission radius for this step, short sides (see `burstRadius()`). */
  radius = 0;
  noise: PlumeNoise = { phaseX: 0, phaseY: 0, seed: 0 };
  private readonly solver: FluidSolver;
  private readonly emission: ShaderProgram;
  private readonly smoke: ShaderProgram;
  private readonly heating: ShaderProgram;
  private readonly buoyancy: ShaderProgram;
  private emitted: DoubleRenderTarget;
  private heat: DoubleRenderTarget;
  private readonly vents: WebGLTexture;
  private ventKey = '';
  /** Mean vent profile with every vent open (normalizes the release). */
  private ventMean = 0.3;

  constructor(solver: FluidSolver, params: SmokeEmissionParams) {
    this.solver = solver;
    this.params = params;
    const defines = solver.support.linearFiltering ? [] : ['MANUAL_FILTERING'];
    this.emission = solver.createPass(EMISSION_FRAGMENT, 'smoke emission');
    this.smoke = solver.createPass(SMOKE_FRAGMENT, 'smoke release', defines);
    this.heating = solver.createPass(HEAT_FRAGMENT, 'smoke heat');
    this.buoyancy = solver.createPass(BUOYANCY_FRAGMENT, 'smoke buoyancy');
    this.emitted = solver.createFieldTarget('rgba');
    this.heat = solver.createFieldTarget('r');
    const gl = solver.gl;
    this.vents = createTexture(
      solver.resources,
      VENT_TEXTURE_SIZE,
      VENT_TEXTURE_SIZE,
      { internalFormat: gl.RG8, format: gl.RG, type: gl.UNSIGNED_BYTE, channels: 2 },
      { filter: gl.LINEAR, wrap: gl.REPEAT },
    );
    solver.hooks = {
      beforeProjection: (ctx) => this.emitAndLift(ctx),
      afterAdvection: (ctx) => this.solver.advect(this.heat, ctx.params.dt, this.params.cooling),
    };
  }

  /** Lay out the seeded vents (only when the seed changes: it takes a few milliseconds). */
  setVentSeed(seed: number, layout: Readonly<VentLayout> = VENT_LAYOUT): void {
    const s = seed >>> 0;
    const key = `${s}:${layout.cells}:${layout.sigma}`;
    if (this.ventKey === key) return;
    const bytes = generateSpotTexture(s, VENT_TEXTURE_SIZE, layout.cells, layout.sigma);
    let sum = 0;
    for (let i = 0; i < bytes.length; i += 2) sum += bytes[i] ?? 0;
    this.ventMean = Math.max(1e-3, sum / (bytes.length / 2) / 255);
    const gl = this.solver.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.vents);
    resetUnpackState(gl);
    const size = VENT_TEXTURE_SIZE;
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, size, size, gl.RG, gl.UNSIGNED_BYTE, bytes);
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.ventKey = key;
  }

  /** No heat anywhere: the state at t = 0. */
  reset(): void {
    const gl = this.solver.gl;
    clearTarget(gl, this.emitted);
    clearTarget(gl, this.heat);
  }

  /** Follow the solver's grids after it resized (the heat starts over; it fades anyway). */
  resize(): void {
    const grid = this.solver.simGrid;
    if (this.heat.width === grid.width && this.heat.height === grid.height) return;
    const res = this.solver.resources;
    deleteDoubleRenderTarget(res, this.emitted);
    deleteDoubleRenderTarget(res, this.heat);
    this.emitted = this.solver.createFieldTarget('rgba');
    this.heat = this.solver.createFieldTarget('r');
  }

  private emitAndLift({ gl, solver, params }: FluidHookContext): void {
    const short = Math.min(solver.simGrid.width, solver.simGrid.height);
    const velocity = solver.velocity;
    if (solver.fieldMagnitude() > 1e-9) {
      // Emission: the strongest push within the burst radius, and its direction.
      const e = this.emission;
      e.use();
      if (solver.bindSignatureForce(e, this.emitted)) {
        gl.uniform1f(e.u('uRadius'), Math.max(0, this.radius));
        solver.blit(this.emitted.write);
        this.emitted.swap();

        // Smoke into the dye.
        const dye = solver.dye;
        const s = this.smoke;
        s.use();
        const coverage = Math.min(1, Math.max(0.05, this.params.ventCoverage));
        gl.uniform2f(s.u('uTexelSize'), dye.texelSizeX, dye.texelSizeY);
        gl.uniform2f(s.u('uEmissionTexel'), this.emitted.texelSizeX, this.emitted.texelSizeY);
        gl.uniform2f(s.u('uVelocityTexel'), velocity.texelSizeX, velocity.texelSizeY);
        gl.uniform2f(
          s.u('uShortScale'),
          solver.simGrid.width / short,
          solver.simGrid.height / short,
        );
        gl.uniform1f(s.u('uDt'), params.dt);
        gl.uniform1f(s.u('uWisp'), Math.max(0, this.params.wispLength));
        gl.uniform1f(s.u('uAmount'), Math.max(0, this.params.smokeAmount) * params.dt);
        // Brighter vents when fewer are open, so density changes coverage more than light.
        gl.uniform3f(
          s.u('uVentMix'),
          Math.min(1, Math.max(0, this.params.vents)),
          coverage,
          1 / (this.ventMean * Math.sqrt(coverage)),
        );
        gl.uniform3f(s.u('uRising'), ...SMOKE_TINTS.rising);
        gl.uniform3f(s.u('uLevel'), ...SMOKE_TINTS.level);
        gl.uniform3f(s.u('uFalling'), ...SMOKE_TINTS.falling);
        gl.uniform1i(s.u('uDye'), bindTexture(gl, 0, dye.read.texture));
        gl.uniform1i(s.u('uEmission'), bindTexture(gl, 1, this.emitted.read.texture));
        gl.uniform1i(s.u('uVelocity'), bindTexture(gl, 2, velocity.read.texture));
        gl.uniform1i(s.u('uVents'), bindTexture(gl, 3, this.vents));
        solver.blit(dye.write);
        dye.swap();

        // Heat.
        const h = this.heating;
        h.use();
        gl.uniform2f(h.u('uTexelSize'), this.heat.texelSizeX, this.heat.texelSizeY);
        gl.uniform1f(h.u('uAmount'), Math.max(0, this.params.heatAmount) * params.dt);
        gl.uniform1f(h.u('uMaxHeat'), MAX_HEAT);
        gl.uniform1i(h.u('uHeat'), bindTexture(gl, 0, this.heat.read.texture));
        gl.uniform1i(h.u('uEmission'), bindTexture(gl, 1, this.emitted.read.texture));
        solver.blit(this.heat.write);
        this.heat.swap();
      }
    }

    // Buoyancy and turbulence wherever there is heat.
    const b = this.buoyancy;
    b.use();
    const p = this.params;
    const width = solver.simGrid.width;
    const height = solver.simGrid.height;
    gl.uniform2f(b.u('uTexelSize'), velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1f(b.u('uLift'), p.lift * short * params.dt);
    gl.uniform1f(b.u('uTurbulence'), Math.max(0, p.turbulence) * short * params.dt);
    gl.uniform3f(
      b.u('uNoise'),
      this.noise.phaseX,
      this.noise.phaseY,
      Math.max(0.01, p.turbulenceScale),
    );
    gl.uniform1ui(b.u('uNoiseSeed'), this.noise.seed >>> 0);
    gl.uniform2f(b.u('uShortScale'), width / short, height / short);
    gl.uniform1f(b.u('uMaxSpeed'), Math.max(0, p.maxSpeed) * short);
    gl.uniform1i(b.u('uVelocity'), bindTexture(gl, 0, velocity.read.texture));
    gl.uniform1i(b.u('uHeat'), bindTexture(gl, 1, this.heat.read.texture));
    solver.blit(velocity.write);
    velocity.swap();
  }
}
