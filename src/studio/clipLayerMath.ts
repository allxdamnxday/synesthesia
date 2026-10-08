/**
 * Pure maths for the Studio's clip layer (SPEC 6.3 "Clip layer"): which moment of the clip
 * belongs to the playhead, how its <video> is kept there, and where the clip sits over the
 * wake. Tested in tests/unit/studio-clip-layer.test.ts.
 *
 * The layer shows the clip where and when the signature acts, so it uses the same rules as
 * the things it follows: the sampler's timeline (src/signature/sampler.ts), extraction's
 * crop and orientation (src/signature/frameGeometry.ts) and the materials' Range
 * projection (src/materials/visual/shared/fluid/projection.ts).
 */
import { readProperty } from '../materials/properties';
import type { MaterialMeta, PropertyValues } from '../materials/types';
import { projectField } from '../materials/visual/shared/fluid/projection';
import { orientationTransform } from '../screens/Prepare/orientation';
import {
  clampPlayhead,
  clipTimeForSignature,
  frameDuration,
  type Trim,
} from '../screens/Prepare/trim';
import { focusCropPx, orientedSize } from '../signature/frameGeometry';
import type { FocusArea, Rotation, SamplerConfig } from '../signature/types';

function clampTo(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}

// -----------------------------------------------------------------------------------------
// Time

export interface SignatureMoment {
  /** Seconds into one pass of the signature, at speed 1. */
  s: number;
  /** 1 while the movement plays forwards, −1 backwards, 0 at rest (before it, or in the tail). */
  direction: -1 | 0 | 1;
}

/**
 * Where the signature is at composition time `t`, as the sampler plays it: `loops` passes
 * at `speed` (odd passes backwards in back-and-forth), then the tail, which rests where
 * the movement ended.
 */
export function signatureMomentAt(
  t: number,
  config: Pick<SamplerConfig, 'speed' | 'loops' | 'loopMode'>,
  signatureDuration: number,
): SignatureMoment {
  const d = signatureDuration > 0 ? signatureDuration : 0;
  const speed = config.speed > 0 ? config.speed : 1;
  const loops = config.loops >= 1 ? config.loops : 1;
  const pass = d / speed;
  if (!(t >= 0) || !(pass > 0)) return { s: 0, direction: 0 };
  const movement = pass * loops;
  const lastPass = Math.max(0, Math.ceil(loops) - 1);
  const moving = t < movement;
  const at = moving ? t : movement;
  const index = moving ? Math.min(lastPass, Math.floor(at / pass)) : lastPass;
  const local = clampTo((at - index * pass) * speed, 0, d);
  const reversed = config.loopMode === 'pingpong' && index % 2 === 1;
  return { s: reversed ? d - local : local, direction: moving ? (reversed ? -1 : 1) : 0 };
}

/** Off a frame boundary, where rounding could show the neighbouring frame. */
const SEEK_NUDGE_SEC = 1e-3;

/** The time to give the clip's <video> so it shows the moment the signature is at. */
export function clipTimeAt(s: number, trim: Trim, analysisFps: number, nativeFps: number): number {
  return (
    clampPlayhead(clipTimeForSignature(s, trim, analysisFps), trim, nativeFps) + SEEK_NUDGE_SEC
  );
}

/** While it runs, the clip is put back in step when it is this far out (seconds of clip). */
export const FOLLOW_TOLERANCE_SEC = 0.15;
/** Closer than this, the clip runs at exactly the composition's speed. */
export const FOLLOW_DEADBAND_SEC = 0.02;
/** Share of its speed the clip gains or loses per second it is out of step… */
export const FOLLOW_GAIN = 1.5;
/** …at most this share. */
export const FOLLOW_MAX_NUDGE = 0.1;

export interface ClipFollowInput {
  /** Where the clip should be (`clipTimeAt`). */
  target: number;
  /** Where its <video> is. */
  currentTime: number;
  /** The <video> ran to the very end of its file. */
  ended: boolean;
  playing: boolean;
  direction: SignatureMoment['direction'];
  /** The composition's speed. */
  speed: number;
  nativeFps: number;
}

export interface ClipFollowPlan {
  /** Let the clip run by itself at `rate`; otherwise it is held on one frame. */
  run: boolean;
  rate: number;
  /** Move the clip here first; null leaves it where it is. */
  seekTo: number | null;
}

