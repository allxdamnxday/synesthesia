/**
 * A1 Water sound material (SPEC 9.5): 1–3 sine/FM voices.
 *
 * Graph:
 *
 *   control buses (ConstantSource, automated at the control rate)
 *     pitch (cents) ──► every carrier's and modulator's detune
 *     deviation (Hz) ─► every FM depth gain      modulator ─► depth ─► carrier.frequency
 *     pan ──────────► every voice's panner
 *     amp ──────────► VCA gain                   flutter LFO ─► depth(flutter bus) ─► AM gain
 *
 *   voices ─► sum ─► VCA ─► AM ─► drive (soft saturation) ─► low-pass ─┬─► dry ─► out
 *   droplets (one short rising sine per onset) ─► drive                └─► send ─► reverb ─► out
 *
 * Everything that changes per grid point goes through five control buses, so a window
 * writes five automation curves whatever the voice count. Values that change only with
 * properties (base pitch, detune, levels, cutoff, drive, reverb) are StaticParams.
 */
import { hash32 } from '../../../chance/prng';
import type { ScheduleWindow, SoundMaterial } from '../../types';
import { ControlBus, StaticParam } from '../shared/automation';
import { ControlTimeline, type ContinuityMode } from '../shared/controlTimeline';
import { Reverb } from '../shared/reverb';
import { reverbDecaySeconds } from '../shared/mapping';
import { WATER_SOUND_META } from './meta';
import { MOD_RATIO, VOICE_COUNT, waterVariation, type WaterParams } from './params';
import { BASE_GLIDE_SEC, WaterProgram, type WaterState } from './program';

/** Curve for the drive stage: tanh over ±DRIVE_HEADROOM (see `applyDrive`). */
const DRIVE_HEADROOM = 4;
const DRIVE_CURVE_SIZE = 2049;

function driveCurve(): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(DRIVE_CURVE_SIZE);
  const half = (DRIVE_CURVE_SIZE - 1) / 2;
  for (let i = 0; i < DRIVE_CURVE_SIZE; i++) {
    curve[i] = Math.tanh(((i - half) / half) * DRIVE_HEADROOM);
  }
  return curve;
}

/** Switch parameters to one value per render quantum where the browser allows it. */
function setKRate(...params: AudioParam[]): void {
  for (const param of params) {
    try {
      param.automationRate = 'k-rate';
    } catch {
      // Some engines fix the rate; a-rate is only slower, never wrong.
    }
  }
}

interface Voice {
  carrier: OscillatorNode;
  modulator: OscillatorNode;
  depth: GainNode;
  level: GainNode;
  panner: StereoPannerNode;
  carrierFreq: StaticParam;
  modFreq: StaticParam;
  carrierDetune: StaticParam;
  modDetune: StaticParam;
  levelParam: StaticParam;
  panParam: StaticParam;
}

interface Droplet {
  start: number;
  osc: OscillatorNode;
  gain: GainNode;
  panner: StereoPannerNode;
}

const DROPLET_SALT = 0x44524f50; // "DROP"

class WaterSound implements SoundMaterial {
  readonly id = WATER_SOUND_META.id;
  readonly version = WATER_SOUND_META.version;
  readonly name = WATER_SOUND_META.name;
  readonly description = WATER_SOUND_META.description;
  readonly properties = WATER_SOUND_META.properties;

  private ctx: BaseAudioContext | null = null;
  private seed = 0;
  private program: WaterProgram | null = null;
  private timeline: ControlTimeline<WaterState> | null = null;
  private buses: {
    pitch: ControlBus;
    amp: ControlBus;
    deviation: ControlBus;
    flutter: ControlBus;
    pan: ControlBus;
  } | null = null;
  private voices: Voice[] = [];
  private statics: StaticParam[] = [];
  private staticsOut: {
    drivePre: StaticParam;
    drivePost: StaticParam;
    cutoff: StaticParam;
    send: StaticParam;
    dry: StaticParam;
  } | null = null;
  private lfo: OscillatorNode | null = null;
  private dropletBus: GainNode | null = null;
  private reverb: Reverb | null = null;
  private nodes: AudioNode[] = [];
  private droplets: Droplet[] = [];

