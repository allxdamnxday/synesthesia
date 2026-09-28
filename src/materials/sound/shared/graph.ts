/**
 * Small audio-graph helpers shared by sound materials: k-rate parameters, deterministic
 * mixing, and the soft saturation ("drive") stage that Intensity pushes. The drive uses the
 * same curve and gain staging as A1 Water's own copy (water/water.ts), shared here for the
 * materials that came after it.
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
