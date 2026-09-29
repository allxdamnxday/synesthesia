/**
 * A2 Honey sound material (SPEC 9.5): a low saw/triangle hum through a resonant low-pass,
 * broken into "roo" syllables by a smooth-square stutter in its level.
 *
 * Graph:
 *
 *   control buses (ConstantSource, automated at the control rate)
 *     pitch (cents) ──► every oscillator's detune
 *     amp ────────────► VCA gain (envelope × stutter × "B" closures, from the program)
 *     cutoff (cents) ─► both low-pass filters' detune
 *     pan ────────────► every voice's panner
 *
 *   voice k:  saw ─► saw mix ─┐
 *             tri ─► tri mix ─┴─► level ─► panner ─┐
 *   voices, mixed in pairs (bit-identical sums) ◄───┘
 *
 *   voices ─► VCA ─► drive (soft saturation) ─► resonant low-pass ─► low-pass ─┬─► dry ─► out
 *                                                                             └─► send ─► reverb ─► out
 *
 * The stutter runs in the control program rather than in an oscillator, so preview and
 * render stutter at exactly the same moments and a loop wrap never restarts it. Values that
 * change only with properties (detune, levels, mix, cutoff, resonance, drive, reverb) are
 * StaticParams. After a seek (or a resync of a starved scheduler) the level dips briefly while
 * pitch and filter glide to where the composition is (see shared/seekDip.ts).
 */
import { hash32 } from '../../../chance/prng';
import type { ScheduleWindow, SoundMaterial } from '../../types';
import { ControlBus, StaticParam } from '../shared/automation';
import { ControlTimeline, type ContinuityMode } from '../shared/controlTimeline';
import { driveCurve, driveStageGains, mixPairwise, setKRate } from '../shared/graph';
import { Reverb } from '../shared/reverb';
import { seekDipGain, seekGlideHolds } from '../shared/seekDip';
import { HONEY_SOUND_META } from './meta';
import {
  HONEY_BASE_HZ,
  honeyVariation,
  SECOND_POLE_RATIO,
  VOICE_COUNT,
  VOICE_RATIOS,
  type HoneyParams,
} from './params';
import { HoneyProgram, type HoneyState } from './program';

/** Q of the second, gentle low-pass (the first carries Elasticity's resonance). */
const SECOND_POLE_Q = 0.6;
const REVERB_SALT = 0x48; // "H"

interface Voice {
  saw: OscillatorNode;
  tri: OscillatorNode;
  sawDetune: StaticParam;
  triDetune: StaticParam;
  sawMix: StaticParam;
  triMix: StaticParam;
  level: StaticParam;
  pan: StaticParam;
}

class HoneySound implements SoundMaterial {
  readonly id = HONEY_SOUND_META.id;
  readonly version = HONEY_SOUND_META.version;
  readonly name = HONEY_SOUND_META.name;
  readonly description = HONEY_SOUND_META.description;
  readonly properties = HONEY_SOUND_META.properties;

  private program: HoneyProgram | null = null;
  private timeline: ControlTimeline<HoneyState> | null = null;
  private buses: {
    pitch: ControlBus;
    amp: ControlBus;
    cutoff: ControlBus;
    pan: ControlBus;
  } | null = null;
  private voices: Voice[] = [];
  private statics: StaticParam[] = [];
  private out: {
    drivePre: StaticParam;
    drivePost: StaticParam;
    cutoff1: StaticParam;
    cutoff2: StaticParam;
    resonance: StaticParam;
    send: StaticParam;
    dry: StaticParam;
  } | null = null;
  private reverb: Reverb | null = null;
  private nodes: AudioNode[] = [];

