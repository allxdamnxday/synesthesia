/**
 * Kinetic signature types (SPEC section 8). The signature is movement-derived data only:
 * it never contains source pixels (SPEC C7).
 */

/** Per-frame features, in the order they are hashed and serialized. */
export const FEATURE_NAMES = [
  'energy',
  'peak',
  'flowX',
  'flowY',
  'direction',
  'coherence',
  'divergence',
  'curl',
  'acceleration',
  'surge',
  'jerk',
  'continuity',
  'density',
  'centroidX',
  'centroidY',
  'spread',
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];

/**
 * Signed features normalize to −1..1 by dividing by p95(|x|) (SPEC 8.2). All others
 * normalize to 0..1 with (x − p05) / (p95 − p05).
 */
export const SIGNED_FEATURES: ReadonlySet<FeatureName> = new Set<FeatureName>([
  'divergence',
  'curl',
  'surge',
  'flowX',
  'flowY',
]);

/**
 * Features that scale with movement speed. Signature strength multiplies these (and the
 * field); unitless features (direction, coherence, continuity, density, centroid, spread)
 * are unaffected.
 */
export const VELOCITY_FEATURES: ReadonlySet<FeatureName> = new Set<FeatureName>([
  'energy',
  'peak',
  'flowX',
  'flowY',
  'divergence',
  'curl',
  'acceleration',
  'surge',
  'jerk',
]);

export interface FeatureStats {
  min: number;
  max: number;
  mean: number;
  p05: number;
  p95: number;
}

