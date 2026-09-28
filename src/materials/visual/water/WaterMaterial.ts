/**
 * V1 Water (SPEC 9.4): colored dye in low-viscosity water, seen from below. The
 * signature pushes the water and releases dye where it moves; the dye's color says
 * which way it moved.
 */
import { createRng, hash32, hashString32, type Rng } from '../../../chance/prng';
import type { SignatureFrame } from '../../../signature/types';
import { baselineValues } from '../../properties';
import type { PropertyValues, Quality, VisualContext, VisualMaterial } from '../../types';
import type { RenderTargetOverrides } from '../shared/gl';
import { FluidSolver, type FluidDisplayParams } from '../shared/fluid';
import { waterParams } from './mapping';
import { WATER_PALETTE_BYTES } from './palettes';
import { WATER_PROPERTIES } from './properties';

export const WATER_META = {
  id: 'water',
  version: 1,
  name: 'Water',
  description:
    'Colored water seen from below. The movement stirs it, and dye swirls along its wake, then drifts and fades.',
  properties: WATER_PROPERTIES,
};

/** Seed salt, so Water's randomness differs from other materials given the same seed. */
const SALT = hashString32('water');
/** How far the scatter pattern wanders per step (noise cells, uniform ±½ of this). */
const JITTER_DRIFT = 0.25;

export interface WaterOptions {
  /** Force the capability fallbacks (tests and Diagnostics only). */
  overrides?: RenderTargetOverrides;
}

export class WaterMaterial implements VisualMaterial {
  readonly id = WATER_META.id;
  readonly version = WATER_META.version;
  readonly name = WATER_META.name;
  readonly description = WATER_META.description;
  readonly properties = WATER_META.properties;

  private solver: FluidSolver | null = null;
  private quality: Quality = 'standard';
  private rng: Rng = createRng(0);
  private patternSeed = 0;
  private phaseX = 0;
  private phaseY = 0;
  private paletteIndex = -1;
  private display: FluidDisplayParams = waterParams(baselineValues(WATER_PROPERTIES)).display;
  private readonly overrides: RenderTargetOverrides | undefined;

  constructor(options: WaterOptions = {}) {
    this.overrides = options.overrides;
  }

  /** Builds everything synchronously; the promise only reports the outcome. */
  init(ctx: VisualContext): Promise<void> {
    try {
      this.dispose();
      this.quality = ctx.quality;
      this.solver = new FluidSolver(ctx.gl, {
        quality: ctx.quality,
        width: ctx.width,
        height: ctx.height,
        overrides: this.overrides,
      });
      this.reset(ctx.seed);
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  reset(seed: number): void {
    this.rng = createRng(hash32(seed, SALT));
    this.patternSeed = Math.floor(this.rng() * 4294967296) >>> 0;
    this.phaseX = 64 * this.rng();
    this.phaseY = 64 * this.rng();
    this.solver?.reset();
    this.solver?.setPatternSeed(this.patternSeed);
    this.setProperties(baselineValues(WATER_PROPERTIES));
  }

  step(frame: SignatureFrame, props: PropertyValues, dt: number): void {
    const params = waterParams(props);
    this.applyPalette(params.palette);
    this.display = params.display;
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
   * Apply properties that only change how the wake is drawn (brightness, palette for new
   * dye, surface light) without advancing time, e.g. while paused. Proposed as an optional
   * VisualMaterial method.
   */
  setProperties(props: PropertyValues): void {
    const params = waterParams(props);
    this.applyPalette(params.palette);
    this.display = params.display;
  }

  draw(): void {
    this.solver?.display(this.display);
  }

  resize(width: number, height: number): void {
    this.solver?.resize(width, height);
  }

  dispose(): void {
    this.solver?.dispose();
    this.solver = null;
    this.paletteIndex = -1;
  }

  /** Diagnostics: grid sizes and the render-target path in use. */
  describe(): string {
    const s = this.solver;
    if (!s) return 'not initialized';
    return `${this.quality}: sim ${s.simGrid.width}×${s.simGrid.height}, dye ${s.dyeGrid.width}×${s.dyeGrid.height}, ${s.support.summary}`;
  }

  private applyPalette(index: number): void {
    if (!this.solver || index === this.paletteIndex) return;
    const bytes = WATER_PALETTE_BYTES[index] ?? WATER_PALETTE_BYTES[0];
    this.solver.setPalette(bytes);
    this.paletteIndex = index;
  }
}
