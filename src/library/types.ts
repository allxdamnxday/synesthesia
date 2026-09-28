/** Records the library keeps besides signatures and compositions themselves. */

/**
 * A lightweight list entry for a stored signature. The Library lists these so it never
 * loads whole signatures (their fields can be several megabytes) just to show names.
 */
export interface SignatureMeta {
  id: string;
  name: string;
  /** From the signature: when it was extracted. ISO 8601. */
  createdAt: string;
  /** Last change in this library (saved, renamed, restored). ISO 8601. */
  updatedAt: string;
  contentHash: string;
  frameCount: number;
  frameRate: number;
  /** One pass at speed 1, in seconds. */
  durationSec: number;
  grid: { cols: number; rows: number };
  /** Vector-field sketch as a PNG data URL; '' when it couldn't be drawn. */
  thumbnail: string;
}

/**
 * Album records arrive with Milestone 7. Until then the library stores, backs up and
 * restores them as opaque objects keyed by `id`.
 */
export interface StoredAlbum {
  id: string;
  [key: string]: unknown;
}

/** Optional source clips (off by default; unused in v0). */
export interface StoredClip {
  id: string;
  [key: string]: unknown;
}
