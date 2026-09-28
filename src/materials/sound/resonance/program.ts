/**
 * A4 Resonance control program: the continuous part of the sound, as pure code over a plain
 * state object (stepped by the shared ControlTimeline; see controlTimeline.ts). The strikes
 * themselves are discrete events at the signature's onsets (resonance.ts).
 *
 * - **Singing**: while the movement lasts, seeded noise "bows" the body, so it sings softly
 *   in proportion to the movement's energy. Viscosity makes the singing swell and fade slowly.
 * - **Damper**: once the movement stops, a damper settles on the body and the ring dies with
 *   the release time Persistence sets. While anything moves, the body rings freely. So the
 *   wink's close rings out before the open is struck (SPEC 9.3), unless Persistence is high.
 * - **Pan** follows where the movement is (horizontal centroid) and holds when it stops.
 */
import { smoothstep } from '../../../lib/math';
import type { SignatureFrame } from '../../../signature/types';
import type { PropertyValues } from '../../types';
import { onePoleCoefficient as onePole } from '../shared/automation';
import type { ControlProgram } from '../shared/controlTimeline';
import { panFromCentroid } from '../shared/mapping';
import { deriveResonanceParams, sameResonanceProps, type ResonanceParams } from './params';

/** Movement follower: quick to notice movement, a little slower to notice stillness. */
const MOVE_ATTACK_SEC = 0.01;
const MOVE_RELEASE_SEC = 0.06;
/** Normalized energy where the body counts as moving (the damper lifts). */
const MOVE_LO = 0.02;
const MOVE_HI = 0.1;

export interface ResonanceState {
  /** Singing level follower. */
  bow: number;
  /** 0 still … 1 moving. */
  move: number;
  /** Smoothed pan. */
  pan: number;
  // Outputs written to the control buses at each grid point.
  bowOut: number;
  dampOut: number;
  panOut: number;
}

export function createResonanceState(): ResonanceState {
  return { bow: 0, move: 0, pan: 0, bowOut: 0, dampOut: 0, panOut: 0 };
}

/** Singing target for a normalized energy (silent below a small gate). */
export function bowShape(energy: number): number {
  const e = energy < 0 ? 0 : energy > 1 ? 1 : energy;
  return smoothstep(0.03, 0.15, e) * Math.pow(e, 0.8);
}

export class ResonanceProgram implements ControlProgram<ResonanceState> {
  private readonly sampleRate: number;
  private cachedProps: PropertyValues | null = null;
  private cachedParams: ResonanceParams | null = null;

  constructor(sampleRate = 48000) {
    this.sampleRate = sampleRate;
  }

  /** Derived parameters for these properties (cached while the values are unchanged). */
  params(props: PropertyValues): ResonanceParams {
    if (this.cachedParams && this.cachedProps && sameResonanceProps(this.cachedProps, props)) {
      return this.cachedParams;
    }
    this.cachedProps = { ...props };
    this.cachedParams = deriveResonanceParams(props, this.sampleRate);
    return this.cachedParams;
  }

  createState(): ResonanceState {
    return createResonanceState();
  }

  reset(state: ResonanceState): void {
    Object.assign(state, createResonanceState());
  }

  copy(from: ResonanceState, to: ResonanceState): void {
    Object.assign(to, from);
  }

  step(s: ResonanceState, frame: SignatureFrame, props: PropertyValues, dt: number): void {
    const p = this.params(props);
    const energy = Math.min(1, Math.max(0, frame.normalized.energy));

    // Singing: bowed noise follows the energy, slewed by Viscosity.
    const bowTarget = p.bowLevel * bowShape(energy);
    s.bow +=
      (bowTarget - s.bow) * onePole(bowTarget > s.bow ? p.bowAttackSec : p.bowReleaseSec, dt);
    s.bowOut = s.bow;

    // Damper: off while moving, on (at Persistence's release) once the movement stops.
    const moving = smoothstep(MOVE_LO, MOVE_HI, energy);
    s.move += (moving - s.move) * onePole(moving > s.move ? MOVE_ATTACK_SEC : MOVE_RELEASE_SEC, dt);
    s.dampOut = (1 - s.move) * p.dampRate;

    // Pan follows where the movement is, and stays put when it stops.
    const panTarget = panFromCentroid(frame.features.centroidX, p.dispersion);
    s.pan += (panTarget - s.pan) * onePole(p.panGlideSec, dt) * smoothstep(0.005, 0.05, energy);
    s.panOut = s.pan;
  }
}
