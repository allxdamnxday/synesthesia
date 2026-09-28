/**
 * A3 Breath control program: what the sound does at each control step, as pure code over a
 * plain state object (stepped by the shared ControlTimeline; see controlTimeline.ts).
 *
 * The idea, air drawn in and let out:
 * - **Loudness follows energy**: the breath is only heard while something moves, swelling in
 *   (Viscosity softens the onset) and fading out (Persistence).
 * - **Divergence breathes.** Spreading movement (expansion) is an inhale: the breath swells
 *   and its band opens, rising and widening. Gathering movement (contraction) closes it: the
 *   band sinks and narrows. So a wink's close, which gathers the eyelid and cheek together,
 *   sounds as a closing breath and its open as the air opening again.
 * - **The band sits where the movement is**: higher in the frame, higher band (it holds its
 *   place when the movement stops). Brightness sets where the band rests.
 * - **Bandwidth follows spread × Dispersion**: movement spread over the frame gives a broad
 *   band of air, a small one a narrow band.
 * - A resonant glide (Viscosity sets its time, Elasticity its overshoot) moves the band.
 * - Pan follows where the movement is (horizontal centroid) and holds when it stops.
 */
import { clamp, clamp01, smoothstep } from '../../../lib/math';
import type { SignatureFrame } from '../../../signature/types';
import type { PropertyValues } from '../../types';
import { onePoleCoefficient as onePole } from '../shared/automation';
import type { ControlProgram } from '../shared/controlTimeline';
import {
  glideCoefficients,
  glideStep,
  IDENTITY_GLIDE,
  type GlideCoefficients,
  type GlideMemory,
} from '../shared/glide';
import { panFromCentroid } from '../shared/mapping';
import {
  deriveBreathParams,
  sameBreathProps,
  type BreathParams,
  type BreathVariation,
} from './params';

/** Shares of the range: the movement's height in the frame, and its opening and closing. */
export const HEIGHT_WEIGHT = 0.5;
export const DIVERGENCE_WEIGHT = 0.55;
/** Bandwidth: widening from spread × Dispersion, and octaves of opening per unit divergence. */
export const SPREAD_WIDEN = 1.2;
export const DIVERGENCE_WIDEN = 1;
/** Extra level at full expansion (the inhale's swell). */
export const SWELL = 0.5;
/**
 * How much of a narrower band's lost loudness is made up (0 = none, 0.5 = all): a closing
 * breath gets a little quieter, but the band's width never decides whether it's heard.
 */
const WIDTH_MAKEUP = 0.3;
/** Energy below which the breath falls silent (a soft gate), and the level curve's exponent. */
const GATE_LO = 0.012;
const GATE_HI = 0.06;
const LEVEL_POWER = 0.6;
/** Energy at which the movement's shape (height, spread, divergence) becomes trustworthy. */
const SHAPE_LO = 0.02;
const SHAPE_HI = 0.1;

export interface BreathState extends GlideMemory {
  /** Amplitude envelope. */
  env: number;
  /** Followed divergence, −1..1 (relaxes to 0 when nothing moves). */
  divergence: number;
  /** Followed vertical centroid, 0 (top) … 1 (bottom); holds when nothing moves. */
  height: number;
  /** Followed spread, 0..1; holds when nothing moves. */
  spread: number;
  /** Smoothed pan. */
  pan: number;
  // Outputs written to the control buses at each grid point.
  amp: number;
  /** Band centre shift, cents. */
  shiftCents: number;
  /** Q multiplier for the air layers (below 1 = wider). */
  qScale: number;
  /** Q multiplier for the vowel formants (half as strong, so vowels stay recognisable). */
  formantQScale: number;
  panOut: number;
}

export function createBreathState(): BreathState {
  return {
    env: 0,
    divergence: 0,
    height: 0.5,
    spread: 0.5,
    pan: 0,
    gx1: 0,
    gx2: 0,
    gy1: 0,
    gy2: 0,
    amp: 0,
    shiftCents: 0,
    qScale: 1,
    formantQScale: 1,
    panOut: 0,
  };
}

