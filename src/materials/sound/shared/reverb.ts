/**
 * Procedural convolution reverb (SPEC 9.1): a ConvolverNode fed from a send, with an impulse
 * response generated from the seed (see impulse.ts). Decay time comes from Persistence.
 *
 * Changing the decay means a new impulse response, and that is heavy on the main thread:
 * generating it (~40 ms for a 6 s decay on the builder's machine) and Chrome preparing the
 * convolver (~25–60 ms more). Rebuilding on every step of a Persistence drag would starve the
 * sound scheduler, so:
 *
 * - The first decay loads at once, synchronously: the offline render needs it before
 *   rendering. Call `setDecayNow` / `setDecay` after writing the window's automation, so even
 *   that first load never delays it.
 * - Later changes happen right after the current task (a microtask), never in the middle of
 *   writing automation; at most one rebuild per REBUILD_INTERVAL_SEC, and at least
 *   REBUILD_COST_FACTOR times its own cost apart (measured on the audio clock), the latest
 *   requested value winning. While the value keeps changing, changes under DECAY_TOLERANCE
 *   wait; once it has settled for SETTLE_SEC it is applied exactly.
 * - A rebuild comes in two steps on different windows, at least STEP_GAP_SEC apart (a
 *   scheduler tick in between): first the impulse response, then the convolver, so the main
 *   thread is never busy with both at once.
 * - Two sides take turns, each a send, a convolver and a return. The idle side gets a new
 *   ConvolverNode, built while it is silent (its return is muted first if its old tail may
 *   still ring), and the send crossfades to it while the old tail rings out. If the idle side
 *   already holds the wanted decay (dragging back), it is crossfaded back in without a
 *   rebuild. A sounding convolver is never touched, so no tail is ever cut short.
 * - Rebuilds make a new ConvolverNode rather than setting `buffer` on the old one: measured
 *   in Chrome 153, replacing the buffer of a connected convolver held up the audio thread
 *   (it ran up to ~13 ms late and caught up in bursts: a risk of dropouts), while building a
 *   new node before connecting it almost never did, for the same main-thread cost.
 * - Impulse responses are cached (impulse.ts), shared with the offline render.
 *
 * The offline render sets the decay once, before rendering, and never swaps, so its output
 * depends only on the seed and the decay.
 */
import { RampedParam } from './automation';
import {
  cachedImpulseResponse,
  hasCachedImpulseResponse,
  impulseLength,
  type ImpulseOptions,
} from './impulse';

export interface ReverbOptions {
  seed: number;
  /**
   * Initial RT60 in seconds, loaded at once. Omit it to load nothing until the first
   * `setDecayNow` / `setDecay` (saves building a response that is replaced straight away).
   */
  decaySec?: number;
  /** 0–1, darker tail. Default 0.5. */
  damping?: number;
  /** Seconds. Default 0.012. */
  preDelaySec?: number;
}

/** Relative decay change that waits while the value keeps changing. */
export const DECAY_TOLERANCE = 0.04;
/** Once the requested decay has been steady this long, it is applied exactly. */
export const SETTLE_SEC = 0.3;
/** Shortest time between two rebuilds, seconds. */
export const REBUILD_INTERVAL_SEC = 0.15;
/** Rebuilds are at least this many times their own cost apart. */
export const REBUILD_COST_FACTOR = 2;
/** Seconds to mute the idle side's old tail before rebuilding it. */
export const SILENCE_SEC = 0.03;
/** Seconds of send crossfade between the two sides. */
export const CROSSFADE_SEC = 0.08;
/**
 * Seconds between preparing an impulse response and building the convolver from it: more
 * than one tick of the sound scheduler.
 */
export const STEP_GAP_SEC = 0.06;
/** How far ahead of the audio clock changes are scheduled, seconds. */
const LEAD_SEC = 0.03;
/** Relative difference treated as the same decay once settled. */
const EXACT = 1e-9;

/** True when `a` is within `tolerance` (relative to `b`) of `b`. False for NaN. */
function near(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= tolerance * b;
}

interface Side {
  sendNode: GainNode;
  retNode: GainNode;
  send: RampedParam;
  ret: RampedParam;
  /** The side's convolver (null before its first load). */
  convolver: ConvolverNode | null;
  /** Decay loaded (NaN: none yet). */
  decay: number;
  /** Context time after which its output is certainly silent (Infinity while in use). */
  quietAt: number;
  /** True while its return is (being) muted. */
  muted: boolean;
}

export class Reverb {
  /** Connect the send signal here (stereo is folded to mono before the convolver). */
  readonly input: GainNode;
  /** Wet return: connect to the material output. */
  readonly output: GainNode;

