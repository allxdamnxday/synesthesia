/**
 * A5 Pulse control program: decides every pluck, as pure code over a plain state object
 * (stepped by the shared ControlTimeline on the 200 Hz grid; see controlTimeline.ts).
 *
 * - **A pulse clock** runs at a rate that follows the movement's energy (Range sets the slowest
 *   and fastest rate). Each time its phase wraps, a pulse may sound.
 * - **Onsets pluck at once**: a sudden movement (a signature onset) fires an accented pluck at
 *   its exact time and restarts the clock from there, so the wink's close and open each begin
 *   with a pluck (SPEC 9.3). The clock rests after a moment of stillness.
 * - **Density decides**: each pulse sounds with a probability from the movement's density
 *   feature times the Density property, drawn from the seed and the pulse's grid step (no
 *   generator state, so seeks, rewinds and offline renders draw the same values).
 * - **Pitch follows height**: higher movement (lower centroidY) plays higher notes, snapped to
 *   the Scale as Rigidity rises. Rigidity also pulls each pulse onto a steady grid.
 *
 * Each step reports up to two plucks (time, pitch, velocity, pan, noise seed) for the material
 * to write as worklet events at their exact times. Pulses between grid points keep their exact
 * (sub-step) times.
 */
import { clamp, clamp01, lerp, smoothstep } from '../../../lib/math';
import type { SignatureFrame } from '../../../signature/types';
import type { PropertyValues } from '../../types';
import { eventBoundary, onePoleCoefficient as onePole } from '../shared/automation';
import type { ControlProgram } from '../shared/controlTimeline';
import { panFromCentroid } from '../shared/mapping';
import {
  MIN_PULSE_GAP_SEC,
  PULSE_BASE_HZ,
  accentVelocity,
  derivePulseParams,
  fireChance,
  pluckNoiseSeed,
  pulseRandom,
  pulseVelocity,
  quantizeToScale,
  samePulseProps,
  type PulseParams,
} from './params';

/** Where the signature's onsets come from (the sampler). */
export interface OnsetSource {
  onsetsBetween(t0: number, t1: number): number[];
}

/**
 * Seconds of stillness after which the pulse clock rests (restarts from zero), so a movement
 * that begins after a pause (the wink's open) starts its own rhythm.
 */
export const STILL_RESET_SEC = 0.1;
/** Movement thresholds (normalized energy and density) for "moving". */
const MOVE_ENERGY = 0.02;
const MOVE_DENSITY = 0.02;
const PAN_GLIDE_SEC = 0.06;
const TIME_EPS = 1e-9;
const NO_ONSETS: readonly number[] = [];

/** One pluck, as reported by a step. */
export interface Pluck {
  t: number;
  freq: number;
  velocity: number;
  pan: number;
  seed: number;
  accent: boolean;
}

export interface PulseState {
  /** Energy follower that sets the clock rate (0..1). */
  rateF: number;
  /** Height follower (0 low … 1 high), held while nothing moves. */
  upF: number;
  panF: number;
  /** Pulse clock phase, 0..1. */
  phase: number;
  /** Seconds since the movement stopped. */
  stillSec: number;
  /** Time of the latest pluck (−1e9 before any). */
  lastT: number;
  // A pluck waiting for its (grid-quantized or scattered) time.
  pending: number;
  pendT: number;
  pendFreq: number;
  pendVel: number;
  pendPan: number;
  pendSeed: number;
  pendAccent: number;
  // Plucks reported by the latest step (count 0–2): slots a and b.
  count: number;
  aT: number;
  aFreq: number;
  aVel: number;
  aPan: number;
  aSeed: number;
  aAccent: number;
  bT: number;
  bFreq: number;
  bVel: number;
  bPan: number;
  bSeed: number;
  bAccent: number;
}

export function createPulseState(): PulseState {
  return {
    rateF: 0,
    upF: 0.5,
    panF: 0,
    phase: 0,
    stillSec: STILL_RESET_SEC + 1,
    lastT: -1e9,
    pending: 0,
    pendT: 0,
    pendFreq: 0,
    pendVel: 0,
    pendPan: 0,
    pendSeed: 0,
    pendAccent: 0,
    count: 0,
    aT: 0,
    aFreq: 0,
    aVel: 0,
    aPan: 0,
    aSeed: 0,
    aAccent: 0,
    bT: 0,
    bFreq: 0,
    bVel: 0,
    bPan: 0,
    bSeed: 0,
    bAccent: 0,
  };
}

