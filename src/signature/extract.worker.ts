/**
 * Extraction worker (SPEC 7.4, 8.1): load OpenCV → open the clip → decode each analysis
 * frame → optical flow for each consecutive pair → pool to the grid → noise floor →
 * smoothing → features → stats → hash. Posts progress, then the signature body or a
 * typed error. The client keeps one worker alive between jobs, so OpenCV loads once;
 * cancelling terminates the worker.
 */
import { openClip, type OpenedClip } from './clipInfo';
import {
  CLIP_FORMAT_MESSAGE,
  EXTRACTION_FAILED_MESSAGE,
  ExtractionFailure,
  describeError,
  toWireError,
  type ExtractRequestMessage,
  type ExtractionPhase,
  type WorkerRequest,
  type WorkerResponse,
} from './extractProtocol';
import { grayFrames, planFrames } from './frames';
import { FarnebackFlow, loadOpenCv } from './opencv';
import { finishSignature } from './pipeline';
import { gridSize, poolFlow } from './pool';

function post(message: WorkerResponse): void {
  self.postMessage(message);
}

/** Progress for one job, at most about 100 messages per phase. */
function progressReporter(
  jobId: number,
): (phase: ExtractionPhase, done: number, total: number) => void {
  let lastPhase: ExtractionPhase | null = null;
  let lastDone = -1;
  return (phase, done, total) => {
    const step = Math.max(1, Math.floor(total / 100));
    if (phase === lastPhase && done !== total && done - lastDone < step) return;
    lastPhase = phase;
    lastDone = done;
    post({ type: 'progress', jobId, phase, done, total });
  };
}

async function extract(request: ExtractRequestMessage): Promise<void> {
  const { jobId, file, options } = request;
  const progress = progressReporter(jobId);
  let clip: OpenedClip | null = null;
  let engine: FarnebackFlow | null = null;
  try {
    progress('loading', 0, 1);
    // Start loading OpenCV while the clip is checked; a bad clip is reported at once.
    const opencv = loadOpenCv(request.opencvUrl);
    opencv.catch(() => undefined);
    clip = await openClip(file, file.name);
    if (!clip.info.canDecode) {
      throw new ExtractionFailure('format', CLIP_FORMAT_MESSAGE, `codec ${clip.info.codec ?? '?'}`);
    }
    const plan = planFrames(clip, options);
    const { cv } = await opencv.catch((error: unknown) => {
      throw new ExtractionFailure(
        'failed',
        EXTRACTION_FAILED_MESSAGE,
        `OpenCV: ${describeError(error)}`,
      );
    });
    progress('loading', 1, 1);

    const { width, height, fps, timestamps } = plan;
    const grid = gridSize(options.gridCols, width, height);
    const cells = grid.cols * grid.rows;
    const frameCount = timestamps.length - 1;
    const raw = new Float32Array(frameCount * cells * 2);
    engine = new FarnebackFlow(cv, width, height, options.farneback);

    progress('reading', 0, 1);
    let index = 0;
    for await (const gray of grayFrames(clip, plan)) {
      if (index === 0) progress('reading', 1, 1);
      const flow = engine.push(gray);
      if (flow) {
        const out = raw.subarray((index - 1) * cells * 2, index * cells * 2);
        poolFlow(flow, width, height, grid.cols, grid.rows, fps, out);
        progress('analyzing', index, frameCount);
      }
      index++;
    }
    if (index !== timestamps.length) {
      throw new ExtractionFailure(
        'failed',
        EXTRACTION_FAILED_MESSAGE,
        `Decoded ${index} of ${timestamps.length} frames`,
      );
    }
    engine.dispose();
    engine = null;
    const info = clip.info;
    clip.dispose();
    clip = null;

    progress('finishing', 0, 1);
    const body = await finishSignature({
      raw: { field: raw, frameCount, cols: grid.cols, rows: grid.rows, fps },
      options,
      // The option names the longer side of the analysis frame (see analysisSize()).
      analysisWidth: Math.max(width, height),
      source: {
        fileName: file.name,
        nativeFps: info.nativeFps,
        width: info.width,
        height: info.height,
        trim: plan.trim,
        rotate: options.rotate,
        mirror: options.mirror,
        focusArea: options.focusArea ? { ...options.focusArea } : null,
      },
      preferredSpeed: request.preferredSpeed,
    });
    progress('finishing', 1, 1);
    post({ type: 'result', jobId, body });
  } catch (error) {
    post({ type: 'error', jobId, error: toWireError(error) });
  } finally {
    engine?.dispose();
    clip?.dispose();
  }
}

// One job at a time, in arrival order.
let queue: Promise<void> = Promise.resolve();

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type !== 'extract') return;
  queue = queue.then(() => extract(request));
};
