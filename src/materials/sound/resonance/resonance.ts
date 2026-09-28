/**
 * A4 Resonance sound material (SPEC 9.5): a modal resonator bank (modal.worklet.js) struck at
 * the signature's onsets and bowed by energy-scaled seeded noise.
 *
 * Graph:
 *
 *   control buses (ConstantSource, automated at the control rate)
 *     bow ──► bow gain        damp ──► bank.damp        pan ──► panner
 *
 *   seeded noise (loop) ─► low-pass ─► bow gain ─► modal bank ─► panner ─► seek dip ─► level
 *   strikes: `strike` lane on the bank (one event per onset, exact sample)                │
 *                                              ┌──────── low-pass ◄──────── drive ◄──────┘
 *                                              ├─► dry ─► out
 *                                              └─► send ─► reverb ─► out
 *
 * The twelve modes are summed inside the worklet in a fixed order, and no input here takes
 * more than two sounding sources (see mixPairwise in shared/graph.ts), so renders are
 * bit-identical. The modal table (frequency, ring time and gain of each mode) and everything
 * else that changes only with properties are StaticParams. Strikes and resets are
 * TriggerLane events.
 *
 * After a seek (or the engine's resync of a starved scheduler, which is a seek without its
 * fade) the output dips briefly (shared/seekDipGain.ts): under the dip the body is silenced
 * and the bow noise realigned to composition time, and the control buses glide from where they
 * froze (shared/seekDip.ts, shared/holdingBus.ts).
 */
import { hash32 } from '../../../chance/prng';
import type { ScheduleWindow, SoundMaterial } from '../../types';
import { StaticParam } from '../shared/automation';
import { ControlTimeline, type ContinuityMode } from '../shared/controlTimeline';
import { driveCurve, driveStageGains } from '../shared/graph';
import { HoldingControlBus } from '../shared/holdingBus';
import { reverbDecaySeconds, upwardFlow } from '../shared/mapping';
import { createNoiseBuffer } from '../shared/noise';
import { Reverb } from '../shared/reverb';
import { seekGlideHolds } from '../shared/seekDip';
import { SeekDipGain } from '../shared/seekDipGain';
import { TriggerLane, workletParam } from '../shared/triggers';
import { loadWorklet } from '../shared/worklets';
import { RESONANCE_SOUND_META } from './meta';
import modalUrl from './modal.worklet.js?url&no-inline';
import { MODE_COUNT, malletSeconds, strikeVelocity, type ResonanceParams } from './params';
import { ResonanceProgram, type ResonanceState } from './program';

/** Processor name registered by modal.worklet.js. */
export const MODAL_PROCESSOR = 'sp-modal-bank';
export const MODAL_WORKLET_URL: string = modalUrl;

/** Seconds of seeded noise looped for the bowed excitation. */
const BOW_NOISE_SEC = 2.5;
const NOISE_SALT = 0x424f5721; // "BOW!"
const REVERB_SALT = 0x5245534f; // "RESO"
/** Where the strike reads the movement after an onset (s). */
const STRIKE_LOOK = [0, 0.02, 0.04] as const;

type StrikeKey = 'velocity' | 'mallet' | 'bounce' | 'bounceHz' | 'bounceDecay';

interface ModeStatics {
  freq: StaticParam;
  decay: StaticParam;
  gain: StaticParam;
}

class ResonanceSound implements SoundMaterial {
  readonly id = RESONANCE_SOUND_META.id;
  readonly version = RESONANCE_SOUND_META.version;
  readonly name = RESONANCE_SOUND_META.name;
  readonly description = RESONANCE_SOUND_META.description;
  readonly properties = RESONANCE_SOUND_META.properties;