  private readonly ctx: BaseAudioContext;
  private readonly seed: number;
  private readonly damping: number;
  private readonly preDelaySec: number;
  private readonly sides: Side[] = [];
  private active = 0;
  private target = Number.NaN;
  /** Context time the requested decay last changed. */
  private targetSince = Number.NEGATIVE_INFINITY;
  /** End of the crossfade in progress. */
  private busyUntil = Number.NEGATIVE_INFINITY;
  /** Earliest context time for the next rebuild. */
  private nextRebuildAt = Number.NEGATIVE_INFINITY;
  /** Decay whose impulse response has been prepared for the next rebuild (NaN: none). */
  private pending = Number.NaN;
  private pumpQueued = false;
  private disposed = false;
  private rebuildCount = 0;

  constructor(ctx: BaseAudioContext, options: ReverbOptions) {
    this.ctx = ctx;
    this.seed = options.seed;
    this.damping = options.damping ?? 0.5;
    this.preDelaySec = options.preDelaySec ?? 0.012;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    for (let i = 0; i < 2; i++) {
      const sendNode = ctx.createGain();
      // Fold to mono so a hard-panned voice still gets a wide, enveloping tail.
      sendNode.channelCount = 1;
      sendNode.channelCountMode = 'explicit';
      sendNode.channelInterpretation = 'speakers';
      const retNode = ctx.createGain();
      this.input.connect(sendNode);
      retNode.connect(this.output);
      this.sides.push({
        sendNode,
        retNode,
        send: new RampedParam(sendNode.gain, i === 0 ? 1 : 0),
        ret: new RampedParam(retNode.gain, 1),
        convolver: null,
        decay: Number.NaN,
        quietAt: i === 0 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY,
        muted: false,
      });
    }
    if (options.decaySec !== undefined) this.loadFirst(options.decaySec);
  }

  /** The decay (RT60, seconds) currently heard (NaN before the first load). */
  get decaySec(): number {
    return this.activeSide().decay;
  }

  /** Impulse responses built so far by this reverb (diagnostics, tests). */
  get rebuilds(): number {
    return this.rebuildCount;
  }

  /**
   * Set the decay at a jump in the timeline (the first window, a seek), where the engine
   * fades around the jump. The first call loads at once; later ones finish a crossfade in
   * progress at `atTime` (in the engine's silence) and then change the decay like `setDecay`.
   */
  setDecayNow(decaySec: number, atTime: number): void {
    if (this.loadFirst(decaySec)) return;
    this.request(decaySec);
    if (this.busyUntil > atTime) {
      this.activeSide().send.setAt(1, atTime);
      this.sides[1 - this.active]?.send.setAt(0, atTime);
      this.busyUntil = atTime;
    }
    this.queuePump();
  }

  /**
   * Ask for a new decay during playback. Call on every schedule window, after writing its
   * automation: the change is carried out over the next windows, click-free (see above).
   * `atTime` and `now` are kept for callers written against the earlier version; the
   * reverb reads the audio clock itself.
   */
  setDecay(decaySec: number, _atTime?: number, _now?: number): void {
    if (this.loadFirst(decaySec)) return;
    this.request(decaySec);
    this.queuePump();
  }

