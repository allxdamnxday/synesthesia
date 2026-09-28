/**
 * V4 Descending bubbles: property → simulation parameter mapping (SPEC 9.4). Pure, so it
 * is unit tested. Documented as a table in docs/materials/visual-bubbles.md.
 *
 * | Property    | Simulation parameter                                                  |
 * |-------------|-----------------------------------------------------------------------|
 * | Viscosity   | drag on the pushed motion (1.5/s → 10/s), a slightly weaker push, and |
 * |             | lag (0 → 0.12 s): thin water coasts on, thick water barely moves      |
 * | Elasticity  | wobble (squash and stretch that rings after a push); spring back to   |
 * |             | the undisturbed path                                                  |
 * | Persistence | lifetime of the bubbles the movement touches (they wear out with the  |
 * |             | push and pop: within ~0.3 s at 0, never at 1); how long the glow of a |
 * |             | push stays (fade 9/s → 0.25/s)                                        |
 * | Dispersion  | spawn spread (strings of bubbles → an even fall), seeded wandering,   |
 * |             | scatter of the push                                                   |
 * | Brightness  | exposure and saturation of rims, highlights and glow                  |
 * | Intensity   | force gain (a quarter to four times the baseline push)                |
 * | Density     | number of bubbles (100 → 8,000), capped by quality tier               |
 * | Range       | projection scale of the signature (compressed ↔ magnified)            |
 * | Fall speed  | sinking speed (0.03 → 0.44 short sides per second)                    |
 * | Size        | bubble radius (0.004 → 0.024 short sides)                             |
 *
 * Signature → bubbles: the field, sampled at each bubble through the Range projection, is
 * a force on the bubble's displacement from its falling path (so the speed of the
 * movement becomes the push); the displacement's speed lights the bubble in the color of
 * its direction and wears it out; its acceleration makes the bubble wobble. Untouched
 * bubbles live until they sink out of view, so the water stays full at every setting.
 */
import { readProperty } from '../../properties';
import type { PropertyValues, Quality } from '../../types';
import { bubblesProperty } from './properties';

/** Most bubbles simulated at each quality tier (SPEC 14.2). */
export const BUBBLE_TIER_CAPS: Readonly<Record<Quality, number>> = {
  draft: 1500,
  standard: 4000,
  high: 8000,
};

export interface BubbleSimParams {
  /** Bubbles in play. */
  count: number;
  /** 0..1: compressed (0), fitted (0.5), magnified (1). */
  range: number;
  /** Sinking speed, short sides per second (per bubble it varies with size). */
  fallSpeed: number;
  /**
   * How fast a pushed bubble wears out, per second at full glow speed (GLOW_SPEED): it
   * pops once worn through. 0 = touched bubbles never pop.
   */
  popRate: number;
  /** Push per unit of signature velocity, 1/s (acceleration = gain × field velocity). */
  forceGain: number;
  /** Drag on the pushed motion, 1/s. */
  drag: number;
  /** Low-pass on the push each bubble feels, seconds (thicker water lags). */
  lagSec: number;
  /** Spring pulling a pushed bubble back to its undisturbed path, 1/s². */
  spring: number;
  /** Wobble frequency, Hz. */
  wobbleFreq: number;
  /** Wobble damping ratio (small rings long). */
  wobbleDamping: number;
  /** Stretch per unit of acceleration (short sides per second²). */
  wobbleDrive: number;
  /** Wandering speed (standard deviation), short sides per second. */
  walk: number;
  /** How long a wandering direction lasts, seconds. */
  walkTime: number;
  /** 0..1: where bubbles start: strings at fixed places (0) → evenly spread (1). */
  spread: number;
  /** Largest deflection of the push per bubble, radians. */
  scatter: number;
  /** Glow fade rate, 1/s. */
  glowDecay: number;
}

export interface BubbleDisplayParams {
  /** Mean bubble radius, short sides. */
  radius: number;
  /** Multiplies all light. */
  exposure: number;
  /** 1 = as tinted; below toward grey, above more saturated. */
  saturation: number;
}

export interface BubbleParams {
  sim: BubbleSimParams;
  display: BubbleDisplayParams;
}