  private ctx: BaseAudioContext | null = null;
  private program: ResonanceProgram | null = null;
  private timeline: ControlTimeline<ResonanceState> | null = null;
  private bank: AudioWorkletNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private bowTone: BiquadFilterNode | null = null;
  /** Bow noise sources: the current one, plus stopped ones not yet released. */
  private noises: { source: AudioBufferSourceNode; stopAt: number }[] = [];
  private buses: {
    bow: HoldingControlBus;
    damp: HoldingControlBus;
    pan: HoldingControlBus;
  } | null = null;
  private modes: ModeStatics[] = [];
  private statics: {
    width: StaticParam;
    detune: StaticParam;
    bowCutoff: StaticParam;
    level: StaticParam;
    drivePre: StaticParam;
    drivePost: StaticParam;
    cutoff: StaticParam;
    send: StaticParam;
    dry: StaticParam;
  } | null = null;
  private strikes: TriggerLane<StrikeKey> | null = null;
  private resets: TriggerLane<never> | null = null;
  private dip: SeekDipGain | null = null;
  private reverb: Reverb | null = null;
  private nodes: AudioNode[] = [];

  async build(ctx: BaseAudioContext, destination: AudioNode, seed: number): Promise<void> {
    await loadWorklet(ctx, MODAL_WORKLET_URL);
    this.ctx = ctx;
    const program = new ResonanceProgram(ctx.sampleRate);
    this.program = program;
    this.timeline = new ControlTimeline(program, { historySec: 1, maxFastForwardSec: 30 });

    const bank = new AudioWorkletNode(ctx, MODAL_PROCESSOR, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 1,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    });
    this.bank = bank;

    const buses = {
      bow: new HoldingControlBus(ctx, 0),
      damp: new HoldingControlBus(ctx, 0),
      pan: new HoldingControlBus(ctx, 0),
    };
    this.buses = buses;

    // Bowed excitation: seeded white noise, low-passed, scaled by the bow bus. The noise
    // source starts with each window that starts or jumps playback (see `alignNoise`).
    this.noiseBuffer = createNoiseBuffer(ctx, {
      seed: hash32(seed, NOISE_SALT),
      seconds: BOW_NOISE_SEC,
      color: 'white',
      channels: 1,
    });
    const bowTone = ctx.createBiquadFilter();
    bowTone.type = 'lowpass';
    bowTone.Q.value = 0.7;
    this.bowTone = bowTone;
    const bowGain = ctx.createGain();
    bowGain.gain.value = 0;
    buses.bow.connect(bowGain.gain);
    bowTone.connect(bowGain);
    bowGain.connect(bank);
    buses.damp.connect(workletParam(bank, 'damp'));

    const panner = ctx.createStereoPanner();
    buses.pan.connect(panner.pan);
    const dip = new SeekDipGain(ctx);
    this.dip = dip;
    const level = ctx.createGain();
    const drivePre = ctx.createGain();
    const drive = ctx.createWaveShaper();
    drive.curve = driveCurve();
    drive.oversample = 'none';
    const drivePost = ctx.createGain();
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.Q.value = 0.5;
    const dry = ctx.createGain();
    const send = ctx.createGain();
    const out = ctx.createGain();
    const reverb = new Reverb(ctx, {
      seed: hash32(seed, REVERB_SALT),
      decaySec: reverbDecaySeconds(0.5),
      damping: 0.4,
      preDelaySec: 0.015,
    });
    this.reverb = reverb;

    bank.connect(panner);
    panner.connect(dip.node);
    dip.node.connect(level);
    level.connect(drivePre);
    drivePre.connect(drive);
    drive.connect(drivePost);
    drivePost.connect(tone);
    tone.connect(dry);
    dry.connect(out);
    tone.connect(send);
    send.connect(reverb.input);
    reverb.output.connect(out);
    out.connect(destination);

