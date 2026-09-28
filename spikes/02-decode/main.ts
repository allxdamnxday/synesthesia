/**
 * Spike 2 page: frame-accurate decode with Mediabunny (SPEC 16, M0 spike 2).
 * Runs the checks in a module worker (the plan), then the same checks on the main thread
 * (SPEC 7.4's fallback) for comparison.
 */
import { Report, environmentLines, fmt } from '../01-opencv/report';
import hevcMovUrl from '../fixtures/hevc-30fps.mov?url';
import h264MovUrl from '../fixtures/h264-30fps.mov?url';
import h264Mp4Url from '../fixtures/h264-30fps.mp4?url';
import portraitUrl from '../fixtures/portrait-2997-rot90.mov?url';
import {
  checkClip,
  collectGarbage,
  watchUnclosedWarnings,
  type ClipResult,
  type ClipSpec,
} from './checks';
import type { DecodeRequest, DecodeResponse } from './protocol';

const unclosedOnMain = watchUnclosedWarnings();

const absolute = (url: string): string => new URL(url, document.baseURI).href;

const CLIPS: ClipSpec[] = [
  {
    name: 'H.264 MP4 30 fps',
    url: absolute(h264Mp4Url),
    fps: 30,
    frames: 90,
    displayWidth: 640,
    displayHeight: 360,
    rotation: 0,
  },
  {
    name: 'H.264 MOV 30 fps',
    url: absolute(h264MovUrl),
    fps: 30,
    frames: 90,
    displayWidth: 640,
    displayHeight: 360,
    rotation: 0,
  },
  {
    name: 'H.264 MOV 29.97 fps portrait (rotation 90)',
    url: absolute(portraitUrl),
    fps: 30000 / 1001,
    frames: 90,
    displayWidth: 360,
    displayHeight: 640,
    rotation: 90,
  },
  {
    name: 'HEVC MOV 30 fps',
    url: absolute(hevcMovUrl),
    fps: 30,
    frames: 90,
    displayWidth: 640,
    displayHeight: 360,
    rotation: 0,
  },
];

