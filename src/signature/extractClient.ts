/**
 * Main-thread API for signature extraction (SPEC 6.2, 7.4, 8.1).
 *
 * - `probeClip(file)` reads a clip's duration, frame rate, size, rotation and whether this
 *   browser can decode it (Mediabunny is loaded on demand).
 * - `startExtraction(request, onProgress)` runs extraction in a worker and returns the
 *   signature body; `cancel()` stops it.
 *
 * One worker is kept alive between jobs so OpenCV.js loads once. Jobs run one at a time
 * in the order they were started. Cancelling a running job terminates the worker; the
 * next job starts a fresh one.
 */
import type { SignatureBody } from './assemble';
import type { ClipInfo } from './clipInfo';
import {
  CLIP_FORMAT_MESSAGE,
  CLIP_TOO_LONG_MESSAGE,
  EXTRACTION_FAILED_MESSAGE,
  ExtractionFailure,
  describeError,
  type ExtractionPhase,
  type ExtractionProgress,
  type WireError,
  type WorkerRequest,
  type WorkerResponse,
} from './extractProtocol';
import { MAX_CLIP_SECONDS, type ExtractionOptions } from './types';

export type { ClipInfo, ExtractionPhase, ExtractionProgress, SignatureBody };

export interface ExtractionRequest {
  file: File;
  options: ExtractionOptions;
  preferredSpeed: number;
}

export interface ExtractionJob {
  result: Promise<SignatureBody>;
  cancel(): void;
}

/** The job was cancelled with `cancel()`. */
export class ExtractionCancelled extends Error {
  constructor(message = 'Extraction was cancelled.') {
    super(message);
    this.name = 'ExtractionCancelled';
  }
}

/** The browser can't read or decode this clip. The message is SPEC 8.1's guidance. */
export class ClipFormatError extends Error {
  readonly detail: string | undefined;

  constructor(message: string = CLIP_FORMAT_MESSAGE, detail?: string) {
    super(message);
    this.name = 'ClipFormatError';
    this.detail = detail;
  }
}

/** The trimmed clip is longer than 60 seconds (SPEC 8.1 step 3). */
export class ClipTooLongError extends Error {
  readonly detail: string | undefined;

  constructor(message: string = CLIP_TOO_LONG_MESSAGE, detail?: string) {
    super(message);
    this.name = 'ClipTooLongError';
    this.detail = detail;
  }
}

/**
 * Any other failure (clip too short, file unreadable, OpenCV or decoder trouble). The
 * message is plain language; `detail` is technical, for Diagnostics.
 */
export class ExtractionError extends Error {
  readonly detail: string | undefined;

  constructor(message: string = EXTRACTION_FAILED_MESSAGE, detail?: string) {
    super(message);
    this.name = 'ExtractionError';
    this.detail = detail;
  }
}

function fromWire(error: WireError): Error {
  switch (error.kind) {
    case 'format':
      return new ClipFormatError(error.message, error.detail);
    case 'too-long':
      return new ClipTooLongError(error.message, error.detail);
    default:
      return new ExtractionError(error.message, error.detail);
  }
}

let opencvUrlOverride: string | null = null;

/**
 * Where to load OpenCV.js from. By default `vendor/opencv/opencv.js` next to the app's
 * page; pages that live elsewhere (developer harness pages) set it explicitly.
 */
export function setOpenCvUrl(url: string): void {
  opencvUrlOverride = url;
}

function opencvUrl(): string {
  return opencvUrlOverride ?? new URL('vendor/opencv/opencv.js', document.baseURI).href;
}

/** Read what Prepare needs to know about a clip. Rejects with ClipFormatError if unreadable. */
export async function probeClip(file: File): Promise<ClipInfo> {
  const { readClipInfo } = await import('./clipInfo');
  try {
    return await readClipInfo(file, file.name);
  } catch (error) {
    if (error instanceof ExtractionFailure) {
      throw fromWire({ kind: error.kind, message: error.message, detail: error.detail });
    }
    throw new ClipFormatError(CLIP_FORMAT_MESSAGE, describeError(error));
  }
}