    this.modes = [];
    for (let m = 0; m < MODE_COUNT; m++) {
      this.modes.push({
        freq: new StaticParam(workletParam(bank, `freq${m}`), 0.05),
        decay: new StaticParam(workletParam(bank, `decay${m}`), 0.05),
        gain: new StaticParam(workletParam(bank, `gain${m}`), 0.05),
      });
    }
    this.statics = {
      width: new StaticParam(workletParam(bank, 'width'), 0.08),
      detune: new StaticParam(workletParam(bank, 'detune'), 0.08),
      bowCutoff: new StaticParam(bowTone.frequency, 0.05),
      level: new StaticParam(level.gain, 0.05),
      drivePre: new StaticParam(drivePre.gain, 0.05),
      drivePost: new StaticParam(drivePost.gain, 0.05),
      cutoff: new StaticParam(tone.frequency, 0.05),
      send: new StaticParam(send.gain, 0.08),
      dry: new StaticParam(dry.gain, 0.08),
    };
    this.strikes = new TriggerLane(workletParam(bank, 'strike'), {
      velocity: workletParam(bank, 'velocity'),
      mallet: workletParam(bank, 'mallet'),
      bounce: workletParam(bank, 'bounce'),
      bounceHz: workletParam(bank, 'bounceHz'),
      bounceDecay: workletParam(bank, 'bounceDecay'),
    });
    this.resets = new TriggerLane(workletParam(bank, 'reset'), {});
    this.nodes = [bowTone, bowGain, bank, panner, level, drivePre, drive, drivePost];
    this.nodes.push(tone, dry, send, out);
  }

  schedule(win: ScheduleWindow): void {
    const { ctx, program, timeline, buses } = this;
    if (!ctx || !program || !timeline || !buses) return;
    const params = program.params(win.props);
    let first = false;
    let seek = false;
    timeline.schedule(win, {
      begin: (mode) => {
        first = mode === 'start';
        seek = mode === 'seek';
        this.jumpTo(win, mode);
        this.applyStatics(params, win.ctxTimeAtT0, first);
      },
      point: (ctxTime, s, _t, jump) => {
        // Set outright only on the very first window. After a seek, the buses glide from where
        // they froze while the output is dipped (a resync is a seek without the engine's fade).
        if (seek && seekGlideHolds(ctxTime - win.ctxTimeAtT0)) return;
        const instant = jump && first;
        buses.bow.write(s.bowOut, ctxTime, instant);
        buses.damp.write(s.dampOut, ctxTime, instant);
        buses.pan.write(s.panOut, ctxTime, instant);
      },
      events: (from, to) => win.sampler.onsetsBetween(from, to),
      event: (t, ctxTime) => this.strike(win, params, t, ctxTime),
    });
    this.dip?.prune(ctx.currentTime - 1);
  }

  cancelFrom(ctxTime: number): void {
    this.timeline?.cancelFrom(ctxTime);
    if (this.buses) for (const bus of Object.values(this.buses)) bus.cancelFrom(ctxTime);
    for (const m of this.modes) {
      m.freq.cancelFrom(ctxTime);
      m.decay.cancelFrom(ctxTime);
      m.gain.cancelFrom(ctxTime);
    }
    if (this.statics) for (const p of Object.values(this.statics)) p.cancelFrom(ctxTime);
    this.strikes?.cancelFrom(ctxTime);
    this.resets?.cancelFrom(ctxTime);
  }

  dispose(): void {
    for (const { source } of this.noises) {
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
      source.disconnect();
    }
    this.noises = [];
    // Stop the processor (it returns false from now on), so the node can be released.
    if (this.bank) workletParam(this.bank, 'alive').value = 0;
    if (this.buses) for (const bus of Object.values(this.buses)) bus.dispose();
    for (const node of this.nodes) node.disconnect();
    this.dip?.dispose();
    this.reverb?.dispose();
    this.nodes = [];
    this.modes = [];
    this.statics = null;
    this.strikes = null;
    this.resets = null;
    this.dip = null;
    this.buses = null;
    this.bank = null;
    this.noiseBuffer = null;
    this.bowTone = null;
    this.timeline = null;
    this.program = null;
    this.ctx = null;
  }

  // -------------------------------------------------------------------------------------

  /**
   * Start or jump playback. On the first window (under the engine's fade in, and at composition
   * time 0 in a render) the body is silenced and the noise started at once. After a seek the
   * output dips first, and both happen once it is silent.
   */
  private jumpTo(win: ScheduleWindow, mode: ContinuityMode): void {
    if (mode !== 'start' && mode !== 'seek') return;
    let at = win.ctxTimeAtT0;
    if (mode === 'seek' && this.dip) at = this.dip.dip(at);
    this.resets?.fire(at, {});
    this.alignNoise(at, win.t0 + (at - win.ctxTimeAtT0));
  }

  /**
   * Start the bow noise at context time `at` from the point matching composition time `t`
   * (the looped buffer's position is composition time modulo its length), so a moment of the
   * composition is always bowed by the same noise: in a render, and in preview after any start
   * or seek. It happens only where the output is silent (see `jumpTo`).
   */
  private alignNoise(at: number, t: number): void {
    const { ctx, noiseBuffer, bowTone } = this;
    if (!ctx || !noiseBuffer || !bowTone) return;
    const start = Math.max(0, at);
    for (const old of this.noises) {
      if (old.stopAt > start) {
        try {
          old.source.stop(start);
        } catch {
          // Not started, or already stopped.
        }
        old.stopAt = start;
      }
    }
    // Release sources that stopped well in the past.
    this.noises = this.noises.filter(({ source, stopAt }) => {
      if (stopAt < ctx.currentTime - 1) {
        source.disconnect();
        return false;
      }
      return true;
    });
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
    source.connect(bowTone);
    const offset = ((t % BOW_NOISE_SEC) + BOW_NOISE_SEC) % BOW_NOISE_SEC;
    source.start(start, offset);
    this.noises.push({ source, stopAt: Number.POSITIVE_INFINITY });
  }

  /** Property-only values: set outright on the first window, glided otherwise. */
  private applyStatics(p: ResonanceParams, at: number, instant: boolean): void {
    this.modes.forEach((m, i) => {
      m.freq.apply(p.freqs[i] ?? 0, at, instant);
      m.decay.apply(p.decays[i] ?? 1, at, instant);
      m.gain.apply(p.gains[i] ?? 0, at, instant);
    });
    const s = this.statics;
    if (!s) return;
    s.width.apply(p.width, at, instant);
    s.detune.apply(p.detuneCents, at, instant);
    s.bowCutoff.apply(p.bowCutoffHz, at, instant);
    s.level.apply(p.level, at, instant);
    const drive = driveStageGains(p.drive);
    s.drivePre.apply(drive.pre, at, instant);
    s.drivePost.apply(drive.post, at, instant);
    s.cutoff.apply(p.cutoffHz, at, instant);
    s.send.apply(p.reverbSend, at, instant);
    s.dry.apply(p.dry, at, instant);
    const reverb = this.reverb;
    const ctx = this.ctx;
    if (reverb && ctx) {
      if (instant) reverb.setDecayNow(p.reverbDecaySec, at);
      else reverb.setDecay(p.reverbDecaySec, at, ctx.currentTime);
    }
  }

  /**
   * A strike at an onset: velocity from how suddenly the movement gathers, hardness from the
   * properties, and a pitch bounce in the direction of the movement (up pushes the pitch up).
   */
  private strike(win: ScheduleWindow, p: ResonanceParams, t: number, ctxTime: number): void {
    let surge = 0;
    let up = 0;
    for (const dt of STRIKE_LOOK) {
      const frame = win.sampler.sample(t + dt);
      surge = Math.max(surge, frame.normalized.surge);
      up += upwardFlow(frame);
    }
    const velocity = strikeVelocity(surge);
    const direction = up < 0 ? -1 : 1;
    this.strikes?.fire(ctxTime, {
      velocity,
      mallet: malletSeconds(p.hardness, velocity),
      bounce: direction * p.bounceCents * velocity,
      bounceHz: p.bounceHz,
      bounceDecay: p.bounceDecaySec,
    });
  }
}

export function createResonanceSound(): SoundMaterial {
  return new ResonanceSound();
}
