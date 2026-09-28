/**
 * A2 Honey control program: what the sound does at each control step, as pure code over a
 * plain state object (stepped by the shared ControlTimeline; see controlTimeline.ts).
 *
 * The idea, "Broo-roo-roo-roo-rooo-oot":
 * - **The honey has its own motion** (`flow`): it gathers with the movement, lags behind it
 *   (Viscosity) and keeps moving for a while after the movement stops.
 * - **It stutters.** A smooth-square gate breaks the hum into "roo" syllables. The rate
 *   follows the flow (faster movement, faster "roo"), so as the honey settles the syllables
 *   slow down ("rooo"). Each syllable opens the filter a little (a "wah") and scoops up into
 *   its pitch. The gate runs here, at the control rate, so preview and render stutter in
 *   exactly the same places, and the phase carries on through loop wraps.
 * - **Each movement starts with a "Broo".** A sudden gathering (an onset) starts a new
 *   syllable at once, louder and brighter. So the wink's close and open each begin with
 *   their own "Broo" even though the honey is still sounding from the close (SPEC 9.3).
 * - **Pitch** rises a little with the flow and follows vertical travel (moving up raises it,
 *   moving down lowers it), through a slow resonant glide. As the flow falls away after a
 *   movement the pitch sinks below where it started (the "oot"); it only relaxes back once
 *   the sound has faded, so it is never heard rising again, and the next movement scoops up
 *   from below.
 * - **Loudness** follows the flow with a soft attack (Viscosity) and a long release
 *   (Persistence). The filter opens with the flow and closes as the pitch sinks.
 * - **Pan** follows where the movement is (horizontal centroid) and holds when it stops.
 */
import { clamp01, smoothstep } from '../../../lib/math';
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
import { panFromCentroid, upwardFlow } from '../shared/mapping';
import { deriveHoneyParams, sameHoneyProps, type HoneyParams, type HoneyVariation } from './params';

/** Seconds for the vertical-travel memory to fade while there is no vertical movement. */
export const TRAVEL_LEAK_SEC = 1.5;
/** Travel (normalized flow × seconds) that covers ~76% of its share of the range (tanh(1)). */
export const TRAVEL_SCALE = 0.2;
/** Shares of the pitch range: vertical travel, lift from the flow, and the fall ("oot"). */
export const TRAVEL_WEIGHT = 0.6;
export const LIFT_WEIGHT = 0.25;
export const DROOP_WEIGHT = 0.8;
/**
 * Loudness has two parts: the movement itself (quick to follow, released by Persistence)
 * and the honey's drawn-out motion after it (the flow, slow to settle). Between the wink's
 * close and open the first part has gone and only the quieter second remains, so the two
 * gestures stay distinct even though the honey never quite stops.
 */
export const DIRECT_SHARE = 0.75;
export const DRAWN_SHARE = 0.3;
/**
 * The "B" of "Broo": at each onset the sound closes briefly (a smooth dip, like lips
 * closing) before the new syllable opens, so a movement that starts while the honey is
 * still sounding is heard starting.
 */
const B_DIP_SEC = 0.05;
const B_DIP_DEPTH = 0.55;
const B_DIP_DEPTH_STUTTER = 0.35;
/** Seconds for the direct part to let go of the movement (before the envelope's release). */
const DIRECT_FALL_SEC = 0.05;
/** The envelope's own attack (the softness comes from the direct part's Viscosity attack). */
const ENV_ATTACK_SEC = 0.008;
/** Seconds for the remembered peak (which sets the fall) to relax once the sound has faded. */
const PEAK_RELAX_SEC = 0.8;
/** Normalized surge that starts a new syllable, and the level below which it re-arms. */
export const FIRE_SURGE = 0.45;
const REARM_SURGE = 0.15;
/** The onset accent ("B"): decay, extra level, and how far it opens the filter (octaves). */
const ACCENT_DECAY_SEC = 0.15;
const ACCENT_GAIN = 0.8;
const ACCENT_OCT = 0.7;
/** Filter "wah" per syllable (octaves at full stutter depth) and pitch scoop (semitones). */
const WAH_OCT = 0.8;
const SCOOP_ST = 0.7;
/** How much of the pitch movement the filter follows (keeps the fall dark). */
const KEY_TRACK = 0.5;
/** Share of the filter's opening that follows the movement itself rather than the flow. */
const OPEN_DIRECT = 0.8;
/** Flow below which the honey falls silent (a soft gate), and the level curve's exponent. */
const GATE_LO = 0.015;
const GATE_HI = 0.08;
const LEVEL_POWER = 0.7;

