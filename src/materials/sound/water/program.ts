/**
 * A1 Water control program: what the sound does at each control step, as pure code over a
 * plain state object (stepped by the shared ControlTimeline; see controlTimeline.ts).
 *
 * The idea, "Breee-weet!":
 * - **Pitch rises with rising movement.** Pitch follows the movement's vertical travel, a
 *   (slowly leaking) running total of upward flow. Moving up keeps raising the pitch, stopping
 *   holds it, moving down lowers it, so a rising gesture ends high ("-weet!") instead of
 *   falling back as the movement slows. Any movement also lifts the pitch a little.
 * - **Loudness follows energy** with a fast attack; the release comes from Persistence, so
 *   the wink's close and open stay separate sounds at baseline (SPEC 9.3).
 * - **Brightness follows movement**: the FM index rises with energy and gets a kick, plus a
 *   quick flutter (the "Br"), when energy suddenly gathers.
 * - A resonant glide (Viscosity sets its time, Elasticity its overshoot) and a vibrato that
 *   wakes on jolts (acceleration) shape the pitch contour.
 * - Pan follows where the movement is (horizontal centroid) and holds when it stops.
 */
import { lerp, smoothstep } from '../../../lib/math';
import type { SignatureFrame } from '../../../signature/types';
import type { PropertyValues } from '../../types';
import { onePoleCoefficient as onePole, timeConstantFor } from '../shared/automation';
import type { ControlProgram } from '../shared/controlTimeline';
import { panFromCentroid, upwardFlow } from '../shared/mapping';
import {
  deriveWaterParams,
  quantizePentatonic,
  sameWaterProps,
  type WaterParams,
  type WaterVariation,
} from './params';

/**
 * Seconds for the vertical-travel memory to fade while there is no vertical movement (so the
 * pitch drifts home between gestures).
 */
export const TRAVEL_LEAK_SEC = 1.5;
/** Travel (normalized flow × seconds) that covers ~76% of the pitch range (tanh(1)). */
export const TRAVEL_SCALE = 0.2;
/** Share of the range driven by travel and by the energy lift. */
const TRAVEL_WEIGHT = 0.85;
const LIFT_WEIGHT = 0.2;
const LIFT_RISE_SEC = 0.04;
const LIFT_RELAX_SEC = 1.0;
/** Normalized surge that fires the onset buzz, and the level below which it re-arms. */
const FIRE_SURGE = 0.5;
const REARM_SURGE = 0.2;
const KICK_DECAY_SEC = 0.07;
/** Glide of the base pitch on a register change (matches the oscillators' StaticParams). */
export const BASE_GLIDE_SEC = 0.08;
const FLUTTER_DECAY_SEC = 0.09;

export interface WaterState {
  /** Leaky running total of upward flow (normalized units × seconds). */
  travel: number;
  /** Energy lift follower, 0..1 (quick to rise, slow to relax). */
  lift: number;
  /** Amplitude envelope. */
  env: number;
  // Resonant glide (biquad low-pass on the pitch target, semitones).
  gx1: number;
  gx2: number;
  gy1: number;
  gy2: number;
  /** Vibrato depth (semitones) and phase (radians). */
  vib: number;
  vibPhase: number;
  /** Onset kick (brightness) and flutter depth, fired by sudden gathering, then decaying. */
  kick: number;
  flutter: number;
  /** 1 when a new gathering may fire the kick (re-armed once the surge has subsided). */
  armed: number;
  /** Smoothed pan. */
  pan: number;
  /**
   * FM deviation per unit index (Hz at the base pitch). Glides with the base pitch when the
   * register changes, so the brightness doesn't spike while the pitch moves. 0 = not yet set.
   */
  devBase: number;
  // Outputs written to the control buses at each grid point.
  pitchCents: number;
  amp: number;
  deviation: number;
  flutterDepth: number;
  panOut: number;
}

export function createWaterState(): WaterState {
  return {
    travel: 0,
    lift: 0,
    env: 0,
    gx1: 0,
    gx2: 0,
    gy1: 0,
    gy2: 0,
    vib: 0,
    vibPhase: 0,
    kick: 0,
    flutter: 0,
    armed: 1,
    pan: 0,
    devBase: 0,
    pitchCents: 0,
    amp: 0,
    deviation: 0,
    flutterDepth: 0,
    panOut: 0,
  };
}

interface GlideCoefficients {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/**
 * RBJ low-pass biquad at the control rate. `glideSec` is roughly the 90% rise time with no
 * overshoot (Q 0.5 is critically damped); higher Q rings past the target.
 */
export function glideCoefficients(glideSec: number, q: number, dt: number): GlideCoefficients {
  const rate = 1 / dt;
  const fc = Math.min(0.4 * rate, 0.62 / Math.max(1e-3, glideSec));
  const w0 = (2 * Math.PI * fc) / rate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Math.max(0.1, q));
  const a0 = 1 + alpha;
  return {
    b0: (1 - cos) / 2 / a0,
    b1: (1 - cos) / a0,
    b2: (1 - cos) / 2 / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
}

export class WaterProgram implements ControlProgram<WaterState> {
  private readonly variation: WaterVariation;
  private cachedProps: PropertyValues | null = null;
  private cachedParams: WaterParams | null = null;
  private cachedDt = 0;
  private coeffs: GlideCoefficients = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };

  constructor(variation: WaterVariation) {
    this.variation = variation;
  }

  /** Derived parameters for these properties (cached while the values are unchanged). */
  params(props: PropertyValues): WaterParams {
    if (this.cachedParams && this.cachedProps && sameWaterProps(this.cachedProps, props)) {
      return this.cachedParams;
    }
    this.cachedProps = { ...props };
    this.cachedParams = deriveWaterParams(props, this.variation);
    this.cachedDt = 0;
    return this.cachedParams;
  }

  createState(): WaterState {
    return createWaterState();
  }

  reset(state: WaterState): void {
    Object.assign(state, createWaterState());
  }

  copy(from: WaterState, to: WaterState): void {
    Object.assign(to, from);
  }

  step(s: WaterState, frame: SignatureFrame, props: PropertyValues, dt: number): void {
    const p = this.params(props);
    if (this.cachedDt !== dt) {
      this.coeffs = glideCoefficients(p.glideSec, p.glideQ, dt);
      this.cachedDt = dt;
    }
    const n = frame.normalized;
    const energy = Math.min(1, Math.max(0, n.energy));
    const up = upwardFlow(frame);
    const accel = Math.min(1, Math.max(0, n.acceleration));
    const surge = Math.max(0, Math.min(1, n.surge));

    // Pitch: vertical travel plus a little lift from any movement. Rising movement never
    // lowers the pitch: the travel only drifts home (leaks) when there is no vertical
    // movement, and the lift only relaxes when the movement isn't rising.
    const vertical = smoothstep(0.02, 0.12, Math.abs(up));
    const rising = smoothstep(0.02, 0.12, up);
    s.travel += (up - (1 - vertical) * (s.travel / TRAVEL_LEAK_SEC)) * dt;
    const liftRate =
      energy > s.lift ? onePole(LIFT_RISE_SEC, dt) : onePole(LIFT_RELAX_SEC, dt) * (1 - rising);
    s.lift += (energy - s.lift) * liftRate;
    let target =
      p.rangeSt * (TRAVEL_WEIGHT * Math.tanh(s.travel / TRAVEL_SCALE) + LIFT_WEIGHT * s.lift);
    if (p.quantize > 0) target = lerp(target, quantizePentatonic(target), p.quantize);

    // Resonant glide (Direct Form I: robust when coefficients change live).
    const c = this.coeffs;
    const glided = c.b0 * target + c.b1 * s.gx1 + c.b2 * s.gx2 - c.a1 * s.gy1 - c.a2 * s.gy2;
    s.gx2 = s.gx1;
    s.gx1 = target;
    s.gy2 = s.gy1;
    s.gy1 = glided;

    // Vibrato that wakes on jolts and settles with Elasticity.
    const vibTarget = p.vibMaxSt * smoothstep(0.35, 0.9, accel);
    s.vib += (vibTarget - s.vib) * onePole(vibTarget > s.vib ? 0.02 : p.vibDecaySec, dt);
    s.vibPhase += 2 * Math.PI * p.vibRateHz * dt;
    if (s.vibPhase > 2 * Math.PI) s.vibPhase -= 2 * Math.PI;
    s.pitchCents = 100 * (glided + s.vib * Math.sin(s.vibPhase));

    // Loudness: energy with a fast attack; silence below a small gate.
    const level = p.level * smoothstep(0.012, 0.06, energy) * Math.pow(energy, 0.6);
    s.env += (level - s.env) * onePole(level > s.env ? p.attackSec : p.releaseSec, dt);
    s.amp = s.env;

    // Brightness: the FM index follows movement. A sudden gathering of energy fires a short
    // buzz once (the "Br"): an index kick plus a quick flutter, both decaying in ~0.1 s.
    s.kick *= 1 - onePole(KICK_DECAY_SEC, dt);
    s.flutter *= 1 - onePole(FLUTTER_DECAY_SEC, dt);
    if (s.armed > 0 && surge > FIRE_SURGE) {
      s.armed = 0;
      s.kick = Math.max(s.kick, surge);
      s.flutter = Math.max(s.flutter, p.flutterMax * surge);
    } else if (surge < REARM_SURGE) {
      s.armed = 1;
    }
    const index = p.indexBase * (0.35 + 0.65 * Math.sqrt(energy)) + p.kickIndex * s.kick;
    if (s.devBase <= 0) s.devBase = p.devScale;
    else s.devBase += (p.devScale - s.devBase) * onePole(timeConstantFor(BASE_GLIDE_SEC), dt);
    s.deviation = index * s.devBase;
    s.flutterDepth = s.flutter;

    // Pan follows where the movement is, and stays put when it stops.
    const panTarget = panFromCentroid(frame.features.centroidX, p.dispersion);
    s.pan += (panTarget - s.pan) * onePole(p.panGlideSec, dt) * smoothstep(0.005, 0.05, energy);
    s.panOut = s.pan;
  }
}
