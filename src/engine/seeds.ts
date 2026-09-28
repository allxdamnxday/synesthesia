/**
 * How a composition's seed becomes the seeds its materials receive. Preview and offline
 * render must derive them identically, so every caller goes through these functions.
 * Visual and sound get independent streams so their randomness never correlates.
 */
import { createRng, hash32, type Rng } from '../chance/prng';

const VISUAL_SALT = 0x5649; // "VI"
const SOUND_SALT = 0x534f; // "SO"

/** Seed passed to a visual material's `reset()` and used for its context rng. */
export function visualSeed(compositionSeed: number): number {
  return hash32(compositionSeed, VISUAL_SALT);
}

/** Seed passed to a sound material's `build()`. */
export function soundSeed(compositionSeed: number): number {
  return hash32(compositionSeed, SOUND_SALT);
}

/** The `rng` for a visual material's context. */
export function visualRng(compositionSeed: number): Rng {
  return createRng(visualSeed(compositionSeed));
}