/** Share of the stutter cycle spent rising into a syllable, and where the syllable falls. */
export const STUTTER_EDGE = 0.18;
export const STUTTER_FALL_AT = 0.62;

/**
 * Smooth-square stutter gate over one cycle (phase 0–1): rise (raised cosine), hold open,
 * fall, rest closed. 1 = open, 0 = closed.
 */
export function stutterGate(phase: number): number {
  const x = phase - Math.floor(phase);
  if (x < STUTTER_EDGE) return 0.5 - 0.5 * Math.cos((Math.PI * x) / STUTTER_EDGE);
  if (x < STUTTER_FALL_AT) return 1;
  if (x < STUTTER_FALL_AT + STUTTER_EDGE) {
    return 0.5 + 0.5 * Math.cos((Math.PI * (x - STUTTER_FALL_AT)) / STUTTER_EDGE);
  }
  return 0;
}

/**
 * Phase that starts a new syllable now without a jump in level: an open or rising gate
 * carries on (an open one restarts its full open span); a falling or closed gate turns
 * round onto the rising edge at its current value.
 */
export function syllableRestartPhase(phase: number): number {
  const x = phase - Math.floor(phase);
  if (x < STUTTER_EDGE) return x;
  if (x < STUTTER_FALL_AT) return STUTTER_EDGE;
  const g = stutterGate(x);
  return (STUTTER_EDGE / Math.PI) * Math.acos(Math.min(1, Math.max(-1, 1 - 2 * g)));
}

/** Stutter rate (Hz) for a flow (0–1): faster movement, faster "roo". */
export function stutterRateHz(p: Pick<HoneyParams, 'rateLoHz' | 'rateHiHz'>, flow: number): number {
  return p.rateLoHz + (p.rateHiHz - p.rateLoHz) * Math.pow(clamp01(flow), 0.8);
}

export interface HoneyState extends GlideMemory {
  /** The honey's own motion, 0..1: a slewed follower of the movement's energy. */
  flow: number;
  /** The movement itself, 0..1: a quick follower of energy (soft attack from Viscosity). */
  direct: number;
  /** Amplitude envelope before the stutter. */
  env: number;
  /** Leaky running total of upward flow (normalized units × seconds). */
  travel: number;
  /** Recent peak of the flow; the fall ("oot") is measured from it. */
  peak: number;
  /** Stutter phase, 0–1. */
  phase: number;
  /** Onset accent ("B"), fired by sudden gathering, then decaying. */
  accent: number;
  /** 1 when a new gathering may fire the accent (re-armed once the surge has subsided). */
  armed: number;
  /** Seconds since the last "B" closure began, or −1 when none is running. */
  bTime: number;
  /** Smoothed pan. */
  pan: number;
  // Outputs written to the control buses at each grid point.
  pitchCents: number;
  amp: number;
  cutoffCents: number;
  panOut: number;
  // Exposed for tests and analysis.
  rateHz: number;
  gate: number;
}

export function createHoneyState(phase = 0): HoneyState {
  return {
    flow: 0,
    direct: 0,
    env: 0,
    travel: 0,
    peak: 0,
    phase,
    accent: 0,
    armed: 1,
    bTime: -1,
    pan: 0,
    gx1: 0,
    gx2: 0,
    gy1: 0,
    gy2: 0,
    pitchCents: 0,
    amp: 0,
    cutoffCents: 0,
    panOut: 0,
    rateHz: 0,
    gate: 0,
  };
}

export class HoneyProgram implements ControlProgram<HoneyState> {
  private readonly variation: HoneyVariation;
  private cachedProps: PropertyValues | null = null;
  private cachedParams: HoneyParams | null = null;
  private cachedDt = 0;
  private coeffs: GlideCoefficients = { ...IDENTITY_GLIDE };

  constructor(variation: HoneyVariation) {
    this.variation = variation;
  }

  /** Derived parameters for these properties (cached while the values are unchanged). */
  params(props: PropertyValues): HoneyParams {
    if (this.cachedParams && this.cachedProps && sameHoneyProps(this.cachedProps, props)) {
      return this.cachedParams;
    }
    this.cachedProps = { ...props };
    this.cachedParams = deriveHoneyParams(props, this.variation);
    this.cachedDt = 0;
    return this.cachedParams;
  }

  createState(): HoneyState {
    return createHoneyState(this.variation.phase);
  }

  reset(state: HoneyState): void {
    Object.assign(state, createHoneyState(this.variation.phase));
  }

  copy(from: HoneyState, to: HoneyState): void {
    Object.assign(to, from);
  }

