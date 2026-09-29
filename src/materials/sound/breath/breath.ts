/**
 * A3 Breath sound material (SPEC 9.5): seeded noise through band-pass filters, with optional
 * vowel formants.
 *
 * Graph:
 *
 *   control buses (ConstantSource, automated at the control rate)
 *     shift (cents) ───────► detune of the air bands; half of it to the formants
 *     q scale ─► ×base Q ──► Q of each air layer (bandwidth)
 *     formant q scale ─► ×base Q ─► Q of each formant
 *     amp ─────────────────► VCA gain
 *     pan ─────────────────► both streams' panners
 *
 *   seeded noise (2 decorrelated channels, kept in step with composition time)
 *     ─► split ─► stream A ─► panner (−width) ─┐
 *              └► stream B ─► panner (+width) ─┴─► air
 *   air ─► levels ─► [main band, chest, hiss, whistle, formant 1, 2, 3] (band-pass)
 *   bands, mixed in pairs (bit-identical sums) ─► VCA ─► drive (soft saturation) ─┬─► dry ─► out
 *                                                                              └─► send ─► reverb ─► out
 *
 * Levels, centres and base Qs change only with properties (StaticParams); the movement moves
 * everything through five control buses. After a seek (or a resync of a starved scheduler)
 * the level dips briefly while the band glides to where the composition is, and the noise
 * runs on (see shared/seekDip.ts and shared/timelineNoise.ts).
 */
import { hash32 } from '../../../chance/prng';
import type { ScheduleWindow, SoundMaterial } from '../../types';
import { ControlBus, StaticParam } from '../shared/automation';
import { ControlTimeline, type ContinuityMode } from '../shared/controlTimeline';
import { driveCurve, driveStageGains, mixPairwise, setKRate } from '../shared/graph';
import { createNoiseBuffer } from '../shared/noise';
import { Reverb } from '../shared/reverb';
import { seekDipGain, seekGlideHolds } from '../shared/seekDip';
import { TimelineNoise } from '../shared/timelineNoise';
import { BREATH_SOUND_META } from './meta';
import {
  BAND_COUNT,
  breathVariation,
  FORMANT_1,
  NOISE_SECONDS,
  WHISTLE,
  type BreathParams,
} from './params';
import { BreathProgram, type BreathState } from './program';

const NOISE_SALT = 0x4e; // "N"
const REVERB_SALT = 0x52; // "R"

interface Band {
  filter: BiquadFilterNode;
  frequency: StaticParam;
  /** Base Q: the gain that scales the Q bus into the filter's Q (or the Q itself). */
  q: StaticParam;
  level: StaticParam;
}

class BreathSound implements SoundMaterial {
  readonly id = BREATH_SOUND_META.id;
  readonly version = BREATH_SOUND_META.version;
  readonly name = BREATH_SOUND_META.name;
  readonly description = BREATH_SOUND_META.description;
  readonly properties = BREATH_SOUND_META.properties;

  private program: BreathProgram | null = null;
  private timeline: ControlTimeline<BreathState> | null = null;
  private noise: TimelineNoise | null = null;
  private buses: {
    amp: ControlBus;
    shift: ControlBus;
    q: ControlBus;
    formantQ: ControlBus;
    pan: ControlBus;
  } | null = null;
  private bands: Band[] = [];
  private statics: StaticParam[] = [];
  private out: {
    widthA: StaticParam;
    widthB: StaticParam;
    drivePre: StaticParam;
    drivePost: StaticParam;
    send: StaticParam;
    dry: StaticParam;
  } | null = null;
  private reverb: Reverb | null = null;
  private nodes: AudioNode[] = [];

  build(ctx: BaseAudioContext, destination: AudioNode, seed: number): Promise<void> {
    this.program = new BreathProgram(breathVariation(seed));
    this.timeline = new ControlTimeline(this.program, { historySec: 1, maxFastForwardSec: 30 });

    const buses = {
      amp: new ControlBus(ctx, 0),
      shift: new ControlBus(ctx, 0),
      q: new ControlBus(ctx, 1),
      formantQ: new ControlBus(ctx, 1),
      pan: new ControlBus(ctx, 0),
    };
    this.buses = buses;

    // Two decorrelated streams of seeded pink noise, one per side of the stereo image.
    const noise = new TimelineNoise(
      ctx,
      createNoiseBuffer(ctx, {
        seed: hash32(seed, NOISE_SALT),
        seconds: NOISE_SECONDS,
        color: 'pink',
        channels: 2,
      }),
    );
    this.noise = noise;
    const split = ctx.createChannelSplitter(2);
    const panA = ctx.createStereoPanner();
    const panB = ctx.createStereoPanner();
    setKRate(panA.pan, panB.pan);
    buses.pan.connect(panA.pan);
    buses.pan.connect(panB.pan);
    const air = ctx.createGain();
    noise.output.connect(split);
    split.connect(panA, 0);
    split.connect(panB, 1);
    panA.connect(air);
    panB.connect(air);

    // Half the band's movement for the formants (vowels stay recognisable).
    const halfShift = ctx.createGain();
    halfShift.gain.value = 0.5;
    buses.shift.connect(halfShift);

    this.bands = [];
    const bandOutputs: AudioNode[] = [];
    for (let k = 0; k < BAND_COUNT; k++) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      // The band moves smoothly at the control rate: once per render quantum is plenty,
      // and it spares every filter a coefficient update each sample.
      setKRate(filter.frequency, filter.detune, filter.Q);
      const formant = k >= FORMANT_1;
      (formant ? halfShift : buses.shift.node).connect(filter.detune);
      let q: StaticParam;
      if (k === WHISTLE) {
        q = new StaticParam(filter.Q, 0.05);
      } else {
        // Q = base Q × the bandwidth bus.
        filter.Q.value = 0;
        const qGain = ctx.createGain();
        qGain.gain.value = 0;
        (formant ? buses.formantQ : buses.q).connect(qGain);
        qGain.connect(filter.Q);
        q = new StaticParam(qGain.gain, 0.05);
        this.nodes.push(qGain);
      }
      // The level comes before the filter: a band at level 0 (the whistle and the formants
      // at baseline) then gets silent input, and Chrome stops running its filter.
      const level = ctx.createGain();
      level.gain.value = 0;
      air.connect(level);
      level.connect(filter);
      bandOutputs.push(filter);
      this.bands.push({
        filter,
        frequency: new StaticParam(filter.frequency, 0.05),
        q,
        level: new StaticParam(level.gain, 0.08),
      });
      this.nodes.push(filter, level);
    }
    // Bands meet in pairs, so their sum is bit-identical on every run (see mixPairwise).
    const mix = mixPairwise(ctx, bandOutputs);
    this.nodes.push(...mix.nodes);

