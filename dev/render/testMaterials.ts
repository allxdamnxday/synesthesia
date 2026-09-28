/**
 * Two dev-only test materials for checking audio/video alignment in rendered MP4s (SPEC 16
 * M4: "audio and video align within one frame at an onset"). Not registered in the app.
 *
 * - Onset flash (visual): black, except a white frame right after the signature has an
 *   onset. Like a real material it only responds to what it has been stepped through: step
 *   k covers composition time [k·dt, (k+1)·dt), and a frame drawn after that step shows the
 *   flash. So an onset at time τ appears on the first frame whose time is later than the
 *   start of τ's step: never before the click, at most one video frame after it.
 * - Onset click (sound): a sharp click (a decaying 1 kHz burst starting at full amplitude)
 *   starting exactly at each onset (`sampler.onsetsBetween`).
 *
 * Visual materials never see onsets directly (they only get SignatureFrames), so the flash
 * material asks its own sampler, configured exactly like the render's.
 */
import type {
  MaterialMeta,
  PropertyValues,
  ScheduleWindow,
  SoundMaterial,
  SoundMaterialEntry,
  VisualContext,
  VisualMaterial,
  VisualMaterialEntry,
} from '../../src/materials/types';
import type { SignatureFrame, SignatureSampler } from '../../src/signature/types';

export const FLASH_META: MaterialMeta = {
  id: 'test-onset-flash',
  version: 1,
  name: 'Onset flash (test)',
  description: 'Black, with one white frame after each onset.',
  properties: [],
};

export const CLICK_META: MaterialMeta = {
  id: 'test-onset-click',
  version: 1,
  name: 'Onset click (test)',
  description: 'A sharp click at each onset.',
  properties: [],
};

/** Peak of the click before the master chain. */
export const CLICK_AMPLITUDE = 0.9;
/** Anything above this in the decoded audio is the click (the rest is silence). */
export const CLICK_THRESHOLD = 0.3;

class OnsetFlash implements VisualMaterial {
  readonly id = FLASH_META.id;
  readonly version = FLASH_META.version;
  readonly name = FLASH_META.name;
  readonly description = FLASH_META.description;
  readonly properties = FLASH_META.properties;

  private gl: WebGL2RenderingContext | null = null;
  private width = 1;
  private height = 1;
  private stepIndex = 0;
  private flash = false;
  private readonly sampler: SignatureSampler;

  constructor(sampler: SignatureSampler) {
    this.sampler = sampler;
  }

  init(ctx: VisualContext): Promise<void> {
    this.gl = ctx.gl;
    this.width = ctx.width;
    this.height = ctx.height;
    this.reset();
    return Promise.resolve();
  }

  reset(): void {
    this.stepIndex = 0;
    this.flash = false;
  }

  step(_frame: SignatureFrame, _props: PropertyValues, dt: number): void {
    // From the step count, so consecutive steps tile time exactly (no gaps, no overlaps).
    const t0 = this.stepIndex * dt;
    const t1 = (this.stepIndex + 1) * dt;
    if (this.sampler.onsetsBetween(t0, t1).length > 0) this.flash = true;
    this.stepIndex++;
  }

  draw(): void {
    const gl = this.gl;
    if (!gl) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    const v = this.flash ? 1 : 0;
    gl.clearColor(v, v, v, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.flash = false;
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  dispose(): void {
    this.gl = null;
  }
}

/** A flash material that finds onsets with `sampler` (configure it like the render's). */
export function onsetFlashEntry(sampler: SignatureSampler): VisualMaterialEntry {
  return { kind: 'visual', meta: FLASH_META, create: () => new OnsetFlash(sampler) };
}

function clickBuffer(ctx: BaseAudioContext): AudioBuffer {
  const length = Math.round(0.02 * ctx.sampleRate);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const decay = 0.004 * ctx.sampleRate;
  for (let i = 0; i < length; i++) {
    data[i] =
      CLICK_AMPLITUDE * Math.cos((2 * Math.PI * 1000 * i) / ctx.sampleRate) * Math.exp(-i / decay);
  }
  return buffer;
}

class OnsetClick implements SoundMaterial {
  readonly id = CLICK_META.id;
  readonly version = CLICK_META.version;
  readonly name = CLICK_META.name;
  readonly description = CLICK_META.description;
  readonly properties = CLICK_META.properties;

  private ctx: BaseAudioContext | null = null;
  private out: GainNode | null = null;
  private buffer: AudioBuffer | null = null;
  private sources: { node: AudioBufferSourceNode; at: number }[] = [];

  build(ctx: BaseAudioContext, destination: AudioNode): Promise<void> {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.connect(destination);
    this.buffer = clickBuffer(ctx);
    return Promise.resolve();
  }

  schedule(win: ScheduleWindow): void {
    const { ctx, out, buffer } = this;
    if (!ctx || !out || !buffer) return;
    for (const t of win.sampler.onsetsBetween(win.t0, win.t1)) {
      const at = win.ctxTimeAtT0 + (t - win.t0);
      const node = new AudioBufferSourceNode(ctx, { buffer });
      node.connect(out);
      node.start(at);
      this.sources.push({ node, at });
    }
  }

  cancelFrom(ctxTime: number): void {
    this.sources = this.sources.filter(({ node, at }) => {
      if (at < ctxTime) return true;
      node.stop();
      node.disconnect();
      return false;
    });
  }

  dispose(): void {
    for (const { node } of this.sources) node.disconnect();
    this.sources = [];
    this.out?.disconnect();
    this.out = null;
    this.ctx = null;
  }
}

export const onsetClickEntry: SoundMaterialEntry = {
  kind: 'sound',
  meta: CLICK_META,
  create: () => new OnsetClick(),
};