  step(s: HoneyState, frame: SignatureFrame, props: PropertyValues, dt: number): void {
    const p = this.params(props);
    if (this.cachedDt !== dt) {
      this.coeffs = glideCoefficients(p.glideSec, p.glideQ, dt);
      this.cachedDt = dt;
    }
    const n = frame.normalized;
    const energy = clamp01(n.energy);
    const surge = Math.max(-1, Math.min(1, n.surge));
    const up = upwardFlow(frame);

    // The honey's own motion: gathers with the movement, lags, and settles slowly.
    s.flow += (energy - s.flow) * onePole(energy > s.flow ? p.flowRiseSec : p.flowFallSec, dt);
    s.direct +=
      (energy - s.direct) * onePole(energy > s.direct ? p.attackSec : DIRECT_FALL_SEC, dt);

    // A sudden gathering starts a new syllable, louder and brighter: the "B" of "Broo".
    s.accent *= 1 - onePole(ACCENT_DECAY_SEC, dt);
    if (s.armed > 0 && surge > FIRE_SURGE) {
      s.armed = 0;
      s.accent = Math.max(s.accent, surge);
      s.phase = syllableRestartPhase(s.phase);
      s.bTime = 0;
    } else if (surge < REARM_SURGE) {
      s.armed = 1;
    }
    let bDip = 0;
    if (s.bTime >= 0) {
      const x = Math.sin((Math.PI * s.bTime) / B_DIP_SEC);
      bDip = (B_DIP_DEPTH + B_DIP_DEPTH_STUTTER * p.stutterDepth) * x * x;
      s.bTime += dt;
      if (s.bTime >= B_DIP_SEC) s.bTime = -1;
    }

    // The stutter: its rate follows the flow, so the syllables slow down as the honey settles.
    s.rateHz = stutterRateHz(p, s.flow);
    s.phase += s.rateHz * dt;
    s.phase -= Math.floor(s.phase);
    s.gate = stutterGate(s.phase);
    const closed = 1 - s.gate;

    // Loudness: the movement itself plus the honey's drawn-out motion after it.
    const level =
      p.level *
      smoothstep(GATE_LO, GATE_HI, s.flow) *
      (DIRECT_SHARE * Math.pow(s.direct, LEVEL_POWER) +
        DRAWN_SHARE * Math.pow(s.flow, LEVEL_POWER)) *
      (1 + ACCENT_GAIN * s.accent);
    s.env += (level - s.env) * onePole(level > s.env ? ENV_ATTACK_SEC : p.releaseSec, dt);
    s.amp = s.env * (1 - p.stutterDepth * closed) * (1 - bDip);

    // Pitch: vertical travel, a lift from the flow, and the fall below the recent peak.
    const vertical = smoothstep(0.02, 0.12, Math.abs(up));
    s.travel += (up - (1 - vertical) * (s.travel / TRAVEL_LEAK_SEC)) * dt;
    if (s.flow >= s.peak) {
      s.peak = s.flow;
    } else {
      // Relax the fall only once the sound has faded, so the pitch is never heard rising back.
      const quiet = 1 - smoothstep(0.03, 0.25, p.level > 0 ? s.env / p.level : 0);
      s.peak += (s.flow - s.peak) * onePole(PEAK_RELAX_SEC, dt) * quiet;
    }
    const target =
      p.rangeSt *
      (TRAVEL_WEIGHT * Math.tanh(s.travel / TRAVEL_SCALE) +
        LIFT_WEIGHT * s.flow -
        DROOP_WEIGHT * (s.peak - s.flow));
    const glided = glideStep(this.coeffs, s, target);
    // Each syllable scoops up into its vowel (heard on the syllable's edges).
    s.pitchCents = 100 * (glided - SCOOP_ST * p.stutterDepth * closed);

    // Filter: opens with the movement itself and on the accent; closes between syllables, as
    // the pitch sinks, and as the movement gives way to the honey's own drawn-out motion (so
    // the tail darkens into its "oot").
    const octaves =
      p.openOct * (OPEN_DIRECT * s.direct + (1 - OPEN_DIRECT) * s.flow) -
      WAH_OCT * p.stutterDepth * closed +
      ACCENT_OCT * s.accent +
      (KEY_TRACK * glided) / 12;
    s.cutoffCents = 1200 * octaves;

    // Pan follows where the movement is, and stays put when it stops.
    const panTarget = panFromCentroid(frame.features.centroidX, p.dispersion);
    s.pan += (panTarget - s.pan) * onePole(p.panGlideSec, dt) * smoothstep(0.005, 0.05, energy);
    s.panOut = s.pan;
  }
}
