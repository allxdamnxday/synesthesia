/**
 * Fixed-step clock for realtime preview (SPEC 7.5). Wall-clock time only decides how
 * many fixed steps to run this frame; the simulation itself only ever sees FIXED_DT and
 * a step index, so preview and offline render run the same steps.
 *
 * Keep the step index as an integer and derive time as `index × dt`: summing dt
 * accumulates rounding error, integer indices don't.
 */

export interface StepPlan {
  /** Steps to run this frame. */
  steps: number;
  /** Seconds left over for the next frame. */
  accumulator: number;
  /** True when the machine couldn't keep up and time was dropped (playback slows). */
  dropped: boolean;
}

/**
 * Add a frame's real elapsed time to the accumulator and decide how many fixed steps to
 * run. `elapsedSec` is clamped (a background tab can report seconds); at most
 * `maxSteps` run per frame, and any backlog beyond that is dropped rather than letting a
 * slow machine spiral further behind.
 */
export function planSteps(
  accumulator: number,
  elapsedSec: number,
  dt: number,
  maxSteps = 4,
  maxElapsedSec = 0.25,
): StepPlan {
  const elapsed = Number.isFinite(elapsedSec)
    ? Math.min(Math.max(0, elapsedSec), maxElapsedSec)
    : 0;
  let acc = Math.max(0, accumulator) + elapsed;
  // Tolerate float fuzz so exactly-one-frame intervals always yield a step.
  const epsilon = dt * 1e-6;
  let steps = Math.floor((acc + epsilon) / dt);
  let dropped = false;
  if (steps > maxSteps) {
    steps = maxSteps;
    acc = 0;
    dropped = true;
  } else {
    acc = Math.max(0, acc - steps * dt);
  }
  return { steps, accumulator: acc, dropped };
}

/** Number of fixed steps needed to reach composition time `t` from 0 (for seeking). */
export function stepsToReach(t: number, dt: number): number {
  if (!(t > 0) || !(dt > 0)) return 0;
  return Math.round(t / dt);
}
