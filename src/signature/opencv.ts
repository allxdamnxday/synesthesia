/**
 * OpenCV.js loader and Farneback optical-flow wrapper, for use inside a worker
 * (SPEC 7.4, 8.1 steps 4–5). Spike 1 (`spikes/01-opencv/`) exercises this exact code.
 *
 * Loading: the official OpenCV.js 4.13.0 build is one UMD script with the WebAssembly
 * embedded. Module workers can't `importScripts()`, so the script is fetched and run with
 * an indirect eval; its UMD wrapper then assigns `self.cv` (it sees `importScripts` and
 * takes its web-worker branch). In a classic worker `importScripts()` is the fallback.
 *
 * `self.cv` is an Emscripten module. Depending on the build it is either a real Promise or
 * a legacy "thenable" whose `then(cb)` calls `cb(Module)`. Awaiting such a module, or
 * resolving a promise with it, loops forever: the promise machinery sees `then` again
 * and again. So the module never goes near `await`; readiness is detected through
 * `then(cb)` / `onRuntimeInitialized`, and the `then` hook is removed before the module
 * is handed out. Callers receive it wrapped in `{ cv }`.
 *
 * Every `Mat` is allocated once per flow engine and deleted in `dispose()`. Views such as
 * `mat.data` point into the wasm heap and are invalidated when the heap grows, so they
 * are re-read right before each use and never kept.
 */
import type { FarnebackParams } from './types';

/** The parts of the OpenCV.js API this project uses. */
export interface CvMat {
  readonly rows: number;
  readonly cols: number;
  /** Bytes of an 8-bit Mat (a fresh view into the wasm heap on every access). */
  readonly data: Uint8Array;
  /** Floats of a 32-bit float Mat (a fresh view into the wasm heap on every access). */
  readonly data32F: Float32Array;
  delete(): void;
  isDeleted(): boolean;
}

export interface CvSize {
  width: number;
  height: number;
}

export interface OpenCv {
  Mat: new (rows: number, cols: number, type: number) => CvMat;
  Size: new (width: number, height: number) => CvSize;
  CV_8UC1: number;
  CV_32FC2: number;
  BORDER_DEFAULT: number;
  GaussianBlur(
    src: CvMat,
    dst: CvMat,
    ksize: CvSize,
    sigmaX: number,
    sigmaY: number,
    borderType: number,
  ): void;
  calcOpticalFlowFarneback(
    prev: CvMat,
    next: CvMat,
    flow: CvMat,
    pyrScale: number,
    levels: number,
    winsize: number,
    iterations: number,
    polyN: number,
    polySigma: number,
    flags: number,
  ): void;
  /** The wasm heap (exported by this build); its buffer length is the heap size. */
  HEAPU8?: Uint8Array;
}

export type OpenCvLoadMethod = 'fetch-eval' | 'importScripts';

export type OpenCvLoadStage = 'fetched' | 'evaluated' | 'ready';

export interface OpenCvLoadOptions {
  /** Which way to run the script first. Default 'fetch-eval' (works in module workers). */
  prefer?: OpenCvLoadMethod;
  /** Give up if the runtime has not started after this long. Default 120 s. */
  timeoutMs?: number;
  /** Called as loading passes each stage (for spike timing; no clock is read here). */
  onStage?: (stage: OpenCvLoadStage, info: { bytes?: number }) => void;
}

export interface LoadedOpenCv {
  cv: OpenCv;
  method: OpenCvLoadMethod;
}

/** Emscripten module fields used to detect readiness (all optional: builds differ). */
interface EmscriptenModuleLike {
  calledRun?: boolean;
  then?: (onReady: (module: unknown) => void, onError?: (reason: unknown) => void) => unknown;
  onRuntimeInitialized?: () => void;
  onAbort?: (what: unknown) => void;
  calcOpticalFlowFarneback?: unknown;
}

type ImportScripts = (...urls: string[]) => void;

let cached: { url: string; promise: Promise<LoadedOpenCv> } | null = null;

/**
 * Load OpenCV.js once per worker. `url` must be absolute (resolve it on the main thread
 * with `new URL('vendor/opencv/opencv.js', document.baseURI).href`).
 */
export function loadOpenCv(url: string, options: OpenCvLoadOptions = {}): Promise<LoadedOpenCv> {
  if (cached && cached.url === url) return cached.promise;
  const promise = load(url, options);
  cached = { url, promise };
  // A failed load may be retried (e.g. after a network hiccup).
  promise.catch(() => {
    if (cached?.promise === promise) cached = null;
  });
  return promise;
}

async function load(url: string, options: OpenCvLoadOptions): Promise<LoadedOpenCv> {
  const method = await runScript(url, options);
  const candidate = (globalThis as { cv?: unknown }).cv;
  const cv = await waitForRuntime(candidate, options.timeoutMs ?? 120_000);
  options.onStage?.('ready', {});
  return { cv, method };
}

async function runScript(url: string, options: OpenCvLoadOptions): Promise<OpenCvLoadMethod> {
  const importScripts = (globalThis as { importScripts?: ImportScripts }).importScripts;
  const tryImportScripts = (): boolean => {
    if (typeof importScripts !== 'function') return false;
    try {
      importScripts(url); // throws TypeError in module workers
      options.onStage?.('fetched', {});
      options.onStage?.('evaluated', {});
      return true;
    } catch {
      return false;
    }
  };
  if (options.prefer === 'importScripts' && tryImportScripts()) return 'importScripts';
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Loading OpenCV failed: HTTP ${response.status} for ${url}`);
    const source = await response.text();
    options.onStage?.('fetched', { bytes: source.length });
    // Indirect eval: runs as sloppy global code, so the UMD wrapper's `this` is the
    // worker's global scope and `root.cv = factory()` lands on `self.cv`.
    const indirectEval: (code: string) => unknown = globalThis.eval;
    indirectEval(`${source}\n//# sourceURL=${url}`);
    options.onStage?.('evaluated', {});
    return 'fetch-eval';
  } catch (error) {
    if (options.prefer !== 'importScripts' && tryImportScripts()) return 'importScripts';
    throw error;
  }
}

