/**
 * A material's own dip around a jump of the timeline, as a gain node driven by explicit fades
 * (the event-driven counterpart of seekDip.ts, which writes the dip into a control bus).
 *
 * The engine fades out and back in around an ordinary seek, but it resynchronises a starved
 * scheduler as a seek without fading. A material whose sound can't simply glide to the new
 * moment (a ringing body to silence, strings to damp, noise to realign) dips its output here
 * and does those things once it is silent. The fades follow seekDip.ts: from wherever the
 * level is down to silence over SEEK_DIP_OUT_SEC, silent until SEEK_DIP_SILENT_UNTIL_SEC,
 * then back in over SEEK_DIP_IN_SEC.
 *
 * Renders never seek, so a render never dips: the gain stays exactly 1 (bit-transparent).
 */
import { RampedParam } from './automation';
import { SEEK_DIP_IN_SEC, SEEK_DIP_OUT_SEC, SEEK_DIP_SILENT_UNTIL_SEC } from './seekDip';

/** How long after the jump the output is certainly silent, seconds. */
export const SEEK_DIP_QUIET_SEC = SEEK_DIP_OUT_SEC + 0.001;

export class SeekDipGain {
  /** Route the material's signal through this node. */
  readonly node: GainNode;
  private readonly gain: RampedParam;

  constructor(ctx: BaseAudioContext) {
    this.node = ctx.createGain();
    this.gain = new RampedParam(this.node.gain, 1);
  }

  /**
   * Dip around a jump at context time `at`. Returns the context time from which the output is
   * silent (until the fade back in), where the material can reset what was sounding.
   */
  dip(at: number): number {
    this.gain.rampTo(0, at, SEEK_DIP_OUT_SEC);
    this.gain.rampTo(1, at + SEEK_DIP_SILENT_UNTIL_SEC, SEEK_DIP_IN_SEC);
    return at + SEEK_DIP_QUIET_SEC;
  }

  /** Forget fades that ended before `time` (call now and then with a time in the past). */
  prune(time: number): void {
    this.gain.prune(time);
  }

  dispose(): void {
    this.node.disconnect();
  }
}