  /** Remove old automation bookkeeping (a time in the past). Done automatically as well. */
  prune(time: number): void {
    for (const s of this.sides) {
      s.send.prune(time);
      s.ret.prune(time);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.input.disconnect();
    this.output.disconnect();
    for (const s of this.sides) {
      s.sendNode.disconnect();
      s.retNode.disconnect();
      s.convolver?.disconnect();
      s.convolver = null;
    }
  }

  // -------------------------------------------------------------------------------------

  private activeSide(): Side {
    const side = this.sides[this.active];
    if (!side) throw new Error('Reverb has no convolvers.');
    return side;
  }

  /** Load the first decay synchronously. Returns false once something is loaded. */
  private loadFirst(decaySec: number): boolean {
    const side = this.activeSide();
    if (!Number.isNaN(side.decay)) return false;
    this.target = decaySec;
    this.load(side, decaySec);
    return true;
  }

  private request(decaySec: number): void {
    if (decaySec !== this.target) {
      this.target = decaySec;
      this.targetSince = this.ctx.currentTime;
    }
  }

  private queuePump(): void {
    if (this.pumpQueued || this.disposed) return;
    if (Math.abs(this.target - this.activeSide().decay) <= EXACT * this.target) return;
    this.pumpQueued = true;
    queueMicrotask(() => {
      this.pumpQueued = false;
      this.pump();
    });
  }

  /** Move one step towards the requested decay (runs after the current task). */
  private pump(): void {
    if (this.disposed) return;
    const now = this.ctx.currentTime;
    this.prune(now - 1);
    const current = this.activeSide();
    const settled = now - this.targetSince >= SETTLE_SEC;
    const tolerance = settled ? EXACT : DECAY_TOLERANCE;
    if (near(this.target, current.decay, tolerance)) {
      this.pending = Number.NaN;
      return;
    }
    if (now < this.busyUntil) return; // A crossfade is still running.
    const idleIndex = 1 - this.active;
    const idle = this.sides[idleIndex];
    if (!idle) return;
    if (near(this.target, idle.decay, tolerance)) {
      // Dragged back to what the idle side holds: crossfade to it, no rebuild.
      this.pending = Number.NaN;
      this.crossfadeTo(idleIndex, now);
      return;
    }
    if (now < this.nextRebuildAt) return;
    if (now < idle.quietAt && !idle.muted) {
      // Its old tail may still ring: mute it; the rebuild waits until it is silent.
      idle.ret.rampTo(0, now + LEAD_SEC, SILENCE_SEC);
      idle.muted = true;
      idle.quietAt = Math.min(idle.quietAt, now + LEAD_SEC + SILENCE_SEC);
    }
    // Times below are measured on the audio clock, which runs on while the main thread works.
    if (Number.isNaN(this.pending) || near(this.pending, current.decay, EXACT)) {
      // The impulse response first, the convolver on a later window, with a scheduler tick in
      // between: the main thread is never busy with both at once. (While the value keeps
      // changing, the response prepared here is still built: it is nearer than the one
      // playing, and the next rebuild catches up.)
      this.pending = this.target;
      const options = this.impulseOptions(this.pending);
      if (!hasCachedImpulseResponse(options)) {
        const started = this.ctx.currentTime;
        cachedImpulseResponse(options);
        const finished = this.ctx.currentTime;
        this.nextRebuildAt = finished + Math.max(STEP_GAP_SEC, finished - started);
        return;
      }
    }
    if (now < idle.quietAt) return; // Still muting.
    const started = this.ctx.currentTime;
    this.load(idle, this.pending);
    const finished = this.ctx.currentTime;
    this.nextRebuildAt =
      finished + Math.max(REBUILD_INTERVAL_SEC, REBUILD_COST_FACTOR * (finished - started));
    this.pending = Number.NaN;
    this.crossfadeTo(idleIndex, finished);
  }

  /** Crossfade the send from the active side to side `index`, starting just ahead. */
  private crossfadeTo(index: number, now: number): void {
    const incoming = this.sides[index];
    const outgoing = this.activeSide();
    if (!incoming || incoming === outgoing) return;
    const start = now + LEAD_SEC;
    incoming.ret.rampTo(1, start, CROSSFADE_SEC);
    incoming.send.rampTo(1, start, CROSSFADE_SEC);
    outgoing.send.rampTo(0, start, CROSSFADE_SEC);
    incoming.muted = false;
    incoming.quietAt = Number.POSITIVE_INFINITY;
    // The outgoing tail rings out on its own once its send has closed.
    outgoing.quietAt = start + CROSSFADE_SEC + this.tailSeconds(outgoing.decay);
    this.active = index;
    this.busyUntil = start + CROSSFADE_SEC;
  }

  private impulseOptions(decaySec: number): ImpulseOptions {
    return {
      sampleRate: this.ctx.sampleRate,
      decaySec,
      seed: this.seed,
      channels: 2,
      damping: this.damping,
      preDelaySec: this.preDelaySec,
    };
  }

  private tailSeconds(decaySec: number): number {
    if (Number.isNaN(decaySec)) return 0;
    return impulseLength(this.impulseOptions(decaySec)) / this.ctx.sampleRate;
  }

  /** Give `side` a new convolver holding `decaySec` (the side must be silent). */
  private load(side: Side, decaySec: number): void {
    const channels = cachedImpulseResponse(this.impulseOptions(decaySec));
    const length = channels[0]?.length ?? 1;
    const buffer = this.ctx.createBuffer(channels.length, length, this.ctx.sampleRate);
    channels.forEach((data, c) => buffer.copyToChannel(data, c));
    // Built completely before it joins the graph (see the class comment).
    const convolver = this.ctx.createConvolver();
    convolver.normalize = false;
    convolver.buffer = buffer;
    side.sendNode.connect(convolver);
    convolver.connect(side.retNode);
    const old = side.convolver;
    if (old) {
      side.sendNode.disconnect(old);
      old.disconnect();
    }
    side.convolver = convolver;
    side.decay = decaySec;
    this.rebuildCount++;
  }
}
