/**
 * A5 Pulse sound material (SPEC 9.5): Karplus-Strong plucks (pluck.worklet.js) at the times
 * the control program chooses on the 200 Hz grid.
 *
 * Graph:
 *
 *   pluck strings (worklet; each pluck panned inside) ─► seek dip ─► level ─► drive ─► low-pass
 *                                                  ┌─────────────────────────────────────┘
 *                                                  ├─► dry ─► out
 *                                                  └─► send ─► reverb ─► out
 *
 * Every pluck is a TriggerLane event written at its exact context time (composition time plus
 * the window's offset), so preview and offline render place it identically. The strings are
 * summed inside the worklet in a fixed order and no input here takes more than two sounding
 * sources (see mixPairwise in shared/graph.ts), so renders are bit-identical. Values that
 * change only with properties are StaticParams.
 *
 * After a seek (or the engine's resync of a starved scheduler, which it treats as a seek) the
 * output dips briefly (shared/seekDipGain.ts) inside the engine's own dip: the strings still
 * ringing are silenced under it, and plucks due before that wait for it.
 */
import { hash32 } from '../../../chance/prng';
import type { ScheduleWindow, SoundMaterial } from '../../types';
import { StaticParam, windowOffset } from '../shared/automation';
import { ControlTimeline, type ContinuityMode } from '../shared/controlTimeline';
import { driveCurve, driveStageGains } from '../shared/graph';
import { Reverb } from '../shared/reverb';
import { SeekDipGain } from '../shared/seekDipGain';
import { TriggerLane, workletParam } from '../shared/triggers';
import { loadWorklet } from '../shared/worklets';
import { PULSE_SOUND_META } from './meta';
import { pluckDecaySeconds, type PulseParams } from './params';
import pluckUrl from './pluck.worklet.js?url&no-inline';
import { PulseProgram, plucksToSchedule, type Pluck, type PulseState } from './program';

/** Processor name registered by pluck.worklet.js. */
export const PLUCK_PROCESSOR = 'sp-pluck';
export const PLUCK_WORKLET_URL: string = pluckUrl;

const REVERB_SALT = 0x50554c52; // "PULR"
/**
 * Longest fast-forward on a seek. The pulse clock remembers its phase while the movement goes
 * on, so it gets a longer reach than the default; it rests after any stillness anyway.
 */
const MAX_FAST_FORWARD_SEC = 60;

type PluckKey =
  | 'freq'
  | 'velocity'
  | 'decay'
  | 'tone'
  | 'pan'
  | 'bend'
  | 'bendHz'
  | 'bendDecay'
  | 'attack'
  | 'seed';

const PLUCK_KEYS: readonly PluckKey[] = [
  'freq',
  'velocity',
  'decay',
  'tone',
  'pan',
  'bend',
  'bendHz',
  'bendDecay',
  'attack',
  'seed',
];

class PulseSound implements SoundMaterial {
  readonly id = PULSE_SOUND_META.id;
  readonly version = PULSE_SOUND_META.version;
  readonly name = PULSE_SOUND_META.name;
  readonly description = PULSE_SOUND_META.description;
  readonly properties = PULSE_SOUND_META.properties;

  private ctx: BaseAudioContext | null = null;
  private program: PulseProgram | null = null;
  private timeline: ControlTimeline<PulseState> | null = null;
  private strings: AudioWorkletNode | null = null;
  private statics: {
    level: StaticParam;
    drivePre: StaticParam;
    drivePost: StaticParam;
    cutoff: StaticParam;
    send: StaticParam;
    dry: StaticParam;
  } | null = null;
  private plucks: TriggerLane<PluckKey> | null = null;
  private resets: TriggerLane<never> | null = null;
  private dip: SeekDipGain | null = null;
  private reverb: Reverb | null = null;
  private nodes: AudioNode[] = [];