/** The plucks a step reported, in slot order. */
export function plucksOf(s: PulseState): Pluck[] {
  const out: Pluck[] = [];
  if (s.count > 0) {
    out.push({
      t: s.aT,
      freq: s.aFreq,
      velocity: s.aVel,
      pan: s.aPan,
      seed: s.aSeed,
      accent: s.aAccent > 0,
    });
  }
  if (s.count > 1) {
    out.push({
      t: s.bT,
      freq: s.bFreq,
      velocity: s.bVel,
      pan: s.bPan,
      seed: s.bSeed,
      accent: s.bAccent > 0,
    });
  }
  return out;
}

/**
 * Which of a step's plucks to schedule. At the first grid point of a window that doesn't
 * simply continue the previous one (a start, seek or rewind), plucks before the window start
 * are skipped: they are in the past, or (after a rewind) already scheduled and kept.
 */
export function plucksToSchedule(
  s: PulseState,
  firstPoint: boolean,
  continued: boolean,
  windowStart: number,
): Pluck[] {
  const all = plucksOf(s);
  if (!firstPoint || continued) return all;
  return all.filter((p) => p.t >= windowStart - 1e-9);
}

function emit(s: PulseState, p: Pluck): void {
  if (s.count === 0) {
    s.aT = p.t;
    s.aFreq = p.freq;
    s.aVel = p.velocity;
    s.aPan = p.pan;
    s.aSeed = p.seed;
    s.aAccent = p.accent ? 1 : 0;
  } else if (s.count === 1) {
    s.bT = p.t;
    s.bFreq = p.freq;
    s.bVel = p.velocity;
    s.bPan = p.pan;
    s.bSeed = p.seed;
    s.bAccent = p.accent ? 1 : 0;
  } else {
    return;
  }
  s.count++;
  if (p.t > s.lastT) s.lastT = p.t;
}

export class PulseProgram implements ControlProgram<PulseState> {
  private readonly seed: number;
  /** Onsets of the signature being played; set by the material before each window. */
  onsets: OnsetSource | null = null;
  private cachedProps: PropertyValues | null = null;
  private cachedParams: PulseParams | null = null;

  constructor(seed: number) {
    this.seed = seed;
  }

  /** Derived parameters for these properties (cached while the values are unchanged). */
  params(props: PropertyValues): PulseParams {
    if (this.cachedParams && this.cachedProps && samePulseProps(this.cachedProps, props)) {
      return this.cachedParams;
    }
    this.cachedProps = { ...props };
    this.cachedParams = derivePulseParams(props);
    return this.cachedParams;
  }

  createState(): PulseState {
    return createPulseState();
  }

  reset(state: PulseState): void {
    Object.assign(state, createPulseState());
  }

  copy(from: PulseState, to: PulseState): void {
    Object.assign(to, from);
  }

