/**
 * Small audio-graph helpers shared by sound materials: k-rate parameters, deterministic
 * mixing (a fixed set of sources, or one-shots that come and go), and the soft saturation
 * ("drive") stage that Intensity pushes.
 *
 * The mixing rule (SPEC C6, bit-identical renders): never connect more than two sounding
 * sources to one audio input. Use `mixPairwise` or `OneShotMix`. The same goes for an
 * AudioParam, where the parameter's own value (or its automation) is one of the terms: with a
 * non-zero own value, connect at most one signal to it; at 0, at most two. (Measured in
 * Chrome 153: a gain parameter at 0.37 with two connections gave two different renders in
 * twelve; at 0 with two, or at 0.37 with one, always the same.)
 */

/**
 * Mix several nodes into one, bit-identically on every run (SPEC C6).
 *
 * Chrome adds up the connections into an input in an order that depends on memory addresses
 * (it keeps them in a hash set), and floating-point addition of three or more signals is not
 * associative: (a + b) + c and (a + c) + b differ in the last bits. Two renders of the same
 * composition would then differ by about 1e-6 whenever three sources sound at once. Adding in
 * pairs fixes the order, because a + b is exactly b + a. So never connect more than two
 * sounding sources to one input: mix them through this balanced tree of GainNodes instead.
 *
 * Returns the node that carries the sum (a lone source is returned as is) and the GainNodes
 * it created, for disposal.
 */
export function mixPairwise(
  ctx: BaseAudioContext,
  sources: readonly AudioNode[],
): { output: AudioNode; nodes: GainNode[] } {
  const nodes: GainNode[] = [];
  let level: AudioNode[] = [...sources];
  if (level.length === 0) {
    const silent = ctx.createGain();
    nodes.push(silent);
    return { output: silent, nodes };
  }
  while (level.length > 1) {
    const next: AudioNode[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i];
      const b = level[i + 1];
      if (!a) continue;
      if (!b) {
        next.push(a);
        continue;
      }
      const sum = ctx.createGain();
      a.connect(sum);
      b.connect(sum);
      nodes.push(sum);
      next.push(sum);
    }
    level = next;
  }
  return { output: level[0], nodes };
}

/** Default slot count of a OneShotMix: up to twice as many one-shots can sound at once. */
export const ONE_SHOT_SLOTS = 16;
/** One-shots a slot carries at the same moment: two still sum bit-identically. */
const ONE_SHOTS_PER_SLOT = 2;
/** Margin around each one-shot's span, seconds (more than a render quantum). */
const ONE_SHOT_GUARD_SEC = 0.005;

interface OneShotSpan {
  /** Context time the one-shot starts (as given). */
  start: number;
  /** Its span widened by the guard. */
  lo: number;
  hi: number;
}

/**
 * A bus for short sounds started one by one that may overlap (droplets, strikes, plucks),
 * bit-identical on every run however many overlap (SPEC C6). Connected straight to one
 * GainNode, three or more sounding at once would be summed in an order that changes between
 * renders (see mixPairwise). Here each one-shot joins one of a fixed set of slots that never
 * carries more than two at the same moment, and the slots are mixed in pairs. The slot is
 * chosen from the one-shots' times alone (the first with room), so every render makes the
 * same choices, however the timeline is split into schedule windows.
 *
 * With every slot full a one-shot is dropped (`add` returns false): that many at once can't
 * be heard as separate events anyway. A source that is silent before its start and after its
 * end (an oscillator started and stopped at those times) adds exact zeros outside its span,
 * which never change a sum.
 */
export class OneShotMix {
  /** The mix of every one-shot. */
  readonly output: AudioNode;
  private readonly slots: GainNode[] = [];
  private readonly nodes: GainNode[];
  private readonly spans: OneShotSpan[][] = [];

  constructor(ctx: BaseAudioContext, slotCount = ONE_SHOT_SLOTS) {
    for (let i = 0; i < Math.max(1, Math.round(slotCount)); i++) {
      this.slots.push(ctx.createGain());
      this.spans.push([]);
    }
    const mix = mixPairwise(ctx, this.slots);
    this.output = mix.output;
    this.nodes = [...this.slots, ...mix.nodes];
  }

  /**
   * Connect `node`, sounding from `start` to `end` (context time), to the first slot with
   * room then. Returns false, leaving it unconnected, when every slot is busy.
   */
  add(node: AudioNode, start: number, end: number): boolean {
    const lo = start - ONE_SHOT_GUARD_SEC;
    const hi = end + ONE_SHOT_GUARD_SEC;
    for (let i = 0; i < this.slots.length; i++) {
      const list = this.spans[i];
      const slot = this.slots[i];
      if (!list || !slot) continue;
      let overlapping = 0;
      for (const s of list) if (s.lo < hi && s.hi > lo) overlapping++;
      if (overlapping < ONE_SHOTS_PER_SLOT) {
        node.connect(slot);
        list.push({ start, lo, hi });
        return true;
      }
    }
    return false;
  }

  /** Forget the one-shots starting at or after `ctxTime` (their sources were released). */
  cancelFrom(ctxTime: number): void {
    for (let i = 0; i < this.spans.length; i++) {
      this.spans[i] = (this.spans[i] ?? []).filter((s) => s.start < ctxTime - 1e-9);
    }
  }

  /**
   * Forget one-shots that finished before `ctxTime` (bookkeeping only). Pass a time no later
   * than the start of anything still to be added (e.g. the audio clock), so it never changes
   * which slot a later one-shot gets.
   */
  prune(ctxTime: number): void {
    for (let i = 0; i < this.spans.length; i++) {
      this.spans[i] = (this.spans[i] ?? []).filter((s) => s.hi >= ctxTime);
    }
  }

  dispose(): void {
    for (const node of this.nodes) node.disconnect();
  }
}

/** Switch parameters to one value per render quantum where the browser allows it. */
export function setKRate(...params: AudioParam[]): void {
  for (const param of params) {
    try {
      param.automationRate = 'k-rate';
    } catch {
      // Some engines fix the rate; a-rate is only slower, never wrong.
    }
  }
}

/** The drive curve is tanh over ±DRIVE_HEADROOM (see `driveStageGains`). */
export const DRIVE_HEADROOM = 4;
const DRIVE_CURVE_SIZE = 2049;

/** WaveShaper curve for the drive stage: tanh(H·u) for u in −1..1. */
export function driveCurve(): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(DRIVE_CURVE_SIZE);
  const half = (DRIVE_CURVE_SIZE - 1) / 2;
  for (let i = 0; i < DRIVE_CURVE_SIZE; i++) {
    curve[i] = Math.tanh(((i - half) / half) * DRIVE_HEADROOM);
  }
  return curve;
}

/**
 * Gains around the drive curve for a drive amount k > 0: pre-gain k / H into tanh(H·u), then
 * post-gain 1 / tanh(k). Unity for small signals as k → 0; louder and more saturated as k
 * grows, and a full-scale input always comes out at full scale.
 */
export function driveStageGains(drive: number): { pre: number; post: number } {
  const k = Math.max(1e-3, drive);
  return { pre: k / DRIVE_HEADROOM, post: 1 / Math.tanh(k) };
}
