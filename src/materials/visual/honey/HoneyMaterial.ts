/**
 * V2 Honey (SPEC 9.4): the same fluid as Water, made thick. The movement drags the honey
 * slowly and broadly, it lags behind and stops soon after, colors folded into it stay,
 * and (with Elasticity) it springs back toward where it was. Freeman's bowl analogy made
 * literal: the same wink through Water and through Honey.
 */
import { createRng, hash32, hashString32, type Rng } from '../../../chance/prng';
import type { SignatureFrame } from '../../../signature/types';
import { baselineValues } from '../../properties';
import type { PropertyValues, Quality, VisualContext, VisualMaterial } from '../../types';
import { FluidSolver, type FluidDisplayParams } from '../shared/fluid';
import type { RenderTargetOverrides } from '../shared/gl';
import { honeyParams, type HoneyParams } from './mapping';
import { HONEY_PALETTE_BYTES } from './palettes';
import { HONEY_PROPERTIES } from './properties';
import { ViscoElasticBody } from './viscoElastic';

export const HONEY_META = {
  id: 'honey',
  version: 1,
  name: 'Honey',
  description:
    'A bowl of honey seen from below. The movement drags it slowly and folds color into it; the honey lags behind, settles and keeps its wake.',
  properties: HONEY_PROPERTIES,
};

/** Seed salt, so Honey's randomness differs from other materials given the same seed. */
const SALT = hashString32('honey');
/** How far the scatter pattern wanders per step (noise cells, uniform ±½ of this). */
const JITTER_DRIFT = 0.12;

export interface HoneyOptions {
  /** Force the capability fallbacks (tests and Diagnostics only). */
  overrides?: RenderTargetOverrides;
}

export class HoneyMaterial implements VisualMaterial {
  readonly id = HONEY_META.id;
  readonly version = HONEY_META.version;
  readonly name = HONEY_META.name;
  readonly description = HONEY_META.description;
  readonly properties = HONEY_META.properties;

  private solver: FluidSolver | null = null;
  private body: ViscoElasticBody | null = null;
  private quality: Quality = 'standard';
  private rng: Rng = createRng(0);
  private patternSeed = 0;
  private phaseX = 0;
  private phaseY = 0;
  private paletteIndex = -1;
  private display: FluidDisplayParams = honeyParams(baselineValues(HONEY_PROPERTIES)).display;
  private readonly overrides: RenderTargetOverrides | undefined;

  constructor(options: HoneyOptions = {}) {
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
      this.body = new ViscoElasticBody(solver, honeyParams(baselineValues(HONEY_PROPERTIES)).body);
      this.reset(ctx.seed);
      return Promise.resolve();
    } catch (error) {
      this.dispose();
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  reset(seed: number): void {
    this.rng = createRng(hash32(seed, SALT));
    this.patternSeed = Math.floor(this.rng() * 4294967296) >>> 0;
    this.phaseX = 64 * this.rng();
    this.phaseY = 64 * this.rng();
    this.solver?.reset();
    this.body?.reset();
    this.solver?.setPatternSeed(this.patternSeed);
    this.setProperties(baselineValues(HONEY_PROPERTIES));
  }

  step(frame: SignatureFrame, props: PropertyValues, dt: number): void {
    const params = this.paramsFor(props);
    this.applyPalette(params.palette);
    this.display = params.display;
    if (this.body) this.body.params = params.body;
    // Always draw the same number of values per step so the random sequence depends
    // only on the step count, never on property values.
    this.phaseX += (this.rng() - 0.5) * JITTER_DRIFT;
    this.phaseY += (this.rng() - 0.5) * JITTER_DRIFT;
    this.solver?.step(frame, {
      ...params.step,
      dt,
      jitterPhaseX: this.phaseX,
      jitterPhaseY: this.phaseY,
      patternSeed: this.patternSeed,
    });
  }

  /**
   * Apply properties that only change how the wake is drawn (brightness, hue, palette for
   * new color, surface light) without advancing time, e.g. while paused.
   */
  setProperties(props: PropertyValues): void {
    const params = this.paramsFor(props);
    this.applyPalette(params.palette);
    this.display = params.display;
  }

  draw(): void {
    this.solver?.display(this.display);
  }

  resize(width: number, height: number): void {
    this.solver?.resize(width, height);
    this.body?.resize();
  }

  dispose(): void {
    this.solver?.dispose();
    this.solver = null;
    this.body = null;
    this.paletteIndex = -1;
  }

  /** Diagnostics: grid sizes and the render-target path in use. */
  describe(): string {
    const s = this.solver;
    if (!s) return 'not initialized';
    return `${this.quality}: sim ${s.simGrid.width}×${s.simGrid.height}, dye ${s.dyeGrid.width}×${s.dyeGrid.height}, ${s.support.summary}`;
  }

  /** The property mapping (a seam for tuning pages; always `honeyParams` in the app). */
  private paramsFor(props: PropertyValues): HoneyParams {
    return honeyParams(props);
  }

  private applyPalette(index: number): void {
    if (!this.solver || index === this.paletteIndex) return;
    const bytes = HONEY_PALETTE_BYTES[index] ?? HONEY_PALETTE_BYTES[0];
    this.solver.setPalette(bytes);
    this.paletteIndex = index;
  }
}
