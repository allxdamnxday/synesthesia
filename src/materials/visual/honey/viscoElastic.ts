/**
 * Honey's body: true viscous diffusion by a Gaussian kernel, and an optional elastic
 * spring-back, added to the shared fluid solver through its hooks.
 *
 * - beforeProjection: blur velocity along x, then along y while adding the spring
 *   −k·D and a speed limit (two passes at simulation resolution).
 * - afterAdvection: carry the displacement D with the flow and integrate velocity into it.
 *
 * The displacement lives in canvas short sides and the kernel width is set from ν in
 * short sides, so every quality tier shows the same honey.
 */
import { COPY_FRAGMENT, type FluidHookContext, type FluidSolver } from '../shared/fluid';
import {
  bindTexture,
  clearTarget,
  deleteDoubleRenderTarget,
  type DoubleRenderTarget,
  type ShaderProgram,
} from '../shared/gl';
import { diffusionSigmaTexels, gaussianKernel } from './kernel';
import type { HoneyBodyParams } from './mapping';
import { BLUR_FRAGMENT, BLUR_SPRING_FRAGMENT, DISPLACEMENT_FRAGMENT } from './shaders';

/** Displacement is limited to this, in short sides (keeps extreme springs stable). */
const MAX_DISPLACEMENT = 0.6;

export class ViscoElasticBody {
  params: HoneyBodyParams;
  private readonly solver: FluidSolver;
  private readonly blur: ShaderProgram;
  private readonly blurSpring: ShaderProgram;
  private readonly displace: ShaderProgram;
  private readonly copy: ShaderProgram;
  private scratch: DoubleRenderTarget;
  private displacement: DoubleRenderTarget;

  constructor(solver: FluidSolver, params: HoneyBodyParams) {
    this.solver = solver;
    this.params = params;
    const defines = solver.support.linearFiltering ? [] : ['MANUAL_FILTERING'];
    this.blur = solver.createPass(BLUR_FRAGMENT, 'honey blur', defines);
    this.blurSpring = solver.createPass(BLUR_SPRING_FRAGMENT, 'honey blur + spring', defines);
    this.displace = solver.createPass(DISPLACEMENT_FRAGMENT, 'honey displacement', defines);
    this.copy = solver.createPass(COPY_FRAGMENT, 'honey copy');
    this.scratch = solver.createFieldTarget('rg');
    this.displacement = solver.createFieldTarget('rg');
    solver.hooks = {
      beforeProjection: (ctx) => this.diffuseAndSpring(ctx),
      afterAdvection: (ctx) => this.carryDisplacement(ctx),
    };
  }

  /** Back to rest: no displacement. */
  reset(): void {
    const gl = this.solver.gl;
    clearTarget(gl, this.scratch);
    clearTarget(gl, this.displacement);
  }

  /** Follow the solver's grids after it resized, keeping the current displacement. */
  resize(): void {
    const grid = this.solver.simGrid;
    if (this.displacement.width === grid.width && this.displacement.height === grid.height) {
      return;
    }
    const res = this.solver.resources;
    const old = this.displacement;
    deleteDoubleRenderTarget(res, this.scratch);
    this.scratch = this.solver.createFieldTarget('rg');
    this.displacement = this.solver.createFieldTarget('rg');
    const gl = this.solver.gl;
    this.copy.use();
    gl.uniform2f(
      this.copy.u('uTexelSize'),
      this.displacement.texelSizeX,
      this.displacement.texelSizeY,
    );
    gl.uniform1i(this.copy.u('uTexture'), bindTexture(gl, 0, old.read.texture));
    this.solver.blit(this.displacement.read);
    deleteDoubleRenderTarget(res, old);
  }

  private diffuseAndSpring({ gl, solver, params }: FluidHookContext): void {
    const velocity = solver.velocity;
    const short = Math.min(solver.simGrid.width, solver.simGrid.height);
    const sigma = diffusionSigmaTexels(this.params.viscosity, params.dt, short);
    const kernel = gaussianKernel(sigma);
    const weights = new Float32Array(kernel.weights);

    // Along x, into scratch.
    const blur = this.blur;
    blur.use();
    gl.uniform2f(blur.u('uTexelSize'), velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform2f(blur.u('uVelocityTexel'), velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform2f(blur.u('uStep'), kernel.spacing * velocity.texelSizeX, 0);
    gl.uniform1fv(blur.u('uWeights'), weights);
    gl.uniform1i(blur.u('uVelocity'), bindTexture(gl, 0, velocity.read.texture));
    solver.blit(this.scratch.write);
    this.scratch.swap();

    // Along y, plus the spring and the speed limit, back into velocity.
    const p = this.blurSpring;
    p.use();
    gl.uniform2f(p.u('uTexelSize'), velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform2f(p.u('uVelocityTexel'), velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform2f(p.u('uStep'), 0, kernel.spacing * velocity.texelSizeY);
    gl.uniform1fv(p.u('uWeights'), weights);
    gl.uniform1f(p.u('uSpring'), Math.max(0, this.params.springStiffness) * params.dt * short);
    gl.uniform1f(p.u('uMaxSpeed'), Math.max(0, this.params.maxSpeed) * short);
    gl.uniform1i(p.u('uVelocity'), bindTexture(gl, 0, this.scratch.read.texture));
    gl.uniform1i(p.u('uDisplacement'), bindTexture(gl, 1, this.displacement.read.texture));
    solver.blit(velocity.write);
    velocity.swap();
  }

  private carryDisplacement({ gl, solver, params }: FluidHookContext): void {
    const short = Math.min(solver.simGrid.width, solver.simGrid.height);
    const d = this.displacement;
    const p = this.displace;
    p.use();
    gl.uniform2f(p.u('uTexelSize'), d.texelSizeX, d.texelSizeY);
    gl.uniform2f(p.u('uTexel'), d.texelSizeX, d.texelSizeY);
    gl.uniform1f(p.u('uDt'), params.dt);
    gl.uniform1f(p.u('uDecay'), Math.exp(-Math.max(0, this.params.displacementRelax) * params.dt));
    gl.uniform1f(p.u('uCellToShort'), 1 / short);
    gl.uniform1f(p.u('uMaxDisplacement'), MAX_DISPLACEMENT);
    gl.uniform1i(p.u('uVelocity'), bindTexture(gl, 0, solver.velocity.read.texture));
    gl.uniform1i(p.u('uDisplacement'), bindTexture(gl, 1, d.read.texture));
    solver.blit(d.write);
    d.swap();
  }
}
