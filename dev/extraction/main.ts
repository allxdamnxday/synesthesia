/**
 * Extraction harness (developer page, not part of the instrument).
 *
 * For automated tests it exposes:
 *   window.spExtract(url, options?)      → signature body (fetches the clip, runs extraction)
 *   window.spProbe(url)                  → ClipInfo
 *   window.spCancelDuring(url)           → what happened when cancel() was called mid-way
 *   window.spLastRun                     → timings of the last spExtract call
 *
 * For people: pick a clip, optionally set a focus area, extract, and see a summary and the
 * signature's average field drawn as arrows (no source pixels are shown).
 */
import {
  ExtractionCancelled,
  probeClip,
  setOpenCvUrl,
  startExtraction,
  type ClipInfo,
  type ExtractionJob,
  type ExtractionPhase,
  type SignatureBody,
} from '../../src/signature/extractClient';
import { decodeField } from '../../src/signature/fieldCodec';
import { DEFAULT_EXTRACTION_OPTIONS, type ExtractionOptions } from '../../src/signature/types';

// This page lives at <root>/dev/extraction/; public/ files are served from <root>/.
setOpenCvUrl(new URL('../../vendor/opencv/opencv.js', document.baseURI).href);

export interface RunTiming {
  totalMs: number;
  /** Time from the start to the first progress message of each phase. */
  phaseStartMs: Partial<Record<ExtractionPhase, number>>;
  /** Time spent from the first 'reading' message to the first 'finishing' message. */
  framesMs: number;
  analysisFrames: number;
  msPerFrame: number;
}

export interface CancelOutcome {
  errorName: string;
  isExtractionCancelled: boolean;
  doneWhenCancelled: number;
  totalWhenCancelled: number;
}

declare global {
  interface Window {
    spExtract: (url: string, options?: Partial<ExtractionOptions>) => Promise<SignatureBody>;
    spProbe: (url: string) => Promise<ClipInfo>;
    spCancelDuring: (url: string) => Promise<CancelOutcome>;
    spLastRun: RunTiming | null;
  }
}

async function fileFromUrl(url: string): Promise<File> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  const blob = await response.blob();
  const name = new URL(url, document.baseURI).pathname.split('/').pop() ?? 'clip.mp4';
  return new File([blob], name, { type: blob.type || 'video/mp4' });
}

async function fullOptions(
  file: File,
  options: Partial<ExtractionOptions>,
): Promise<ExtractionOptions> {
  const info = await probeClip(file);
  return {
    ...DEFAULT_EXTRACTION_OPTIONS,
    trim: { startSec: 0, endSec: info.durationSec },
    ...options,
  };
}

async function extractFile(
  file: File,
  options: Partial<ExtractionOptions>,
  onPhase?: (phase: ExtractionPhase, done: number, total: number) => void,
): Promise<SignatureBody> {
  const full = await fullOptions(file, options);
  const phaseStartMs: Partial<Record<ExtractionPhase, number>> = {};
  const t0 = performance.now();
  const job = startExtraction({ file, options: full, preferredSpeed: 1 }, (p) => {
    phaseStartMs[p.phase] ??= performance.now() - t0;
    onPhase?.(p.phase, p.done, p.total);
  });
  const body = await job.result;
  const totalMs = performance.now() - t0;
  const framesMs = (phaseStartMs.finishing ?? totalMs) - (phaseStartMs.reading ?? 0);
  window.spLastRun = {
    totalMs,
    phaseStartMs,
    framesMs,
    analysisFrames: body.frameCount + 1,
    msPerFrame: framesMs / (body.frameCount + 1),
  };
  return body;
}

window.spLastRun = null;
window.spExtract = async (url, options = {}) => extractFile(await fileFromUrl(url), options);
window.spProbe = async (url) => probeClip(await fileFromUrl(url));
window.spCancelDuring = async (url) => {
  const file = await fileFromUrl(url);
  const options = await fullOptions(file, {});
  const outcome: CancelOutcome = {
    errorName: 'none (it finished)',
    isExtractionCancelled: false,
    doneWhenCancelled: -1,
    totalWhenCancelled: -1,
  };
  // Cancel as soon as a few frames have been analyzed.
  const job: ExtractionJob = startExtraction({ file, options, preferredSpeed: 1 }, (p) => {
    if (p.phase === 'analyzing' && p.done >= 3 && outcome.doneWhenCancelled < 0) {
      outcome.doneWhenCancelled = p.done;
      outcome.totalWhenCancelled = p.total;
      job.cancel();
    }
  });
  try {
    await job.result;
  } catch (error) {
    outcome.errorName = error instanceof Error ? error.name : String(error);
    outcome.isExtractionCancelled = error instanceof ExtractionCancelled;
  }
  return outcome;
};

