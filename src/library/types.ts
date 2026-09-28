/** Records the library keeps besides signatures and compositions themselves. */
import type { Album } from '../chance/albumModel';

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
 * A placeholder album record from before albums had a file format (builds before
 * Milestone 7 stored albums as opaque objects keyed by `id`, and a backup made then can
 * still carry one). It is kept exactly as it is, never shown, and never thrown away.
 */
export interface LegacyAlbumRecord {
  id: string;
  [key: string]: unknown;
}

/**
 * What the `albums` store holds: `Album` records (SPEC 11.3, 12.3; `src/chance/albumModel.ts`),
 * checked on the way in. Readers still validate each record (see `src/library/albums.ts`),
 * because a legacy placeholder may sit beside them.
 */
export type StoredAlbum = Album | LegacyAlbumRecord;

/** Optional source clips (off by default; unused in v0). */
export interface StoredClip {
  id: string;
  [key: string]: unknown;
}