  build(ctx: BaseAudioContext, destination: AudioNode, seed: number): Promise<void> {
    this.ctx = ctx;
    this.seed = seed;
    const variation = waterVariation(seed);
    this.program = new WaterProgram(variation);
    this.timeline = new ControlTimeline(this.program, { historySec: 1, maxFastForwardSec: 30 });

    const buses = {
      pitch: new ControlBus(ctx, 0),
      amp: new ControlBus(ctx, 0),
      deviation: new ControlBus(ctx, 0),
      flutter: new ControlBus(ctx, 0),
      pan: new ControlBus(ctx, 0),
    };
    this.buses = buses;

    const sum = ctx.createGain();
    const vca = ctx.createGain();
    vca.gain.value = 0;
    buses.amp.connect(vca.gain);
    const am = ctx.createGain();
    am.gain.value = 1;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = variation.flutterHz;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0;
    buses.flutter.connect(lfoDepth.gain);
    lfo.connect(lfoDepth);
    lfoDepth.connect(am.gain);
    lfo.start();
    this.lfo = lfo;

    const drivePre = ctx.createGain();
    const drive = ctx.createWaveShaper();
    drive.curve = driveCurve();
    // Gentle saturation: oversampling would cost more than the little aliasing it removes.
    drive.oversample = 'none';
    const drivePost = ctx.createGain();
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.Q.value = 0.5;
    const dry = ctx.createGain();
    const send = ctx.createGain();
    const out = ctx.createGain();
    const reverb = new Reverb(ctx, {
      seed: hash32(seed, 0x57),
      decaySec: reverbDecaySeconds(0.5),
      damping: 0.45,
      preDelaySec: 0.012,
    });
    this.reverb = reverb;
    const dropletBus = ctx.createGain();
    this.dropletBus = dropletBus;

    sum.connect(vca);
    vca.connect(am);
    am.connect(drivePre);
    dropletBus.connect(drivePre);
    drivePre.connect(drive);
    drive.connect(drivePost);
    drivePost.connect(tone);
    tone.connect(dry);
    dry.connect(out);
    tone.connect(send);
    send.connect(reverb.input);
    reverb.output.connect(out);
    out.connect(destination);

    this.staticsOut = {
      drivePre: new StaticParam(drivePre.gain, 0.05),
      drivePost: new StaticParam(drivePost.gain, 0.05),
      cutoff: new StaticParam(tone.frequency, 0.05),
      send: new StaticParam(send.gain, 0.08),
      dry: new StaticParam(dry.gain, 0.08),
    };

    this.voices = [];
    for (let i = 0; i < VOICE_COUNT; i++) {
      const modulator = ctx.createOscillator();
      const carrier = ctx.createOscillator();
      const depth = ctx.createGain();
      depth.gain.value = 0;
      const level = ctx.createGain();
      level.gain.value = 0;
      const panner = ctx.createStereoPanner();
      // Pitch and pan move smoothly at the control rate, so once per render quantum
      // (2.7 ms) is plenty and saves a per-sample exp2 / sin-cos for every voice. The
      // carrier's frequency stays a-rate: it carries the audio-rate FM.
      setKRate(modulator.frequency, modulator.detune, carrier.detune, panner.pan);
      buses.pitch.connect(modulator.detune);
      buses.pitch.connect(carrier.detune);
      buses.deviation.connect(depth.gain);
      buses.pan.connect(panner.pan);
      modulator.connect(depth);
      depth.connect(carrier.frequency);
      carrier.connect(level);
      level.connect(panner);
      panner.connect(sum);
      modulator.start();
      carrier.start();
      this.voices.push({
        carrier,
        modulator,
        depth,
        level,
        panner,
        carrierFreq: new StaticParam(carrier.frequency, BASE_GLIDE_SEC),
        modFreq: new StaticParam(modulator.frequency, BASE_GLIDE_SEC),
        carrierDetune: new StaticParam(carrier.detune, 0.1),
        modDetune: new StaticParam(modulator.detune, 0.1),
        levelParam: new StaticParam(level.gain, 0.08),
        panParam: new StaticParam(panner.pan, 0.1),
      });
      this.nodes.push(modulator, carrier, depth, level, panner);
    }
    this.statics = [
      ...Object.values(this.staticsOut),
      ...this.voices.flatMap((v) => [
        v.carrierFreq,
        v.modFreq,
        v.carrierDetune,
        v.modDetune,
        v.levelParam,
        v.panParam,
      ]),
    ];
    this.nodes.push(sum, vca, am, lfo, lfoDepth, drivePre, drive, drivePost, tone, dry, send);
    this.nodes.push(out, dropletBus);
    return Promise.resolve();
  }

  schedule(win: ScheduleWindow): void {
    const { ctx, program, timeline, buses } = this;
    if (!ctx || !program || !timeline || !buses) return;
    const params = program.params(win.props);
    timeline.schedule(win, {
      begin: (mode) => this.applyStatics(params, win.ctxTimeAtT0, mode),
      point: (ctxTime, s, _t, jump) => {
        buses.pitch.write(s.pitchCents, ctxTime, jump);
        buses.amp.write(s.amp, ctxTime, jump);
        buses.deviation.write(s.deviation, ctxTime, jump);
        buses.flutter.write(s.flutterDepth, ctxTime, jump);
        buses.pan.write(s.panOut, ctxTime, jump);
      },
      events: (from, to) => win.sampler.onsetsBetween(from, to),
      event: (t, ctxTime, s) => this.droplet(win, params, t, ctxTime, s),
    });
    this.pruneDroplets(ctx.currentTime);
  }

