/**
 * A5 Pulse sound material (SPEC 9.5): Karplus-Strong plucks (pluck.worklet.js) at the times
 * the control program chooses on the 200 Hz grid.
 *
 * Graph:
 *
 *   pluck strings (worklet; each pluck panned inside) ─► level ─► drive ─► low-pass ─┬─► dry ─► out
 *                                                                                     └─► send ─► reverb ─► out
 *
 * Every pluck is a TriggerLane event written at its exact context time (composition time plus
 * the window's offset), so preview and offline render place it identically and offline renders
 * are bit-identical. Values that change only with properties are StaticParams.
 */
import { hash32 } from '../../../chance/prng';
import type { ScheduleWindow, SoundMaterial } from '../../types';
import { StaticParam, windowOffset } from '../shared/automation';
import { ControlTimeline, type ContinuityMode } from '../shared/controlTimeline';
import { reverbDecaySeconds } from '../shared/mapping';
import { Reverb } from '../shared/reverb';
import { TriggerLane, workletParam } from '../shared/triggers';
import { loadWorklet } from '../shared/worklets';
import { PULSE_SOUND_META } from './meta';
import { pluckDecaySeconds, type PulseParams } from './params';
import pluckUrl from './pluck.worklet.js?url&no-inline';
import { PulseProgram, plucksToSchedule, type Pluck, type PulseState } from './program';

/** Processor name registered by pluck.worklet.js. */
export const PLUCK_PROCESSOR = 'sp-pluck';
export const PLUCK_WORKLET_URL: string = pluckUrl;

/** Curve for the drive stage: tanh over ±DRIVE_HEADROOM (as Water). */
const DRIVE_HEADROOM = 4;
const DRIVE_CURVE_SIZE = 2049;
const REVERB_SALT = 0x50554c52; // "PULR"
/**
 * Longest fast-forward on a seek. The pulse clock remembers its phase while the movement goes
 * on, so it gets a longer reach than the default; it rests after any stillness anyway.
 */
const MAX_FAST_FORWARD_SEC = 60;

function driveCurve(): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(DRIVE_CURVE_SIZE);
  const half = (DRIVE_CURVE_SIZE - 1) / 2;
  for (let i = 0; i < DRIVE_CURVE_SIZE; i++) {
    curve[i] = Math.tanh(((i - half) / half) * DRIVE_HEADROOM);
  }
  return curve;
}

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
      damping: 0.5,
      preDelaySec: 0.01,
    });
    this.reverb = reverb;

    strings.connect(level);
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
    const { program, timeline } = this;
    if (!program || !timeline) return;
    const params = program.params(win.props);
    program.onsets = win.sampler;
    const offset = windowOffset(win);
    let continued = true;
    let firstPoint = true;
    timeline.schedule(win, {
      begin: (mode) => {
        continued = mode === 'continue';
        this.applyStatics(params, win.ctxTimeAtT0, mode);
      },
      point: (_ctxTime, s) => {
        if (s.count > 0) {
          for (const pluck of plucksToSchedule(s, firstPoint, continued, win.t0)) {
            this.pluck(params, pluck, pluck.t + offset);
          }
        }
        firstPoint = false;
      },
    });
  }

  cancelFrom(ctxTime: number): void {
    this.timeline?.cancelFrom(ctxTime);
    if (this.statics) for (const p of Object.values(this.statics)) p.cancelFrom(ctxTime);
    this.plucks?.cancelFrom(ctxTime);
    this.resets?.cancelFrom(ctxTime);
  }

  dispose(): void {
    this.strings?.port.postMessage('dispose');
    for (const node of this.nodes) node.disconnect();
    this.reverb?.dispose();
    this.nodes = [];
    this.statics = null;
    this.plucks = null;
    this.resets = null;
    this.strings = null;
    this.timeline = null;
    this.program = null;
    this.ctx = null;
  }

  // -------------------------------------------------------------------------------------

  private applyStatics(p: PulseParams, at: number, mode: ContinuityMode): void {
    const jump = mode === 'start' || mode === 'seek';
    // Playback starts or jumps under the engine's fade: silence the strings still ringing.
    if (jump) this.resets?.fire(at, {});
    const s = this.statics;
    if (!s) return;
    s.level.apply(p.level, at, jump);
    // Drive: pre-gain k/H into tanh(H·u), post-gain 1/tanh(k): unity as k → 0, louder and
    // more saturated as Intensity raises k.
    s.drivePre.apply(p.drive / DRIVE_HEADROOM, at, jump);
    s.drivePost.apply(1 / Math.tanh(p.drive), at, jump);
    s.cutoff.apply(p.cutoffHz, at, jump);
    s.send.apply(p.reverbSend, at, jump);
    s.dry.apply(p.dry, at, jump);
    const reverb = this.reverb;
    const ctx = this.ctx;
    if (reverb && ctx) {
      if (jump) reverb.setDecayNow(p.reverbDecaySec, at);
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