/** How much wider than its base the band is, for a spread, Dispersion and divergence. */
export function bandWidening(spread: number, dispersion: number, divergence: number): number {
  return (
    (1 + SPREAD_WIDEN * clamp01(spread) * clamp01(dispersion)) *
    Math.pow(2, DIVERGENCE_WIDEN * clamp(divergence, -1, 1))
  );
}

/** Band shift in semitones for a height (0 top … 1 bottom) and divergence (−1..1). */
export function bandShiftSemitones(rangeSt: number, height: number, divergence: number): number {
  return (
    rangeSt *
    (HEIGHT_WEIGHT * (0.5 - clamp01(height)) * 2 + DIVERGENCE_WEIGHT * clamp(divergence, -1, 1))
  );
}

export class BreathProgram implements ControlProgram<BreathState> {
  private readonly variation: BreathVariation;
  private cachedProps: PropertyValues | null = null;
  private cachedParams: BreathParams | null = null;
  private cachedDt = 0;
  private coeffs: GlideCoefficients = { ...IDENTITY_GLIDE };

  constructor(variation: BreathVariation) {
    this.variation = variation;
  }

  /** Derived parameters for these properties (cached while the values are unchanged). */
  params(props: PropertyValues): BreathParams {
    if (this.cachedParams && this.cachedProps && sameBreathProps(this.cachedProps, props)) {
      return this.cachedParams;
    }
    this.cachedProps = { ...props };
    this.cachedParams = deriveBreathParams(props, this.variation);
    this.cachedDt = 0;
    return this.cachedParams;
  }

  createState(): BreathState {
    return createBreathState();
  }

  reset(state: BreathState): void {
    Object.assign(state, createBreathState());
  }

  copy(from: BreathState, to: BreathState): void {
    Object.assign(to, from);
  }

  step(s: BreathState, frame: SignatureFrame, props: PropertyValues, dt: number): void {
    const p = this.params(props);
    if (this.cachedDt !== dt) {
      this.coeffs = glideCoefficients(p.shiftGlideSec, p.shiftGlideQ, dt);
      this.cachedDt = dt;
    }
    const n = frame.normalized;
    const energy = clamp01(n.energy);
    // The movement's shape only means something while enough of it moves.
    const trust = smoothstep(SHAPE_LO, SHAPE_HI, energy);
    const follow = onePole(p.followSec, dt);

    s.divergence += (clamp(n.divergence, -1, 1) * trust - s.divergence) * follow;
    s.height += (clamp01(frame.features.centroidY) - s.height) * follow * trust;
    s.spread += (clamp01(n.spread) - s.spread) * follow * trust;

    // The band: where the movement is, opened by expansion and closed by contraction.
    const target = bandShiftSemitones(p.rangeSt, s.height, s.divergence);
    s.shiftCents = 100 * glideStep(this.coeffs, s, target);
    const widening = bandWidening(s.spread, p.dispersion, s.divergence);
    s.qScale = 1 / widening;
    s.formantQScale = 1 / Math.sqrt(widening);

    // Loudness: energy, swelling as the movement spreads (the inhale).
    const level =
      p.level *
      smoothstep(GATE_LO, GATE_HI, energy) *
      Math.pow(energy, LEVEL_POWER) *
      (1 + SWELL * Math.max(0, s.divergence)) *
      Math.pow(widening, -WIDTH_MAKEUP);
    s.env += (level - s.env) * onePole(level > s.env ? p.attackSec : p.releaseSec, dt);
    s.amp = s.env;

    // Pan follows where the movement is, and stays put when it stops.
    const panTarget = clamp(
      panFromCentroid(frame.features.centroidX, p.dispersion) + p.panOffset,
      -1,
      1,
    );
    s.pan += (panTarget - s.pan) * onePole(p.panGlideSec, dt) * smoothstep(0.005, 0.05, energy);
    s.panOut = s.pan;
  }
}