interface RunningJob {
  onProgress: (progress: ExtractionProgress) => void;
  resolve: (body: SignatureBody) => void;
  reject: (error: Error) => void;
}

let worker: Worker | null = null;
const running = new Map<number, RunningJob>();
let nextJobId = 1;
let queue: Promise<void> = Promise.resolve();

function failAll(error: Error): void {
  const jobs = [...running.values()];
  running.clear();
  for (const job of jobs) job.reject(error);
}

function terminateWorker(): void {
  worker?.terminate();
  worker = null;
}

function getWorker(): Worker {
  if (worker) return worker;
  const created = new Worker(new URL('./extract.worker.ts', import.meta.url), { type: 'module' });
  created.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;
    const job = running.get(message.jobId);
    if (!job) return;
    if (message.type === 'progress') {
      try {
        job.onProgress({ phase: message.phase, done: message.done, total: message.total });
      } catch (error) {
        console.error('Extraction progress callback failed', error);
      }
    } else if (message.type === 'result') {
      running.delete(message.jobId);
      job.resolve(message.body);
    } else {
      running.delete(message.jobId);
      job.reject(fromWire(message.error));
    }
  };
  created.onerror = (event: ErrorEvent) => {
    event.preventDefault();
    terminateWorker();
    failAll(new ExtractionError(EXTRACTION_FAILED_MESSAGE, `Worker error: ${event.message}`));
  };
  created.onmessageerror = () => {
    terminateWorker();
    failAll(new ExtractionError(EXTRACTION_FAILED_MESSAGE, 'Worker message could not be read'));
  };
  worker = created;
  return created;
}

export function startExtraction(
  request: ExtractionRequest,
  onProgress: (progress: ExtractionProgress) => void,
): ExtractionJob {
  const jobId = nextJobId++;
  let state: 'queued' | 'running' | 'settled' = 'queued';
  let rejectQueued: ((error: Error) => void) | null = null;

  const result = new Promise<SignatureBody>((resolve, reject) => {
    const settleWith =
      <T>(fn: (value: T) => void) =>
      (value: T) => {
        state = 'settled';
        fn(value);
      };
    const resolveJob = settleWith(resolve);
    const rejectJob = settleWith(reject);
    rejectQueued = rejectJob;

    const { trim } = request.options;
    const length = trim.endSec - trim.startSec;
    if (length > MAX_CLIP_SECONDS + 1e-3) {
      rejectJob(
        new ClipTooLongError(CLIP_TOO_LONG_MESSAGE, `${length.toFixed(2)} s after trimming`),
      );
      return;
    }

    const run = (): Promise<void> => {
      if (state !== 'queued') return Promise.resolve(); // cancelled while waiting
      state = 'running';
      return new Promise<void>((done) => {
        running.set(jobId, {
          onProgress,
          resolve: (body) => {
            resolveJob(body);
            done();
          },
          reject: (error) => {
            rejectJob(error);
            done();
          },
        });
        const message: WorkerRequest = {
          type: 'extract',
          jobId,
          file: request.file,
          options: request.options,
          preferredSpeed: request.preferredSpeed,
          opencvUrl: opencvUrl(),
        };
        try {
          getWorker().postMessage(message);
        } catch (error) {
          running.delete(jobId);
          rejectJob(new ExtractionError(EXTRACTION_FAILED_MESSAGE, describeError(error)));
          done();
        }
      });
    };
    queue = queue.then(run, run);
  });

  return {
    result,
    cancel() {
      if (state === 'settled') return;
      if (state === 'queued') {
        rejectQueued?.(new ExtractionCancelled());
        return;
      }
      const job = running.get(jobId);
      running.delete(jobId);
      terminateWorker();
      job?.reject(new ExtractionCancelled());
    },
  };
}