  step(s: PulseState, frame: SignatureFrame, props: PropertyValues, dt: number): void {
    const p = this.params(props);
    s.count = 0;
    const rate = Math.round(1 / dt);
    const tb = frame.t;
    const ta = tb - dt;
    const k = Math.round(tb * rate);
    const n = frame.normalized;
    const energy = clamp01(n.energy);
    const density = clamp01(n.density);
    const surge = n.surge;
    const up = 1 - clamp01(n.centroidY);
    const moving = energy > MOVE_ENERGY && density > MOVE_DENSITY;

    // Followers: rate from energy (Viscosity slows it), height held while nothing moves.
    const rateTau = energy > s.rateF ? p.rateAttackSec : p.rateReleaseSec;
    s.rateF += (energy - s.rateF) * onePole(rateTau, dt);
    if (moving) s.upF += (up - s.upF) * onePole(p.pitchSlewSec, dt);
    const panTarget = panFromCentroid(frame.features.centroidX, p.dispersion);
    s.panF += (panTarget - s.panF) * onePole(PAN_GLIDE_SEC, dt) * smoothstep(0.005, 0.05, energy);
    s.stillSec = moving ? 0 : s.stillSec + dt;

    // A waiting pluck whose time has come.
    if (s.pending > 0 && s.pendT <= tb + TIME_EPS) {
      s.pending = 0;
      emit(s, {
        t: s.pendT,
        freq: s.pendFreq,
        velocity: s.pendVel,
        pan: s.pendPan,
        seed: s.pendSeed,
        accent: s.pendAccent > 0,
      });
    }

    // The clock. Onsets owned by this step lie in [boundary(k − 1), boundary(k)): the same
    // assignment the ControlTimeline uses for events, so every onset is seen exactly once.
    const hz = p.rateMinHz * Math.pow(p.rateMaxHz / p.rateMinHz, s.rateF);
    const onsets = this.onsets
      ? this.onsets.onsetsBetween(eventBoundary(k - 1, rate), eventBoundary(k, rate))
      : NO_ONSETS;
    let candidate = Number.NaN;
    let accent = false;
    if (onsets.length > 0) {
      candidate = onsets[0] ?? tb;
      accent = true;
      s.phase = Math.min(0.999, hz * Math.max(0, tb - candidate));
    } else if (s.stillSec > STILL_RESET_SEC) {
      s.phase = 0;
    } else {
      const before = s.phase;
      s.phase += hz * dt;
      if (s.phase >= 1) {
        s.phase -= 1;
        candidate = ta + ((1 - before) / (hz * dt)) * dt;
      }
    }
    if (!Number.isNaN(candidate)) {
      this.pulse(s, p, { k, stepEnd: tb, t: candidate, accent, energy, density, surge });
    }
  }

  /** A pulse candidate: does it sound, and with what pitch, level, place and time? */
  private pulse(s: PulseState, p: PulseParams, c: Candidate): void {
    const { k, t, accent, energy, density, surge } = c;
    const seed = this.seed;
    const chance = accent ? 1 : fireChance(p, density, energy);
    if (pulseRandom(seed, k, 0) >= chance) return;

    let st = p.pitchSpanSt * (s.upF - 0.5);
    if (p.scale && p.pitchSnap > 0) st = lerp(st, quantizeToScale(st, p.scale), p.pitchSnap);
    st += ((pulseRandom(seed, k, 1) * 2 - 1) * p.detuneCents) / 100;
    const pluck: Pluck = {
      t: accent ? t : t + pulseRandom(seed, k, 3) * p.jitterSec,
      freq: PULSE_BASE_HZ * Math.pow(2, st / 12),
      velocity: accent ? accentVelocity(surge) : pulseVelocity(energy),
      pan: clamp(s.panF + (pulseRandom(seed, k, 2) * 2 - 1) * p.panScatter, -1, 1),
      seed: pluckNoiseSeed(seed, k),
      accent,
    };
    if (p.timeSnap > 0) {
      const grid = Math.ceil(pluck.t * p.gridHz - 1e-9) / p.gridHz;
      pluck.t += p.timeSnap * (grid - pluck.t);
    }

    // Keep plucks apart (one per grid tick when quantized); an accent wins a clash.
    const tooClose = (other: number): boolean => Math.abs(pluck.t - other) < MIN_PULSE_GAP_SEC;
    if (!accent && (tooClose(s.lastT) || (s.pending > 0 && tooClose(s.pendT)))) return;

    if (pluck.t <= c.stepEnd + TIME_EPS) {
      emit(s, pluck);
    } else if (s.pending === 0 || accent) {
      s.pending = 1;
      s.pendT = pluck.t;
      s.pendFreq = pluck.freq;
      s.pendVel = pluck.velocity;
      s.pendPan = pluck.pan;
      s.pendSeed = pluck.seed;
      s.pendAccent = accent ? 1 : 0;
    }
  }
}

/** A pulse the clock (or an onset) offers during one step. */
interface Candidate {
  /** The step's grid index and end time. */
  k: number;
  stepEnd: number;
  /** When the pulse falls. */
  t: number;
  accent: boolean;
  energy: number;
  density: number;
  surge: number;
}
