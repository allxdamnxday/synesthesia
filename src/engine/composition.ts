/**
 * Composition model (SPEC 11.2) and global composition controls (SPEC 9.2).
 * A composition = signature reference + one visual material + one sound material +
 * property values + seed + render settings + notes.
 */
import type { PropertyValues } from '../materials/types';
import type { LoopMode } from '../signature/types';

export interface TimelineSettings {
  speed: number;
  loops: number;
  loopMode: LoopMode;
  tailSec: number;
  smoothing: number;
  signatureStrength: number;
}

export interface MaterialSettings {
  materialId: string;
  materialVersion: number;
  properties: PropertyValues;
}

export type RenderFps = 30 | 60;

export interface RenderSettings {
  width: number;
  height: number;
  fps: RenderFps;
}

export type CompositionStatus = 'draft' | 'kept' | 'set-aside';

export interface ChanceRecord {
  albumId?: string;
  index?: number;
  masterSeed?: number;
  /** Properties chance made available to play. */
  openProperties: string[];
  /** Locked properties the artist deliberately changed. */
  overrides: string[];
}

export interface Composition {
  format: 'sp-composition';
  version: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  signature: { id: string; contentHash: string; name: string };
  /** 0–999999 */
  seed: number;
  timeline: TimelineSettings;
  linked: boolean;
  visual: MaterialSettings;
  sound: MaterialSettings;
  mute: { visual: boolean; sound: boolean };
  chance: ChanceRecord | null;
  render: RenderSettings;
  status: CompositionStatus;
  /** Research record: discoveries, failures, revisions. */
  notes: string;
  /** Small data URL of a still of the wake. */
  thumbnail?: string;
}

export const COMPOSITION_FORMAT = 'sp-composition';
export const COMPOSITION_VERSION = 1;

export interface ControlRange {
  min: number;
  max: number;
  default: number;
  step: number;
}

/** Global composition controls (SPEC 9.2). Speed's default is the signature's preferredSpeed. */
export const GLOBAL_CONTROLS = {
  signatureStrength: { min: 0, max: 3, default: 1, step: 0.01 },
  smoothing: { min: 0, max: 1, default: 0.2, step: 0.01 },
  speed: { min: 0.25, max: 2, default: 1, step: 0.01 },
  loops: { min: 1, max: 8, default: 1, step: 1 },
  tailSec: { min: 0, max: 10, default: 3, step: 0.1 },
} as const satisfies Record<string, ControlRange>;

export const DEFAULT_RENDER_SETTINGS: Readonly<RenderSettings> = {
  width: 1920,
  height: 1080,
  fps: 30,
};

export function defaultTimeline(preferredSpeed = 1): TimelineSettings {
  return {
    speed: preferredSpeed,
    loops: GLOBAL_CONTROLS.loops.default,
    loopMode: 'loop',
    tailSec: GLOBAL_CONTROLS.tailSec.default,
    smoothing: GLOBAL_CONTROLS.smoothing.default,
    signatureStrength: GLOBAL_CONTROLS.signatureStrength.default,
  };
}

/**
 * Composition timeline length (SPEC 7.5): signatureDuration / speed × loops + tail.
 * `signatureDuration` is one pass at speed 1.
 */
export function timelineDuration(signatureDuration: number, timeline: TimelineSettings): number {
  const speed = Math.max(GLOBAL_CONTROLS.speed.min, timeline.speed);
  return (signatureDuration / speed) * Math.max(1, timeline.loops) + Math.max(0, timeline.tailSec);
}

/** File-name-safe version of a name: letters, digits, dash and underscore only. */
export function sanitizeFileName(name: string): string {
  const cleaned = name
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  return cleaned.length > 0 ? cleaned.slice(0, 60) : 'untitled';
}
