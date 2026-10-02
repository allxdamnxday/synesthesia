/**
 * Material interfaces (SPEC 9.1). Materials talk to the engine only through these.
 * The same material code runs in realtime preview and in offline render.
 */
import type { Rng } from '../chance/prng';
import type { SignatureFrame, SignatureSampler } from '../signature/types';

export type PropertyKind = 'continuous' | 'choice';

export interface PropertyDef {
  /** e.g. 'viscosity' (shared) or 'fallSpeed' (material-specific). */
  id: string;
  /** UI label, sentence case. */
  label: string;
  /** One plain-language sentence for Help and tooltips. */
  description: string;
  kind: PropertyKind;
  /** True if from the shared vocabulary (src/materials/properties.ts). */
  shared: boolean;
  /** Baseline. 0–1 for 'continuous'; an index into `choices` for 'choice'. */
  default: number;
  /** For 'choice'. */
  choices?: string[];
  /** Shown by default. At most 6 primary properties per material, not counting Hue. */
  primary: boolean;
}

/** Property id → value (0–1 for continuous; index for choice). */
export type PropertyValues = Record<string, number>;

export type MaterialKind = 'visual' | 'sound';

export interface MaterialMeta {
  /** Unique within its kind. */
  id: string;
  /** Bump whenever output for the same inputs changes. */
  version: number;
  name: string;
  /** Plain language, shown in the picker. */
  description: string;
  properties: PropertyDef[];
}

export type Quality = 'draft' | 'standard' | 'high';

export interface VisualContext {
  gl: WebGL2RenderingContext;
  /** Drawing-buffer size in pixels. */
  width: number;
  height: number;
  quality: Quality;
  seed: number;
  /** Seeded PRNG; never Math.random. */
  rng: Rng;
}

export interface VisualMaterial extends MaterialMeta {
  init(ctx: VisualContext): Promise<void>;
  /** Return to the initial state at t = 0 for this seed. */
  reset(seed: number): void;
  /** Advance by a fixed dt (1/60 s) of composition time. */
  step(frame: SignatureFrame, props: PropertyValues, dt: number): void;
  /** Draw the current state to the default framebuffer. */
  draw(): void;
  /**
   * Optional: apply display-only property changes (brightness, palette, surface light…)
   * so a paused preview can redraw without stepping. Never changes simulation state.
   */
  setProperties?(props: PropertyValues): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

export interface ScheduleWindow {
  sampler: SignatureSampler;
  props: PropertyValues;
  /** Composition time range to schedule, [t0, t1). */
  t0: number;
  t1: number;
  /** AudioContext time corresponding to composition time t0. */
  ctxTimeAtT0: number;
  /** Automation points per second (default 200). */
  controlRate: number;
}

export interface SoundMaterial extends MaterialMeta {
  build(ctx: BaseAudioContext, destination: AudioNode, seed: number): Promise<void>;
  /** Write AudioParam automation and events for the window. */
  schedule(win: ScheduleWindow): void;
  /** Clear automation and events after a context time (for live edits and seeks). */
  cancelFrom(ctxTime: number): void;
  dispose(): void;
}

/** Registry entries create fresh instances (preview and render never share one). */
export interface VisualMaterialEntry {
  kind: 'visual';
  meta: MaterialMeta;
  create: () => VisualMaterial;
}

export interface SoundMaterialEntry {
  kind: 'sound';
  meta: MaterialMeta;
  create: () => SoundMaterial;
}

export const DEFAULT_CONTROL_RATE = 200;
/** Fixed simulation step (SPEC 7.5). */
export const FIXED_DT = 1 / 60;