  build(ctx: BaseAudioContext, destination: AudioNode, seed: number): Promise<void> {
    const variation = honeyVariation(seed);
    this.program = new HoneyProgram(variation);
    this.timeline = new ControlTimeline(this.program, { historySec: 1, maxFastForwardSec: 30 });

    const buses = {
      pitch: new ControlBus(ctx, 0),
      amp: new ControlBus(ctx, 0),
      cutoff: new ControlBus(ctx, 0),
      pan: new ControlBus(ctx, 0),
    };
    this.buses = buses;

    const vca = ctx.createGain();
    vca.gain.value = 0;
    buses.amp.connect(vca.gain);
    const drivePre = ctx.createGain();
    const drive = ctx.createWaveShaper();
    drive.curve = driveCurve();
    // Gentle saturation on a low hum: oversampling would cost more than it removes.
    drive.oversample = 'none';
    const drivePost = ctx.createGain();
    const lp1 = ctx.createBiquadFilter();
    lp1.type = 'lowpass';
    const lp2 = ctx.createBiquadFilter();
    lp2.type = 'lowpass';
    lp2.Q.value = SECOND_POLE_Q;
    // The cutoff moves smoothly at the control rate: once per render quantum is plenty, and
    // it spares the filters a coefficient update every sample.
    setKRate(lp1.frequency, lp1.detune, lp1.Q, lp2.frequency, lp2.detune);
    buses.cutoff.connect(lp1.detune);
    buses.cutoff.connect(lp2.detune);
    const dry = ctx.createGain();
    const send = ctx.createGain();
    const out = ctx.createGain();
    // The decay is set by the first schedule window (from Persistence).
    const reverb = new Reverb(ctx, {
      seed: hash32(seed, REVERB_SALT),
      damping: 0.6,
      preDelaySec: 0.02,
    });
    this.reverb = reverb;

    vca.connect(drivePre);
    drivePre.connect(drive);
    drive.connect(drivePost);
    drivePost.connect(lp1);
    lp1.connect(lp2);
    lp2.connect(dry);
    dry.connect(out);
    lp2.connect(send);
    send.connect(reverb.input);
    reverb.output.connect(out);
    out.connect(destination);

    this.out = {
      drivePre: new StaticParam(drivePre.gain, 0.05),
      drivePost: new StaticParam(drivePost.gain, 0.05),
      cutoff1: new StaticParam(lp1.frequency, 0.05),
      cutoff2: new StaticParam(lp2.frequency, 0.05),
      resonance: new StaticParam(lp1.Q, 0.05),
      send: new StaticParam(send.gain, 0.08),
      dry: new StaticParam(dry.gain, 0.08),
    };

    this.voices = [];
    const voiceOutputs: AudioNode[] = [];
    for (let i = 0; i < VOICE_COUNT; i++) {
      // The base frequency never changes: set it once. The pitch bus moves it in cents.
      const hz = HONEY_BASE_HZ * (VOICE_RATIOS[i] ?? 1);
      const saw = ctx.createOscillator();
      saw.type = 'sawtooth';
      saw.frequency.value = hz;
      const tri = ctx.createOscillator();
      tri.type = 'triangle';
      tri.frequency.value = hz;
      const sawGain = ctx.createGain();
      const triGain = ctx.createGain();
      const level = ctx.createGain();
      level.gain.value = 0;
      const panner = ctx.createStereoPanner();
      // Pitch and pan move smoothly at the control rate: once per render quantum (2.7 ms)
      // is plenty and saves a per-sample exp2 / sin-cos for every oscillator.
      setKRate(saw.frequency, saw.detune, tri.frequency, tri.detune, panner.pan);
      buses.pitch.connect(saw.detune);
      buses.pitch.connect(tri.detune);
      buses.pan.connect(panner.pan);
      saw.connect(sawGain);
      tri.connect(triGain);
      sawGain.connect(level);
      triGain.connect(level);
      level.connect(panner);
      voiceOutputs.push(panner);
      saw.start();
      tri.start();
      this.voices.push({
        saw,
        tri,
        sawDetune: new StaticParam(saw.detune, 0.1),
        triDetune: new StaticParam(tri.detune, 0.1),
        sawMix: new StaticParam(sawGain.gain, 0.08),
        triMix: new StaticParam(triGain.gain, 0.08),
        level: new StaticParam(level.gain, 0.08),
        pan: new StaticParam(panner.pan, 0.1),
      });
      this.nodes.push(saw, tri, sawGain, triGain, level, panner);
    }
    // Voices meet in pairs, so their sum is bit-identical on every run (see mixPairwise).
    const sum = mixPairwise(ctx, voiceOutputs);
    sum.output.connect(vca);
    this.nodes.push(...sum.nodes);
    this.statics = [
      ...Object.values(this.out),
      ...this.voices.flatMap((v) => [v.sawDetune, v.triDetune, v.sawMix, v.triMix, v.level, v.pan]),
    ];
    this.nodes.push(vca, drivePre, drive, drivePost, lp1, lp2, dry, send, out);
    return Promise.resolve();
  }