/**
 * How the clip's <video> follows the playhead. Playing forwards it runs by itself, eased
 * faster or slower to stay in step and moved outright only when far out (a loop coming
 * round, a seek). A <video> can't run backwards, so on a backwards pass, as when paused or
 * at rest, it is held on the exact frame and moved frame by frame.
 */
export function planClipFollow(input: ClipFollowInput): ClipFollowPlan {
  const { target, currentTime, speed } = input;
  const behind = target - currentTime;
  if (!input.playing || input.direction <= 0) {
    const off = Math.abs(behind) > 0.5 * frameDuration(input.nativeFps);
    return { run: false, rate: speed, seekTo: off ? target : null };
  }
  if (Math.abs(behind) > FOLLOW_TOLERANCE_SEC) return { run: true, rate: speed, seekTo: target };
  // On its last frame: starting it again would jump to its first. It waits for the loop.
  if (input.ended) return { run: false, rate: speed, seekTo: null };
  const nudge =
    Math.abs(behind) < FOLLOW_DEADBAND_SEC
      ? 0
      : clampTo(behind * FOLLOW_GAIN, -FOLLOW_MAX_NUDGE, FOLLOW_MAX_NUDGE);
  return { run: true, rate: speed * (1 + nudge), seekTo: null };
}

// -----------------------------------------------------------------------------------------
// Place

/** What a signature remembers of its clip's shape (`KineticSignature.source`). */
export interface ClipShape {
  /** Displayed size, after the file's own rotation. */
  width: number;
  height: number;
  rotate: Rotation;
  mirror: boolean;
  focusArea: FocusArea | null;
}

export interface ClipLayerGeometry {
  /** The whole clip as turned and mirrored, in the layer's pixels (the layer covers the canvas). */
  frame: { left: number; top: number; width: number; height: number };
  /** The <video>'s own box before it is turned, centred in the frame. */
  video: { width: number; height: number };
  /** CSS transform that turns and mirrors the video as extraction did. */
  transform: string;
}

/**
 * Where the clip sits in a layer covering the canvas, so the part of it the signature was
 * read from (the focus area, or the whole frame) lies exactly on the rectangle the
 * material projects the movement onto. The rest of the clip spills around that rectangle
 * and is cut off by the layer's edge.
 */
export function clipLayerGeometry(
  layerWidth: number,
  layerHeight: number,
  shape: ClipShape,
  grid: { cols: number; rows: number },
  range: number,
): ClipLayerGeometry {
  const w = Math.max(0, layerWidth);
  const h = Math.max(0, layerHeight);
  const field = projectField(range, grid.cols / grid.rows, w > 0 && h > 0 ? w / h : 1);
  const fieldWidth = field.width * w;
  const fieldHeight = field.height * h;
  const fieldLeft = field.x * w;
  // The projection's origin is the bottom left; the layer's is the top left.
  const fieldTop = (1 - field.y - field.height) * h;

  const oriented = orientedSize(shape.width, shape.height, shape.rotate);
  const sized = oriented.width > 0 && oriented.height > 0;
  const crop = sized
    ? focusCropPx(shape.focusArea, oriented.width, oriented.height)
    : { left: 0, top: 0, width: 1, height: 1 };
  const total = sized ? oriented : { width: 1, height: 1 };
  const width = (fieldWidth * total.width) / crop.width;
  const height = (fieldHeight * total.height) / crop.height;
  const quarter = shape.rotate === 90 || shape.rotate === 270;
  return {
    frame: {
      left: fieldLeft - (crop.left / total.width) * width,
      top: fieldTop - (crop.top / total.height) * height,
      width,
      height,
    },
    video: quarter ? { width: height, height: width } : { width, height },
    transform: orientationTransform({ rotate: shape.rotate, mirror: shape.mirror }),
  };
}

/** Range when a material has no such property: the movement fitted inside the canvas. */
export const FITTED_RANGE = 0.5;

/** The Range the visual material projects the movement with. */
export function projectionRange(
  properties: PropertyValues,
  meta: Pick<MaterialMeta, 'properties'> | undefined,
): number {
  const def = meta?.properties.find((p) => p.id === 'range');
  return def ? readProperty(properties, def) : FITTED_RANGE;
}