const report = new Report('Spike 2: frame-accurate decode with Mediabunny');

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);
const same = (a: (number | null)[], b: number[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);
const describe = (seq: (number | null)[]): string => {
  const bad = seq.map((x, i) => [i, x] as const).filter(([i, x]) => x !== i);
  return bad.length === 0
    ? `${seq.length} frames, indices 0…${seq.length - 1} in order`
    : `${seq.length} frames; first mismatches: ${bad
        .slice(0, 5)
        .map(([i, x]) => `#${i}→${x === null ? 'unreadable' : x}`)
        .join(', ')}`;
};

/** Add the full set of rows for one clip; returns whether everything passed. */
function evaluate(where: string, spec: ClipSpec, r: ClipResult, detailed: boolean): boolean {
  const label = `${spec.name} [${where}]`;
  const expected = range(spec.frames);
  if (r.error) {
    report.add(`${label}: decodes`, false, r.error);
    return false;
  }
  const meta =
    `codec ${r.codec}, canDecode ${r.canDecode}, rotation ${r.rotation}°, displayed ${r.displayWidth}×${r.displayHeight}, ` +
    `first timestamp ${fmt(r.firstTimestamp, 4)} s, duration ${fmt(r.durationSec, 4)} s, ${r.packetCount} packets, ` +
    `packet rate ${fmt(r.averagePacketRate, 4)} fps, best-guess rate ${fmt(r.bestGuessFrameRate, 4)} fps`;
  if (!r.canDecode) {
    const hevc = r.codec === 'hevc';
    report.add(
      `${label}: ${hevc ? 'HEVC reported undecodable cleanly' : 'decodes'}`,
      hevc ? 'PASS' : false,
      `${meta}. canDecode() returned false without throwing; the app shows SPEC 8.1's message.`,
    );
    return hevc;
  }
  const checks: [string, boolean, string][] = [
    [
      'rotation metadata and display size',
      r.rotation === spec.rotation &&
        r.displayWidth === spec.displayWidth &&
        r.displayHeight === spec.displayHeight,
      meta,
    ],
    ['every frame exactly once, in order', same(r.sequence, expected), describe(r.sequence)],
    [
      'timestamps match frame index',
      r.worstTimestampError < 0.001,
      `largest |timestamp − index / fps| = ${fmt(r.worstTimestampError * 1000, 4)} ms`,
    ],
    [
      '10 seeded random seeks land on the exact frame',
      r.seeks.every((s) => s.atMiddle === s.index && s.atStart === s.index),
      r.seeks.map((s) => `${s.index}→${s.atStart ?? '?'}/${s.atMiddle ?? '?'}`).join(', ') +
        ' (target→read at frame start / frame middle)',
    ],
    [
      'fixed-rate sampling at frame middles (extraction path)',
      same(r.atTimestamps, expected),
      describe(r.atTimestamps),
    ],
    [
      'CanvasSink applies rotation (320 wide, as extraction resizes)',
      same(r.canvasSink.sequence, expected) &&
        spec.displayWidth > spec.displayHeight === r.canvasSink.width > r.canvasSink.height,
      `canvas ${r.canvasSink.width}×${r.canvasSink.height}; ${describe(r.canvasSink.sequence)}`,
    ],
    [
      'every VideoSample closed',
      r.samplesOpened === r.samplesClosed,
      `${r.samplesOpened} obtained, ${r.samplesClosed} closed`,
    ],
  ];
  const allPass = checks.every(([, ok]) => ok);
  if (detailed) {
    for (const [name, ok, detail] of checks) report.add(`${label}: ${name}`, ok, detail);
  } else {
    const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
    report.add(
      `${label}: all decode checks`,
      allPass,
      failed.length === 0 ? 'every check above also passes here' : `failed: ${failed.join('; ')}`,
    );
  }
  report.add(
    `${label}: decode speed`,
    'INFO',
    `${fmt(r.decodeFps, 0)} frames/s decode only; ${fmt(r.pipelineFps, 0)} frames/s decode + rotate + resize to 320 + read pixels`,
  );
  return allPass;
}

function runInWorker(): Promise<{ results: ClipResult[]; gcForced: boolean; unclosed: number }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./decode.worker.ts', import.meta.url), { type: 'module' });
    const results: ClipResult[] = [];
    worker.onerror = (e) => reject(new Error(`Worker error: ${e.message}`));
    worker.onmessage = (event: MessageEvent<DecodeResponse>) => {
      const msg = event.data;
      if (msg.type === 'clip') results.push(msg.result);
      else if (msg.type === 'error') reject(new Error(msg.message));
      else {
        worker.terminate();
        resolve({ results, gcForced: msg.gcForced, unclosed: msg.unclosedWarnings });
      }
    };
    const request: DecodeRequest = { type: 'run', clips: CLIPS };
    worker.postMessage(request);
  });
}

async function main(): Promise<void> {
  const worker = await runInWorker();
  worker.results.forEach((r, i) => {
    const spec = CLIPS[i];
    if (spec) evaluate('worker', spec, r, true);
  });
  report.add(
    'No "garbage collected without being closed" warnings (worker)',
    worker.unclosed === 0,
    `${worker.unclosed} Mediabunny warnings after ${worker.gcForced ? 'forced' : 'no (run Chrome with --js-flags=--expose-gc to force)'} garbage collection`,
  );

  // SPEC 7.4 fallback: the same checks on the main thread.
  for (const spec of CLIPS) evaluate('main thread', spec, await checkClip(spec), false);
  const gcForced = await collectGarbage();
  report.add(
    'No "garbage collected without being closed" warnings (main thread)',
    unclosedOnMain() === 0,
    `${unclosedOnMain()} Mediabunny warnings after ${gcForced ? 'forced' : 'no'} garbage collection`,
  );
  report.finish(environmentLines());
}

main().catch((error: unknown) => {
  report.add('Spike ran to completion', false, String(error));
  report.finish(environmentLines());
});