  cancelFrom(ctxTime: number): void {
    this.timeline?.cancelFrom(ctxTime);
    if (this.buses) for (const bus of Object.values(this.buses)) bus.cancelFrom(ctxTime);
    for (const p of this.statics) p.cancelFrom(ctxTime);
    const keep: Droplet[] = [];
    for (const d of this.droplets) {
      if (d.start >= ctxTime - 1e-9) this.releaseDroplet(d);
      else keep.push(d);
    }
    this.droplets = keep;
  }

  dispose(): void {
    for (const d of this.droplets) this.releaseDroplet(d);
    this.droplets = [];
    if (this.buses) for (const bus of Object.values(this.buses)) bus.dispose();
    for (const v of this.voices) {
      v.carrier.stop();
      v.modulator.stop();
    }
    this.lfo?.stop();
    for (const node of this.nodes) node.disconnect();
    this.reverb?.dispose();
    this.nodes = [];
    this.voices = [];
    this.statics = [];
    this.buses = null;
    this.timeline = null;
    this.program = null;
    this.ctx = null;
  }

  // -------------------------------------------------------------------------------------

  private applyStatics(p: WaterParams, at: number, mode: ContinuityMode): void {
    const jump = mode === 'start' || mode === 'seek';
    const out = this.staticsOut;
    if (!out) return;
    // Drive: pre-gain k/H into tanh(H·u), post-gain 1/tanh(k): unity at k → 0, louder and
    // more saturated as Intensity raises k.
    out.drivePre.apply(p.drive / DRIVE_HEADROOM, at, jump);
    out.drivePost.apply(1 / Math.tanh(p.drive), at, jump);
    out.cutoff.apply(p.cutoffHz, at, jump);
    out.send.apply(p.reverbSend, at, jump);
    out.dry.apply(p.dry, at, jump);
    this.voices.forEach((v, i) => {
      v.carrierFreq.apply(p.baseHz, at, jump);
      v.modFreq.apply(p.baseHz * MOD_RATIO, at, jump);
      v.carrierDetune.apply(p.voiceDetune[i] ?? 0, at, jump);
      v.modDetune.apply(p.voiceDetune[i] ?? 0, at, jump);
      v.levelParam.apply(p.voiceLevels[i] ?? 0, at, jump);
      v.panParam.apply(p.voicePan[i] ?? 0, at, jump);
    });
    const reverb = this.reverb;
    const ctx = this.ctx;
    if (reverb && ctx) {
      if (jump) reverb.setDecayNow(p.reverbDecaySec, at);
      else reverb.setDecay(p.reverbDecaySec, at, ctx.currentTime);
    }
  }

  /** A droplet: a short sine that rises quickly (a bubble), marking an onset. */
  private droplet(
    win: ScheduleWindow,
    p: WaterParams,
    t: number,
    ctxTime: number,
    s: WaterState,
  ): void {
    const ctx = this.ctx;
    const bus = this.dropletBus;
    if (!ctx || !bus) return;
    const frame = win.sampler.sample(t);
    const strength = Math.min(1, 0.4 + 0.6 * Math.max(0, frame.normalized.surge));
    const level = p.level * p.dropletLevel * strength;
    if (!(level > 1e-4)) return;
    // Seeded detail per onset, keyed by its time (same in preview and offline).
    const jitter = (hash32(this.seed, DROPLET_SALT, Math.round(t * 1000)) / 4294967296) * 2 - 1;
    const pitchSt = s.pitchCents / 100 + 12 + jitter;
    const f0 = p.baseHz * Math.pow(2, pitchSt / 12);
    const f1 = f0 * Math.pow(2, p.dropletRiseSt / 12);
    const attack = 0.0015;
    const end = ctxTime + attack + p.dropletDecaySec * 9;

    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(f0, ctxTime);
    osc.frequency.exponentialRampToValueAtTime(f1, ctxTime + p.dropletRiseSec);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setValueAtTime(0, ctxTime);
    gain.gain.linearRampToValueAtTime(level, ctxTime + attack);
    gain.gain.setTargetAtTime(0, ctxTime + attack, p.dropletDecaySec);
    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(
      Math.max(-1, Math.min(1, s.panOut + 0.3 * jitter * p.dispersion)),
      ctxTime,
    );
    osc.connect(gain);
    gain.connect(panner);
    panner.connect(bus);
    osc.start(ctxTime);
    osc.stop(end);
    this.droplets.push({ start: ctxTime, osc, gain, panner });
  }

  private releaseDroplet(d: Droplet): void {
    try {
      d.osc.stop();
    } catch {
      // Not started or already stopped.
    }
    d.osc.disconnect();
    d.gain.disconnect();
    d.panner.disconnect();
  }

  /** Release droplets that finished long ago (bookkeeping only; they are silent). */
  private pruneDroplets(now: number): void {
    if (this.droplets.length < 32) return;
    const keep: Droplet[] = [];
    for (const d of this.droplets) {
      if (d.start < now - 2) {
        d.osc.disconnect();
        d.gain.disconnect();
        d.panner.disconnect();
      } else keep.push(d);
    }
    this.droplets = keep;
  }
}

export function createWaterSound(): SoundMaterial {
  return new WaterSound();
}
