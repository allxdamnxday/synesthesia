/**
 * V3 Smoke (SPEC 9.4): pale smoke on dark. The movement pushes the air and gives off
 * smoke and heat where it moves; an expanding movement gives off a wider puff. Warm
 * smoke rises in curls and eddies (or, with Rise below the middle, sinks), then thins
 * away.
 */
import { createRng, hash32, hashString32, type Rng } from '../../../chance/prng';
import type { SignatureFrame } from '../../../signature/types';
import { baselineValues } from '../../properties';
import type { PropertyValues, Quality, VisualContext, VisualMaterial } from '../../types';
import { FluidSolver, type FluidDisplayParams } from '../shared/fluid';
import type { RenderTargetOverrides } from '../shared/gl';
import { burstRadius, smokeParams, type SmokeParams } from './mapping';
import { SMOKE_PROPERTIES } from './properties';
import { SmokePlume } from './plume';

export const SMOKE_META = {
  id: 'smoke',
  version: 1,
  name: 'Smoke',
  description:
    'Pale smoke on dark air. The movement gives off smoke where it moves; warm smoke rises and curls, then thins away.',
  properties: SMOKE_PROPERTIES,
};

/** Seed salt, so Smoke's randomness differs from other materials given the same seed. */
const SALT = hashString32('smoke');
/** How far the eddy pattern wanders per step (noise cells, uniform ±½ of this). */
const NOISE_DRIFT = 0.08;

export interface SmokeOptions {
  /** Force the capability fallbacks (tests and Diagnostics only). */
  overrides?: RenderTargetOverrides;
}

export class SmokeMaterial implements VisualMaterial {
  readonly id = SMOKE_META.id;
  readonly version = SMOKE_META.version;
  readonly name = SMOKE_META.name;
  readonly description = SMOKE_META.description;
  readonly properties = SMOKE_META.properties;

  private solver: FluidSolver | null = null;
  private plume: SmokePlume | null = null;
  private quality: Quality = 'standard';
  private rng: Rng = createRng(0);
  private noiseSeed = 0;
  private phaseX = 0;
  private phaseY = 0;
  private display: FluidDisplayParams = smokeParams(baselineValues(SMOKE_PROPERTIES)).display;
  private readonly overrides: RenderTargetOverrides | undefined;

  constructor(options: SmokeOptions = {}) {
    this.overrides = options.overrides;
  }

  /** Builds everything synchronously; the promise only reports the outcome. */
  init(ctx: VisualContext): Promise<void> {
    try {
      this.dispose();
      this.quality = ctx.quality;
      const solver = new FluidSolver(ctx.gl, {
        quality: ctx.quality,
        width: ctx.width,
        height: ctx.height,
        overrides: this.overrides,
      });
      this.solver = solver;
      this.plume = new SmokePlume(solver, smokeParams(baselineValues(SMOKE_PROPERTIES)).emit);
      this.reset(ctx.seed);
      return Promise.resolve();
    } catch (error) {
      this.dispose();
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  reset(seed: number): void {
    this.rng = createRng(hash32(seed, SALT));
    this.noiseSeed = Math.floor(this.rng() * 4294967296) >>> 0;
    this.phaseX = 64 * this.rng();
    this.phaseY = 64 * this.rng();
    this.solver?.reset();
    this.plume?.reset();
    this.plume?.setVentSeed(this.noiseSeed);
    this.setProperties(baselineValues(SMOKE_PROPERTIES));
  }

  step(frame: SignatureFrame, props: PropertyValues, dt: number): void {
    const params = this.paramsFor(props);
    this.display = params.display;
    // Always draw the same number of values per step so the random sequence depends
    // only on the step count, never on property values.
    this.phaseX += (this.rng() - 0.5) * NOISE_DRIFT;
    this.phaseY += (this.rng() - 0.5) * NOISE_DRIFT;
    if (this.plume) {
      this.plume.params = params.emit;
      this.plume.radius = burstRadius(params.emit.burstRadius, frame.normalized.divergence);
      this.plume.noise = { phaseX: this.phaseX, phaseY: this.phaseY, seed: this.noiseSeed };
    }
    this.solver?.step(frame, {
      ...params.step,
      dt,
      jitterPhaseX: 0,
      jitterPhaseY: 0,
      patternSeed: this.noiseSeed,
    });
  }

  /** Apply properties that only change how the smoke is drawn (brightness) while paused. */
  setProperties(props: PropertyValues): void {
    this.display = this.paramsFor(props).display;
  }

  draw(): void {
    this.solver?.display(this.display);
  }

  resize(width: number, height: number): void {
    this.solver?.resize(width, height);
    this.plume?.resize();
  }

  dispose(): void {
    this.solver?.dispose();
    this.solver = null;
    this.plume = null;
  }

  /** Diagnostics: grid sizes and the render-target path in use. */
  describe(): string {
    const s = this.solver;
    if (!s) return 'not initialized';
    return `${this.quality}: sim ${s.simGrid.width}×${s.simGrid.height}, dye ${s.dyeGrid.width}×${s.dyeGrid.height}, ${s.support.summary}`;
  }

  /** The property mapping (a seam for tuning pages; always `smokeParams` in the app). */
  private paramsFor(props: PropertyValues): SmokeParams {
    return smokeParams(props);
  }
}