    const vca = ctx.createGain();
    vca.gain.value = 0;
    buses.amp.connect(vca.gain);
    const drivePre = ctx.createGain();
    const drive = ctx.createWaveShaper();
    drive.curve = driveCurve();
    // Gentle saturation on noise: oversampling would cost more than it removes.
    drive.oversample = 'none';
    const drivePost = ctx.createGain();
    const dry = ctx.createGain();
    const send = ctx.createGain();
    const out = ctx.createGain();
    // The decay is set by the first schedule window (from Persistence).
    const reverb = new Reverb(ctx, {
      seed: hash32(seed, REVERB_SALT),
      damping: 0.5,
      preDelaySec: 0.015,
    });
    this.reverb = reverb;

    mix.output.connect(vca);
    vca.connect(drivePre);
    drivePre.connect(drive);
    drive.connect(drivePost);
    drivePost.connect(dry);
    dry.connect(out);
    drivePost.connect(send);
    send.connect(reverb.input);
    reverb.output.connect(out);
    out.connect(destination);

    this.out = {
      widthA: new StaticParam(panA.pan, 0.1),
      widthB: new StaticParam(panB.pan, 0.1),
      drivePre: new StaticParam(drivePre.gain, 0.05),
      drivePost: new StaticParam(drivePost.gain, 0.05),
      send: new StaticParam(send.gain, 0.08),
      dry: new StaticParam(dry.gain, 0.08),
    };
    this.statics = [
      ...Object.values(this.out),
      ...this.bands.flatMap((b) => [b.frequency, b.q, b.level]),
    ];
    this.nodes.push(split, panA, panB, air, halfShift, vca, drivePre, drive, drivePost);
    this.nodes.push(dry, send, out);
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
        this.noise?.sync(mode, win.t0, win.ctxTimeAtT0);
        this.applyStatics(params, win.ctxTimeAtT0, mode);
      },
      point: (ctxTime, s, _t, jump) => {
        // Set values outright only on the very first window. After a seek (or a resync),
        // stay silent a little longer while the band glides to where the composition is, so
        // a narrow band can't ring from a leap (see seekDip.ts).
        const instant = jump && first;
        const since = ctxTime - win.ctxTimeAtT0;
        const dip = seek ? seekDipGain(since) : 1;
        if (dip !== null) buses.amp.write(s.amp * dip, ctxTime, instant);
        if (seek && seekGlideHolds(since)) return;
        buses.shift.write(s.shiftCents, ctxTime, instant);
        buses.q.write(s.qScale, ctxTime, instant);
        buses.formantQ.write(s.formantQScale, ctxTime, instant);
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
    this.noise?.cancelFrom(ctxTime);
    if (this.buses) for (const bus of Object.values(this.buses)) bus.cancelFrom(ctxTime);
    for (const p of this.statics) p.cancelFrom(ctxTime);
  }

  dispose(): void {
    this.noise?.dispose();
    if (this.buses) for (const bus of Object.values(this.buses)) bus.dispose();
    for (const node of this.nodes) node.disconnect();
    this.reverb?.dispose();
    this.nodes = [];
    this.bands = [];
    this.statics = [];
    this.buses = null;
    this.out = null;
    this.noise = null;
    this.reverb = null;
    this.timeline = null;
    this.program = null;
  }

  // -------------------------------------------------------------------------------------

  private applyStatics(p: BreathParams, at: number, mode: ContinuityMode): void {
    // Set outright only on the first window; after a seek, glide (a resync can land in the
    // middle of a slider drag, with no engine fade to hide a jump).
    const jump = mode === 'start';
    const out = this.out;
    if (!out) return;
    out.widthA.apply(-p.width, at, jump);
    out.widthB.apply(p.width, at, jump);
    const gains = driveStageGains(p.drive);
    out.drivePre.apply(gains.pre, at, jump);
    out.drivePost.apply(gains.post, at, jump);
    out.send.apply(p.reverbSend, at, jump);
    out.dry.apply(p.dry, at, jump);
    this.bands.forEach((b, k) => {
      b.frequency.apply(p.bandHz[k] ?? 1000, at, jump);
      b.q.apply(p.bandQ[k] ?? 1, at, jump);
      b.level.apply(p.bandGain[k] ?? 0, at, jump);
    });
  }
}

export function createBreathSound(): SoundMaterial {
  return new BreathSound();
}
