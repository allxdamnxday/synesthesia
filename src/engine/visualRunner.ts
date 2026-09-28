/**
 * Drives a visual material along the composition timeline in fixed steps (SPEC 7.5).
 * Preview and offline render both use this, so the same composition time always has
 * the same simulation state.
 *
 * Step k covers composition time [k·dt, (k+1)·dt) and is driven by the signature frame
 * sampled at k·dt. Simulation time is derived from the integer step count, so it never
 * drifts. To show time t, advance until simTime ≥ t (SPEC 10.2 step 5): at 30 fps that is
 * exactly 2 steps per frame, at 60 fps exactly 1.
 */
import { FIXED_DT, type PropertyValues, type VisualMaterial } from '../materials/types';
import type { SignatureSampler } from '../signature/types';

/** Steps needed from step 0 so that simulation time reaches composition time t. */
export function stepsForTime(t: number, dt: number = FIXED_DT): number {
  if (t <= 0) return 0;
  // The small epsilon keeps i/fps from rounding up an extra step (e.g. 1/30 → 2 steps).
  return Math.ceil(t / dt - 1e-7);
}

export class VisualRunner {
  private stepIndex = 0;
  private material: VisualMaterial;
  private sampler: SignatureSampler;
  private seed: number;

  constructor(material: VisualMaterial, sampler: SignatureSampler, seed: number) {
    this.material = material;
    this.sampler = sampler;
    this.seed = seed;
  }

  /** Current simulation time in seconds of composition time. */
  get simTime(): number {
    return this.stepIndex * FIXED_DT;
  }

  get steps(): number {
    return this.stepIndex;
  }

  /** Return the material to its seeded initial state at t = 0. */
  reset(seed: number = this.seed): void {
    this.seed = seed;
    this.material.reset(seed);
    this.stepIndex = 0;
  }

  /** Steps still needed to reach composition time t (0 if already there or past). */
  stepsTo(t: number): number {
    return Math.max(0, stepsForTime(t) - this.stepIndex);
  }

  /**
   * Advance toward composition time t, at most `maxSteps` steps. Returns the number of
   * steps taken. Never skips steps: a slow machine falls behind instead of diverging.
   */
  advanceTo(t: number, props: PropertyValues, maxSteps: number = Number.POSITIVE_INFINITY): number {
    const count = Math.min(this.stepsTo(t), maxSteps);
    for (let i = 0; i < count; i++) {
      const frame = this.sampler.sample(this.stepIndex * FIXED_DT);
      this.material.step(frame, props, FIXED_DT);
      this.stepIndex++;
    }
    return count;
  }

  /**
   * Seek (SPEC 7.5): reset to the seeded initial state, then fast-forward without drawing.
   * Returns the number of steps the fast-forward needs; call `advanceTo` (possibly over
   * several animation frames) to perform them.
   */
  seek(t: number): number {
    this.reset();
    return this.stepsTo(t);
  }

  draw(): void {
    this.material.draw();
  }
}