/** Normalized rectangle, 0..1, in the displayed (rotated and mirrored) frame. */
export interface FocusArea {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Rotation = 0 | 90 | 180 | 270;

export interface FarnebackParams {
  pyrScale: number;
  levels: number;
  winsize: number;
  iterations: number;
  polyN: number;
  polySigma: number;
}

export const DEFAULT_FARNEBACK: Readonly<FarnebackParams> = {
  pyrScale: 0.5,
  levels: 3,
  winsize: 15,
  iterations: 3,
  polyN: 5,
  polySigma: 1.2,
};

export type SignatureFeatures = Record<FeatureName, number[]> & {
  /** Frame indices where an onset (sudden gathering of energy) begins. */
  onsets: number[];
};

/** The `.sig.json` file format, version 1 (SPEC 8.3). */
export interface KineticSignature {
  format: 'sp-signature';
  version: 1;
  /** uuid */
  id: string;
  name: string;
  /** ISO 8601 */
  createdAt: string;
  /** sha-256 hex of field + features (see src/signature/hash.ts) */
  contentHash: string;
  source: {
    fileName: string;
    nativeFps: number;
    /** Displayed size of the source clip (after its rotation metadata). */
    width: number;
    height: number;
    trim: { startSec: number; endSec: number };
    rotate: Rotation;
    mirror: boolean;
    focusArea: FocusArea | null;
  };
  /** Playback rate chosen in Prepare; default for a composition's Speed. */
  preferredSpeed: number;
  extraction: {
    method: 'farneback';
    params: FarnebackParams;
    /**
     * Longer side of the analysis frame in pixels (the name predates the rule: for a
     * portrait clip it is the analysis frame's height).
     */
    analysisWidth: number;
    noiseFloor: number;
    noiseFloorMode: 'auto' | 'manual';
    temporalSmoothingFrames: number;
  };
  /** Analysis frames per second. */
  frameRate: number;
  /** Number of field frames. Frame i describes motion from analysis frame i to i + 1. */
  frameCount: number;
  grid: { cols: number; rows: number };
  /**
   * frameCount × rows × cols × 2 float32 values (u, v), row-major, base64-encoded.
   * Units: field diagonals per second. Image coordinates: x right, y down.
   */
  field: { encoding: 'f32-base64'; data: string };
  features: SignatureFeatures;
  /** Keyed by FeatureName. */
  stats: Record<string, FeatureStats>;
}

export const SIGNATURE_FORMAT = 'sp-signature';
export const SIGNATURE_VERSION = 1;

/** How a signature is played along the composition timeline. */
export type LoopMode = 'loop' | 'pingpong';

export interface SamplerConfig {
  /** Playback rate, 0.25–2. */
  speed: number;
  /** Number of passes, 1–8. */
  loops: number;
  /** Seconds of settling after the movement ends, 0–10. */
  tailSec: number;
  loopMode: LoopMode;
  /** Global smoothing, 0–1 (zero-phase moving average, window up to ~0.5 s). */
  smoothing: number;
  /**
   * Signature strength (gain), 0–3. Multiplies the field and the velocity features
   * (VELOCITY_FEATURES). Extension to SPEC 8.4's configure(); see DECISIONS.
   */
  strength: number;
}

export const DEFAULT_SAMPLER_CONFIG: Readonly<SamplerConfig> = {
  speed: 1,
  loops: 1,
  tailSec: 3,
  loopMode: 'loop',
  smoothing: 0.2,
  strength: 1,
};

export interface SignatureFrame {
  /** Composition time in seconds. */
  t: number;
  cols: number;
  rows: number;
  /** Interpolated (u, v) grid, rows × cols × 2; zeros during the tail. */
  field: Float32Array;
  /** Raw feature values (after strength). */
  features: Record<FeatureName, number>;
  /** 0..1, or −1..1 for SIGNED_FEATURES. */
  normalized: Record<FeatureName, number>;
  inTail: boolean;
}

export interface SignatureSampler {
  /** Full composition timeline in seconds, including loops and tail. */
  readonly duration: number;
  /** One pass of the signature at speed 1, in seconds. */
  readonly signatureDuration: number;
  readonly config: Readonly<SamplerConfig>;
  configure(opts: Partial<SamplerConfig>): void;
  /**
   * Random access and pure: the result depends only on t and the configuration.
   * The returned frame (and its arrays) is reused by the next call; copy what you keep.
   */
  sample(t: number): SignatureFrame;
  /** Composition times of onsets in [t0, t1), across loops, excluding the tail. */
  onsetsBetween(t0: number, t1: number): number[];
}

/** Options chosen on the Prepare screen that shape extraction (SPEC 8.1). */
export interface ExtractionOptions {
  trim: { startSec: number; endSec: number };
  rotate: Rotation;
  mirror: boolean;
  focusArea: FocusArea | null;
  /**
   * Analysis frame size in pixels, applied to the **longer side** of the oriented,
   * cropped frame (default 320; Advanced). Portrait 1080×1920 → 180×320.
   */
  analysisWidth: number;
  /** Grid columns (default 32; Advanced). Rows follow the aspect ratio, clamped 8–48. */
  gridCols: number;
  noiseFloorMode: 'auto' | 'manual';
  /** Used when noiseFloorMode is 'manual'; field diagonals per second. */
  manualNoiseFloor: number;
  /** Centered moving-average window in frames: 1, 3, 5, 7 or 9 (default 3). */
  temporalSmoothingFrames: number;
  farneback: FarnebackParams;
}

export const DEFAULT_EXTRACTION_OPTIONS: Readonly<Omit<ExtractionOptions, 'trim'>> = {
  rotate: 0,
  mirror: false,
  focusArea: null,
  analysisWidth: 320,
  gridCols: 32,
  noiseFloorMode: 'auto',
  manualNoiseFloor: 0.01,
  temporalSmoothingFrames: 3,
  farneback: DEFAULT_FARNEBACK,
};

/** Longest clip (after trimming) that extraction accepts, in seconds. */
export const MAX_CLIP_SECONDS = 60;
/** Highest analysis frame rate. */
export const MAX_ANALYSIS_FPS = 60;
/**
 * Lowest noise floor (field diagonals per second). Keeps the soft threshold well
 * defined on perfectly still synthetic clips. About 0.012 px/frame at 320 px, 30 fps.
 */
export const MIN_NOISE_FLOOR = 1e-3;
