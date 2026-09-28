/**
 * Procedural convolution reverb (SPEC 9.1): a ConvolverNode fed from a send, with an impulse
 * response generated from the seed (see impulse.ts). Decay time comes from Persistence.
 *
 * Changing the decay during preview regenerates the impulse response. Two convolvers take
 * turns: the idle one is silenced, loaded with the new response, and the send crossfades to
 * it while the old tail rings out. The offline render sets the decay once, before rendering,
 * so it never goes through the crossfade.
 */
import { RampedParam } from './automation';
import { generateImpulseResponse } from './impulse';

export interface ReverbOptions {
  seed: number;
  /** Initial RT60 in seconds. */
  decaySec: number;
  /** 0–1, darker tail. Default 0.5. */
  damping?: number;
  /** Seconds. Default 0.012. */
  preDelaySec?: number;
}

/** Relative decay change below which the impulse response is not regenerated. */
const DECAY_TOLERANCE = 0.04;
/** Seconds to silence the idle convolver's old tail before reloading it. */
const SILENCE_SEC = 0.03;
/** Seconds of send crossfade between the two convolvers. */
const CROSSFADE_SEC = 0.08;

export class Reverb {
  /** Connect the send signal here (stereo is folded to mono before the convolver). */
  readonly input: GainNode;
  /** Wet return: connect to the material output. */
  readonly output: GainNode;

  private readonly ctx: BaseAudioContext;
  private readonly seed: number;
  private readonly damping: number;
  private readonly preDelaySec: number;
  private readonly convolvers: ConvolverNode[] = [];
  private readonly sends: RampedParam[] = [];
  private readonly returns: RampedParam[] = [];
  private readonly nodes: AudioNode[] = [];
  private active = 0;
  private current: number;
  private target: number;
  private phase: 'idle' | 'silencing' = 'idle';
  private silentAt = 0;
  private busyUntil = Number.NEGATIVE_INFINITY;

  constructor(ctx: BaseAudioContext, options: ReverbOptions) {
    this.ctx = ctx;
    this.seed = options.seed;
    this.damping = options.damping ?? 0.5;
    this.preDelaySec = options.preDelaySec ?? 0.012;
    this.current = options.decaySec;
    this.target = options.decaySec;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    for (let i = 0; i < 2; i++) {
      const send = ctx.createGain();
      // Fold to mono so a hard-panned voice still gets a wide, enveloping tail.
      send.channelCount = 1;
      send.channelCountMode = 'explicit';
      send.channelInterpretation = 'speakers';
      const convolver = ctx.createConvolver();
      convolver.normalize = false;
      const ret = ctx.createGain();
      this.input.connect(send);
      send.connect(convolver);
      convolver.connect(ret);
      ret.connect(this.output);
      this.sends.push(new RampedParam(send.gain, i === 0 ? 1 : 0));
      this.returns.push(new RampedParam(ret.gain, 1));
      this.convolvers.push(convolver);
      this.nodes.push(send, convolver, ret);
    }
    this.load(0, this.current);
  }

  /** The decay (RT60, seconds) currently heard. */
  get decaySec(): number {
    return this.current;
  }

  /**
   * Set the decay instantly (start of playback, seek, offline). A tail in progress is
   * replaced, so use this only where the engine fades or nothing is sounding yet.
   */
  setDecayNow(decaySec: number, atTime: number): void {
    this.target = decaySec;
    this.phase = 'idle';
    if (Math.abs(decaySec - this.current) > 1e-9) this.load(this.active, decaySec);
    const idle = 1 - this.active;
    this.sends[this.active]?.setAt(1, atTime);
    this.sends[idle]?.setAt(0, atTime);
    this.returns[this.active]?.setAt(1, atTime);
  }

  /**
   * Ask for a new decay during playback. Call on every schedule window with the context's
   * current time: the change is carried out over the next couple of windows, click-free.
   */
  setDecay(decaySec: number, atTime: number, now: number): void {
    this.target = decaySec;
    if (this.phase === 'silencing') {
      if (now >= this.silentAt) this.finishSwap(Math.max(atTime, now + 0.01));
      return;
    }
    if (Math.abs(this.target - this.current) <= DECAY_TOLERANCE * this.current) return;
    if (atTime < this.busyUntil) return; // The previous crossfade is still running.
    // Silence the idle convolver's old tail before it is reloaded.
    this.returns[1 - this.active]?.rampTo(0, atTime, SILENCE_SEC);
    this.phase = 'silencing';
    this.silentAt = atTime + SILENCE_SEC;
  }

  /** Remove old automation bookkeeping (call occasionally with a time in the past). */
  prune(time: number): void {
    for (const p of [...this.sends, ...this.returns]) p.prune(time);
  }

  dispose(): void {
    this.input.disconnect();
    this.output.disconnect();
    for (const node of this.nodes) node.disconnect();
  }

  private finishSwap(at: number): void {
    const idle = 1 - this.active;
    this.load(idle, this.target);
    this.returns[idle]?.setAt(1, at);
    this.sends[this.active]?.rampTo(0, at, CROSSFADE_SEC);
    this.sends[idle]?.setAt(0, at);
    this.sends[idle]?.rampTo(1, at, CROSSFADE_SEC);
    this.active = idle;
    this.phase = 'idle';
    this.busyUntil = at + CROSSFADE_SEC + 0.02;
  }

  private load(index: number, decaySec: number): void {
    const channels = generateImpulseResponse({
      sampleRate: this.ctx.sampleRate,
      decaySec,
      seed: this.seed,
      channels: 2,
      damping: this.damping,
      preDelaySec: this.preDelaySec,
    });
    const length = channels[0]?.length ?? 1;
    const buffer = this.ctx.createBuffer(channels.length, length, this.ctx.sampleRate);
    channels.forEach((data, c) => buffer.copyToChannel(data, c));
    const convolver = this.convolvers[index];
    if (convolver) convolver.buffer = buffer;
    this.current = decaySec;
  }
}