  schedule(win: ScheduleWindow): void {
    const { program, timeline, buses } = this;
    if (!program || !timeline || !buses) return;
    const params = program.params(win.props);
    let first = false;
    let seek = false;
    timeline.schedule(win, {
      begin: (mode) => {
        first = mode === 'start';
        seek = mode === 'seek';
        this.applyStatics(params, win.ctxTimeAtT0, mode);
      },
      point: (ctxTime, s, _t, jump) => {
        // Set values outright only on the very first window. After a seek (or a resync),
        // stay silent a little longer while pitch and filter glide to where the composition
        // is, so the resonant filter can't ring from a leap (see seekDip.ts).
        const instant = jump && first;
        const since = ctxTime - win.ctxTimeAtT0;
        const dip = seek ? seekDipGain(since) : 1;
        if (dip !== null) buses.amp.write(s.amp * dip, ctxTime, instant);
        if (seek && seekGlideHolds(since)) return;
        buses.pitch.write(s.pitchCents, ctxTime, instant);
        buses.cutoff.write(s.cutoffCents, ctxTime, instant);
        buses.pan.write(s.panOut, ctxTime, instant);
      },
    });
    // After the window's automation: a new impulse response can take a while to build.
    const reverb = this.reverb;
    if (reverb) {
      if (first) reverb.setDecayNow(params.reverbDecaySec, win.ctxTimeAtT0);
      else reverb.setDecay(params.reverbDecaySec, win.ctxTimeAtT0);
    }
  }

  cancelFrom(ctxTime: number): void {
    this.timeline?.cancelFrom(ctxTime);
    if (this.buses) for (const bus of Object.values(this.buses)) bus.cancelFrom(ctxTime);
    for (const p of this.statics) p.cancelFrom(ctxTime);
  }

  dispose(): void {
    if (this.buses) for (const bus of Object.values(this.buses)) bus.dispose();
    for (const v of this.voices) {
      v.saw.stop();
      v.tri.stop();
    }
    for (const node of this.nodes) node.disconnect();
    this.reverb?.dispose();
    this.nodes = [];
    this.voices = [];
    this.statics = [];
    this.buses = null;
    this.out = null;
    this.reverb = null;
    this.timeline = null;
    this.program = null;
  }

  // -------------------------------------------------------------------------------------

  private applyStatics(p: HoneyParams, at: number, mode: ContinuityMode): void {
    // Set outright only on the first window; after a seek, glide (a resync can land in the
    // middle of a slider drag, with no engine fade to hide a jump).
    const jump = mode === 'start';
    const out = this.out;
    if (!out) return;
    const gains = driveStageGains(p.drive);
    out.drivePre.apply(gains.pre, at, jump);
    out.drivePost.apply(gains.post, at, jump);
    out.cutoff1.apply(p.cutoffHz, at, jump);
    out.cutoff2.apply(p.cutoffHz * SECOND_POLE_RATIO, at, jump);
    out.resonance.apply(p.resonance, at, jump);
    out.send.apply(p.reverbSend, at, jump);
    out.dry.apply(p.dry, at, jump);
    this.voices.forEach((v, i) => {
      v.sawDetune.apply(p.voiceDetune[i] ?? 0, at, jump);
      v.triDetune.apply(p.voiceDetune[i] ?? 0, at, jump);
      v.sawMix.apply(p.sawMix, at, jump);
      v.triMix.apply(p.triMix, at, jump);
      v.level.apply(p.voiceLevels[i] ?? 0, at, jump);
      v.pan.apply(p.voicePan[i] ?? 0, at, jump);
    });
  }
}

export function createHoneySound(): SoundMaterial {
  return new HoneySound();
}