/**
 * Wait until the Emscripten runtime is initialized, without ever awaiting the module
 * itself (see the file comment).
 */
export function waitForRuntime(candidate: unknown, timeoutMs: number): Promise<OpenCv> {
  return new Promise<OpenCv>((resolve, reject) => {
    if (!candidate || (typeof candidate !== 'object' && typeof candidate !== 'function')) {
      reject(new Error('OpenCV script ran but did not define `cv`'));
      return;
    }
    const module = candidate as EmscriptenModuleLike;
    let settled = false;
    const timer = setTimeout(() => {
      finish(new Error(`OpenCV did not start within ${Math.round(timeoutMs / 1000)} s`));
    }, timeoutMs);

    function finish(error: Error | null, ready?: unknown): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        reject(error);
        return;
      }
      const target = (ready && typeof ready === 'object' ? ready : module) as EmscriptenModuleLike &
        Record<string, unknown>;
      // Remove the self-resolving thenable before the module touches a promise.
      if (Object.prototype.hasOwnProperty.call(target, 'then')) delete target.then;
      if (typeof target.calcOpticalFlowFarneback !== 'function') {
        reject(new Error('This OpenCV build has no calcOpticalFlowFarneback'));
        return;
      }
      resolve(target as unknown as OpenCv);
    }

    const previousAbort = module.onAbort;
    module.onAbort = (what: unknown) => {
      previousAbort?.(what);
      finish(new Error(`OpenCV aborted while starting: ${String(what)}`));
    };

    if (module.calledRun === true) {
      finish(null, module);
    } else if (typeof module.then === 'function') {
      // Legacy Emscripten thenable (calls back with the module once the runtime is up) or a
      // real Promise from newer MODULARIZE builds (calls back with the resolved module).
      module.then(
        (ready) => finish(null, ready),
        (reason: unknown) => finish(reason instanceof Error ? reason : new Error(String(reason))),
      );
    } else {
      const previous = module.onRuntimeInitialized;
      module.onRuntimeInitialized = () => {
        previous?.();
        finish(null, module);
      };
    }
  });
}

/**
 * Farneback optical flow between consecutive grayscale frames of one fixed size.
 * Each frame gets the 5×5 Gaussian blur of SPEC 8.1 step 4 before flow is computed.
 */
export class FarnebackFlow {
  readonly width: number;
  readonly height: number;
  private readonly cv: OpenCv;
  private readonly params: FarnebackParams;
  private readonly input: CvMat;
  private prevBlur: CvMat;
  private nextBlur: CvMat;
  private readonly flow: CvMat;
  private readonly ksize: CvSize;
  private hasPrevious = false;
  private disposed = false;

  constructor(cv: OpenCv, width: number, height: number, params: FarnebackParams) {
    if (!(width > 0 && height > 0 && Number.isInteger(width) && Number.isInteger(height))) {
      throw new Error(`Invalid analysis frame size ${width}×${height}`);
    }
    this.cv = cv;
    this.width = width;
    this.height = height;
    this.params = params;
    this.ksize = new cv.Size(5, 5);
    const mats: CvMat[] = [];
    const alloc = (type: number): CvMat => {
      const mat = new cv.Mat(height, width, type);
      mats.push(mat);
      return mat;
    };
    try {
      this.input = alloc(cv.CV_8UC1);
      this.prevBlur = alloc(cv.CV_8UC1);
      this.nextBlur = alloc(cv.CV_8UC1);
      this.flow = alloc(cv.CV_32FC2);
    } catch (error) {
      for (const mat of mats) mat.delete();
      throw error;
    }
  }

  /**
   * Add the next grayscale frame (width × height bytes). Returns the flow from the
   * previous frame (px/frame, interleaved u, v, row-major; x right, y down), or null for
   * the first frame. The returned array is a view into the wasm heap: read it before the
   * next call to any OpenCV function.
   */
  push(gray: Uint8Array): Float32Array | null {
    if (this.disposed) throw new Error('FarnebackFlow used after dispose()');
    if (gray.length !== this.width * this.height) {
      throw new Error(`Expected ${this.width * this.height} gray bytes, got ${gray.length}`);
    }
    const cv = this.cv;
    this.input.data.set(gray);
    cv.GaussianBlur(this.input, this.nextBlur, this.ksize, 0, 0, cv.BORDER_DEFAULT);
    if (!this.hasPrevious) {
      this.swap();
      this.hasPrevious = true;
      return null;
    }
    const p = this.params;
    cv.calcOpticalFlowFarneback(
      this.prevBlur,
      this.nextBlur,
      this.flow,
      p.pyrScale,
      p.levels,
      p.winsize,
      p.iterations,
      p.polyN,
      p.polySigma,
      0,
    );
    this.swap();
    return this.flow.data32F;
  }

  /** Forget the previous frame (the next push starts a new sequence). */
  reset(): void {
    this.hasPrevious = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const mat of [this.input, this.prevBlur, this.nextBlur, this.flow]) {
      if (!mat.isDeleted()) mat.delete();
    }
  }

  private swap(): void {
    const t = this.prevBlur;
    this.prevBlur = this.nextBlur;
    this.nextBlur = t;
  }
}
