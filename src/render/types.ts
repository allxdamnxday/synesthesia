/**
 * The offline render's public types (SPEC 10). See src/render/index.ts for how to call it.
 */
import type { Composition, RenderFps } from '../engine/composition';
import type { Quality, SoundMaterialEntry, VisualMaterialEntry } from '../materials/types';
import type { KineticSignature } from '../signature/types';
import type { RenderProgress } from './progress';

/** Where the MP4 goes. */
export type RenderDestination =
  /** Stream straight into a folder the person chose (File System Access). */
  | { kind: 'folder'; directory: FileSystemDirectoryHandle }
  /** Build the file in memory, then hand it to the browser as a download. */
  | { kind: 'download' }
  /** Build the file in memory and return it as a Blob (harness pages and tests). */
  | { kind: 'memory' };

export type RenderDestinationKind = RenderDestination['kind'];

export interface RenderOutputOptions {
  /** Output size in pixels (even numbers; SPEC 10.1: 1280×720, 1920×1080, 1080×1080). */
  width: number;
  height: number;
  fps: RenderFps;
  /** Material quality for the render; default 'high', independent of the preview tier. */
  quality?: Quality;
  /** Peak-normalize the sound to −1 dBFS; default true. */
  normalize?: boolean;
  /** Also save the composition (`.spcomp.json`) next to the MP4; default false. */
  sidecar?: boolean;
}

/** The sound codec and bitrate, as confirmed by the capability probe (getRenderDefaults). */
export interface RenderEncoding {
  /** null: no sound codec works here, so the MP4 has no sound track. */
  audioCodec: 'aac' | 'opus' | null;
  audioBitrate: number | null;
}

/** Lets a render (or batch) be paused between frames. */
export interface PauseGate {
  /** Resolves at once when not paused, otherwise on resume; rejects if `signal` aborts. */
  wait(signal?: AbortSignal): Promise<void>;
}

export interface RenderRequest {
  composition: Composition;
  /** The composition's signature, in full (the Studio already has it loaded). */
  signature: KineticSignature;
  output: RenderOutputOptions;
  destination: RenderDestination;
  /** Abort to cancel: the render stops, cleans up, deletes its partial file and rejects. */
  signal?: AbortSignal;
  /** Called as the render moves through its phases and after every frame. */
  onProgress?: (progress: RenderProgress) => void;
  pause?: PauseGate;
  /** Sound codec and bitrate. Default: from getRenderDefaults() (probed once per page). */
  encoding?: RenderEncoding;
  /**
   * Harness pages and tests only: material entries to use instead of the registry's
   * (for example the dev-only flash and click materials in dev/render).
   */
  materials?: { visual?: VisualMaterialEntry; sound?: SoundMaterialEntry };
  /** How the frame loop gives the page a turn. Default: a message-channel task. */
  yieldToUi?: () => Promise<void>;
}

export interface RenderResult {
  /** The MP4's file name, including any " (2)" added to avoid overwriting. */
  fileName: string;
  destination: RenderDestinationKind;
  /** The folder's name for folder renders, else null. */
  folderName: string | null;
  /** The composition file saved next to the MP4, or null. */
  sidecarFileName: string | null;
  /** The composition file's text when a sidecar was requested (memory renders keep it here). */
  sidecarText: string | null;
  /** The MP4 for memory and download renders; null for folder renders. */
  blob: Blob | null;
  bytes: number;
  /** For example `video/mp4; codecs="avc1.640028, mp4a.40.2"`. */
  mimeType: string;
  width: number;
  height: number;
  fps: RenderFps;
  quality: Quality;
  frameCount: number;
  /** Length of the video, frameCount / fps (at most one frame longer than the timeline). */
  durationSec: number;
  /** Length of the composition's timeline (loops and tail included). */
  timelineSec: number;
  audio: {
    codec: 'aac' | 'opus' | null;
    bitrate: number | null;
    /** The sound field was muted, so the track is silent. */
    muted: boolean;
    normalized: boolean;
  };
  /** The visual field was muted, so every frame is black. */
  visualMuted: boolean;
  /** Plain-language notes about things that didn't go as planned but didn't stop the render. */
  warnings: string[];
}