  async build(ctx: BaseAudioContext, destination: AudioNode, seed: number): Promise<void> {
    await loadWorklet(ctx, PLUCK_WORKLET_URL);
    this.ctx = ctx;
    const program = new PulseProgram(seed);
    this.program = program;
    this.timeline = new ControlTimeline(program, {
      historySec: 1,
      maxFastForwardSec: MAX_FAST_FORWARD_SEC,
    });

    const strings = new AudioWorkletNode(ctx, PLUCK_PROCESSOR, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    this.strings = strings;
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
    // No decay here: the first schedule window loads it at once (setDecayNow), so an
    // offline render never waits on a background rebuild (see shared/reverb.ts).
    const reverb = new Reverb(ctx, {
      seed: hash32(seed, REVERB_SALT),
      damping: 0.5,
      preDelaySec: 0.01,
    });
    this.reverb = reverb;

    strings.connect(dip.node);
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

    this.statics = {
      level: new StaticParam(level.gain, 0.05),
      drivePre: new StaticParam(drivePre.gain, 0.05),
      drivePost: new StaticParam(drivePost.gain, 0.05),
      cutoff: new StaticParam(tone.frequency, 0.05),
      send: new StaticParam(send.gain, 0.08),
      dry: new StaticParam(dry.gain, 0.08),
    };
    const values = {} as Record<PluckKey, AudioParam>;
    for (const key of PLUCK_KEYS) values[key] = workletParam(strings, key);
    this.plucks = new TriggerLane(workletParam(strings, 'trigger'), values);
    this.resets = new TriggerLane(workletParam(strings, 'reset'), {});
    this.nodes = [strings, level, drivePre, drive, drivePost, tone, dry, send, out];
  }

  schedule(win: ScheduleWindow): void {
    const { ctx, program, timeline } = this;
    if (!ctx || !program || !timeline) return;
    const params = program.params(win.props);
    program.onsets = win.sampler;
    const offset = windowOffset(win);
    let continued = true;
    let firstPoint = true;
    /** Where this window silences the strings (−∞ if it doesn't). */
    let resetAt = Number.NEGATIVE_INFINITY;
    timeline.schedule(win, {
      begin: (mode) => {
        continued = mode === 'continue';
        resetAt = this.jumpTo(win.ctxTimeAtT0, mode);
        this.applyStatics(params, win.ctxTimeAtT0, mode === 'start');
      },
      point: (_ctxTime, s) => {
        if (s.count > 0) {
          for (const pluck of plucksToSchedule(s, firstPoint, continued, win.t0)) {
            // After a seek the strings are silenced a few milliseconds after the jump, once
            // the dip has made the output silent. A pluck due before that would be faded out
            // with them (28–70 dB quieter than the render), so it waits for the reset: still
            // in silence, a few ms late. The worklet applies a reset before a pluck at the
            // same sample. A start or a render resets at the window's first moment: unchanged.
            this.pluck(params, pluck, Math.max(pluck.t + offset, resetAt));
          }
        }
        firstPoint = false;
      },
    });
    this.dip?.prune(ctx.currentTime - 1);
  }

  cancelFrom(ctxTime: number): void {
    this.timeline?.cancelFrom(ctxTime);
    if (this.statics) for (const p of Object.values(this.statics)) p.cancelFrom(ctxTime);
    this.plucks?.cancelFrom(ctxTime);
    this.resets?.cancelFrom(ctxTime);
  }

  dispose(): void {
    // Stop the processor (it returns false from now on), so the node can be released.
    if (this.strings) workletParam(this.strings, 'alive').value = 0;
    for (const node of this.nodes) node.disconnect();
    this.dip?.dispose();
    this.reverb?.dispose();
    this.nodes = [];
    this.statics = null;
    this.plucks = null;
    this.resets = null;
    this.dip = null;
    this.strings = null;
    this.timeline = null;
    this.program = null;
    this.ctx = null;
  }

  // -------------------------------------------------------------------------------------

  /**
   * Start or jump playback: silence the strings still ringing. On the first window that is
   * under the engine's fade in (and at composition time 0 in a render); after a seek the
   * output dips first and the strings are silenced once it is quiet. Returns the context time
   * of the reset (−∞ when the window carries on).
   */
  private jumpTo(ctxTimeAtT0: number, mode: ContinuityMode): number {
    if (mode !== 'start' && mode !== 'seek') return Number.NEGATIVE_INFINITY;
    let at = ctxTimeAtT0;
    if (mode === 'seek' && this.dip) at = this.dip.dip(at);
    this.resets?.fire(at, {});
    return at;
  }

  /** Property-only values: set outright on the first window, glided otherwise. */
  private applyStatics(p: PulseParams, at: number, instant: boolean): void {
    const s = this.statics;
    if (!s) return;
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

  private pluck(p: PulseParams, pluck: Pluck, ctxTime: number): void {
    this.plucks?.fire(ctxTime, {
      freq: pluck.freq,
      velocity: pluck.velocity,
      decay: pluckDecaySeconds(p, pluck.freq),
      // Accents (onsets) are plucked a little harder and brighter.
      tone: Math.min(1, p.tone + (pluck.accent ? 0.1 : 0)),
      pan: pluck.pan,
      bend: p.bendSt * pluck.velocity,
      bendHz: p.bendHz,
      bendDecay: p.bendDecaySec,
      attack: p.attackSec,
      seed: pluck.seed,
    });
  }
}

export function createPulseSound(): SoundMaterial {
  return new PulseSound();
}
