/**
 * Messages and errors shared by the extraction worker (`extract.worker.ts`) and its
 * main-thread client (`extractClient.ts`). Nothing here touches the DOM or worker globals.
 */
import type { SignatureBody } from './assemble';
import type { ExtractionOptions } from './types';

export type ExtractionPhase = 'loading' | 'reading' | 'analyzing' | 'finishing';

export interface ExtractionProgress {
  phase: ExtractionPhase;
  done: number;
  total: number;
}

/** SPEC 8.1 step 1's guidance for clips the browser can't decode. */
export const CLIP_FORMAT_MESSAGE =
  "This clip's format can't be read in this browser. On iPhone, set Settings > Camera > " +
  'Formats > Most Compatible and record again, or convert the clip to MP4 (H.264).';

export const CLIP_TOO_LONG_MESSAGE =
  'This clip is longer than a minute after trimming. Trim it to 60 seconds or less, then extract again.';

export const CLIP_TOO_SHORT_MESSAGE =
  'This clip is too short to hold any movement. Keep at least a few frames, then extract again.';

export const CLIP_UNREADABLE_MESSAGE =
  "The clip couldn't be read from disk. Check that the file is still there, then bring it in again.";

export const EXTRACTION_FAILED_MESSAGE =
  'Extraction stopped unexpectedly. Try again; if it happens again, restart Chrome and retry.';

export type ExtractionErrorKind = 'format' | 'too-long' | 'too-short' | 'unreadable' | 'failed';

/** An error as it crosses the worker boundary. `detail` is technical (Diagnostics only). */
export interface WireError {
  kind: ExtractionErrorKind;
  message: string;
  detail?: string;
}

/** Thrown inside the worker (and the probe) with a kind the client turns into a class. */
export class ExtractionFailure extends Error {
  readonly kind: ExtractionErrorKind;
  readonly detail: string | undefined;

  constructor(kind: ExtractionErrorKind, message: string, detail?: string) {
    super(message);
    this.name = 'ExtractionFailure';
    this.kind = kind;
    this.detail = detail;
  }
}

/** A short technical description of any thrown value. */
export function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

/** Browser errors that mean "this media can't be decoded here". */
const FORMAT_ERROR_NAMES = new Set([
  'NotSupportedError',
  'EncodingError',
  'UnsupportedInputFormatError',
]);

const READ_ERROR_NAMES = new Set(['NotReadableError', 'NotFoundError']);

/** Turn anything thrown during extraction into a WireError. */
export function toWireError(error: unknown): WireError {
  if (error instanceof ExtractionFailure) {
    return { kind: error.kind, message: error.message, detail: error.detail };
  }
  const name = error instanceof Error ? error.name : '';
  if (FORMAT_ERROR_NAMES.has(name)) {
    return { kind: 'format', message: CLIP_FORMAT_MESSAGE, detail: describeError(error) };
  }
  if (READ_ERROR_NAMES.has(name)) {
    return { kind: 'unreadable', message: CLIP_UNREADABLE_MESSAGE, detail: describeError(error) };
  }
  return { kind: 'failed', message: EXTRACTION_FAILED_MESSAGE, detail: describeError(error) };
}

export interface ExtractRequestMessage {
  type: 'extract';
  jobId: number;
  file: File;
  options: ExtractionOptions;
  preferredSpeed: number;
  /** Absolute URL of opencv.js (resolved on the main thread). */
  opencvUrl: string;
}

export type WorkerRequest = ExtractRequestMessage;

export type WorkerResponse =
  | ({ type: 'progress'; jobId: number } & ExtractionProgress)
  | { type: 'result'; jobId: number; body: SignatureBody }
  | { type: 'error'; jobId: number; error: WireError };