// ---- Manual use -----------------------------------------------------------------------

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};

/**
 * One arrow per cell: pointing along the cell's strongest movement over the signature,
 * with length and opacity following its mean speed. Shows where the movement is.
 */
function drawMeanField(canvas: HTMLCanvasElement, body: SignatureBody): void {
  const { cols, rows } = body.grid;
  const field = decodeField(body.field.data);
  const cells = cols * rows;
  const meanSpeed = new Float64Array(cells);
  const strongest = new Float64Array(cells * 3); // magnitude, u, v
  for (let f = 0; f < body.frameCount; f++) {
    for (let c = 0; c < cells; c++) {
      const u = field[(f * cells + c) * 2] ?? 0;
      const v = field[(f * cells + c) * 2 + 1] ?? 0;
      const m = Math.hypot(u, v);
      meanSpeed[c] += m / body.frameCount;
      if (m > (strongest[3 * c] ?? 0)) strongest.set([m, u, v], 3 * c);
    }
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const cw = canvas.width / cols;
  const ch = canvas.height / rows;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const max = meanSpeed.reduce((a, b) => Math.max(a, b), 0);
  ctx.strokeStyle = '#7fb7c9';
  ctx.lineWidth = 1.5;
  for (let c = 0; c < cells; c++) {
    const k = max > 0 ? (meanSpeed[c] ?? 0) / max : 0;
    const [m = 0, u = 0, v = 0] = strongest.subarray(3 * c, 3 * c + 3);
    if (k < 0.02 || m === 0) continue;
    const x = ((c % cols) + 0.5) * cw;
    const y = (Math.floor(c / cols) + 0.5) * ch;
    const len = 0.9 * Math.min(cw, ch) * Math.sqrt(k);
    ctx.globalAlpha = 0.3 + 0.7 * k;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (u / m) * len, y + (v / m) * len);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function summarize(body: SignatureBody): string {
  const s = (name: string) => body.stats[name];
  const lines = [
    `${body.source.fileName}: ${body.frameCount} field frames at ${body.frameRate.toFixed(3)} fps, grid ${body.grid.cols}×${body.grid.rows}`,
    `noise floor ${body.extraction.noiseFloor.toExponential(3)} (${body.extraction.noiseFloorMode}), smoothing ${body.extraction.temporalSmoothingFrames}`,
    `energy mean ${s('energy')?.mean.toFixed(4)} p95 ${s('energy')?.p95.toFixed(4)}; density mean ${s('density')?.mean.toFixed(3)}`,
    `divergence mean ${s('divergence')?.mean.toFixed(4)}; curl mean ${s('curl')?.mean.toFixed(4)}; coherence mean ${s('coherence')?.mean.toFixed(3)}`,
    `onsets at frames ${body.features.onsets.join(', ') || 'none'}`,
    `content hash ${body.contentHash}`,
  ];
  const run = window.spLastRun;
  if (run) {
    lines.push(
      `took ${(run.totalMs / 1000).toFixed(2)} s (${run.msPerFrame.toFixed(1)} ms per analysis frame)`,
    );
  }
  return lines.join('\n');
}

$('extract').addEventListener('click', () => {
  const input = $<HTMLInputElement>('file');
  const file = input.files?.[0];
  if (!file) return;
  const status = $('status');
  const num = (id: string) => Number($<HTMLInputElement>(id).value);
  const useFocus = $<HTMLInputElement>('use-focus').checked;
  const options: Partial<ExtractionOptions> = {
    focusArea: useFocus ? { x: num('fx'), y: num('fy'), w: num('fw'), h: num('fh') } : null,
  };
  status.textContent = 'Starting…';
  extractFile(file, options, (phase, done, total) => {
    status.textContent = `${phase} ${done}/${total}`;
  })
    .then((body) => {
      status.textContent = 'Done.';
      $('summary').textContent = summarize(body);
      drawMeanField($<HTMLCanvasElement>('field'), body);
    })
    .catch((error: unknown) => {
      status.textContent =
        error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    });
});