const VISCOSITY = bubblesProperty('viscosity');
const ELASTICITY = bubblesProperty('elasticity');
const PERSISTENCE = bubblesProperty('persistence');
const DISPERSION = bubblesProperty('dispersion');
const BRIGHTNESS = bubblesProperty('brightness');
const INTENSITY = bubblesProperty('intensity');
const DENSITY = bubblesProperty('density');
const RANGE = bubblesProperty('range');
const FALL_SPEED = bubblesProperty('fallSpeed');
const SIZE = bubblesProperty('size');

/** Density 0..1 → bubble count: 100 → ~900 at baseline → 8,000 (exponential). */
export function bubbleCount(density: number, quality: Quality): number {
  const wanted = Math.round(100 * 80 ** density);
  return Math.max(1, Math.min(BUBBLE_TIER_CAPS[quality], wanted));
}

/** Fall speed 0..1 → short sides per second: 0.03 → 0.11 → 0.44. */
export function bubbleFallSpeed(f: number): number {
  return 0.11 * 4 ** (2 * f - 1);
}

/** Size 0..1 → mean radius in short sides: 0.004 → 0.01 → 0.024. */
export function bubbleRadius(s: number): number {
  return 0.01 * 2.4 ** (2 * s - 1);
}

/**
 * Persistence 0..1 → how fast touched bubbles wear out (1/s at full glow speed): 4 (a
 * bubble pops during the push that hits it) → 0.33 (only a violent push pops it) → 0.
 */
export function bubblePopRate(p: number): number {
  return p >= 1 ? 0 : 4 * 12 ** (-2 * p) * (1 - p * p * p);
}

/** Persistence 0..1 → glow fade rate, 1/s: 9 (a blink) → 1.5 → 0.25 (lingers). */
export function bubbleGlowDecay(p: number): number {
  return 1.5 * 6 ** (1 - 2 * p);
}

/**
 * Viscosity 0..1 → drag on the pushed motion, 1/s: 1.5 (thin water: pushed bubbles coast
 * on for a second) → 4 → 10 (thick: they stop as soon as the push does).
 */
export function bubbleDrag(v: number): number {
  return 4 * 2.6 ** (2 * v - 1);
}

/** Intensity 0..1 → multiplier on the push: ¼ → 1 → 4. */
export function bubbleIntensityGain(i: number): number {
  return 4 ** (2 * i - 1);
}

/**
 * Push per unit of signature velocity (1/s). Like Water, the push itself barely depends
 * on Viscosity (thick water resists it a little); drag does the rest. At baseline a
 * bubble in the wink's path travels about 0.15 short sides.
 */
export function bubbleForceGain(v: number, i: number): number {
  return 1.68 * (1.15 - 0.3 * v) * bubbleIntensityGain(i);
}

export function bubbleParams(props: PropertyValues, quality: Quality): BubbleParams {
  const viscosity = readProperty(props, VISCOSITY);
  const elasticity = readProperty(props, ELASTICITY);
  const persistence = readProperty(props, PERSISTENCE);
  const dispersion = readProperty(props, DISPERSION);
  const brightness = readProperty(props, BRIGHTNESS);
  const intensity = readProperty(props, INTENSITY);
  const density = readProperty(props, DENSITY);
  const range = readProperty(props, RANGE);
  const fallSpeed = readProperty(props, FALL_SPEED);
  const size = readProperty(props, SIZE);

  const drag = bubbleDrag(viscosity);
  const spreadT = Math.min(1, dispersion / 0.7);
  return {
    sim: {
      count: bubbleCount(density, quality),
      range,
      fallSpeed: bubbleFallSpeed(fallSpeed),
      popRate: bubblePopRate(persistence),
      forceGain: bubbleForceGain(viscosity, intensity),
      drag,
      // Like Water's lag: longer would smear the close into the open and cancel both.
      lagSec: 0.12 * viscosity * viscosity,
      spring: 40 * elasticity ** 4,
      wobbleFreq: 2.2 + 2.4 * elasticity,
      wobbleDamping: 0.55 - 0.47 * elasticity,
      wobbleDrive: 0.1 * elasticity * (1.4 - 0.6 * viscosity),
      walk: 0.004 + 0.05 * dispersion * dispersion,
      walkTime: 0.9,
      spread: spreadT * spreadT * (3 - 2 * spreadT),
      scatter: 1.2 * dispersion * dispersion,
      glowDecay: bubbleGlowDecay(persistence),
    },
    display: {
      radius: bubbleRadius(size),
      exposure: 2 ** (2.4 * (brightness - 0.5)),
      saturation: 0.7 + 0.65 * brightness,
    },
  };
}
