import { describe, expect, it } from 'vitest';
import type { Composition } from '../../src/engine/composition';
import {
  RenderCancelledError,
  RenderError,
  isRenderCancelled,
  renderMessage,
  toRenderError,
  type RenderErrorCode,
} from '../../src/render/errors';
import { renderBatch, type BatchTrack } from '../../src/render/batch';
import { createPauseController } from '../../src/render/pause';
import {
  EtaEstimator,
  FINISH_SHARE,
  SOUND_SHARE,
  batchFraction,
  formatLength,
  formatTimeLeft,
  planBatch,
  progressFraction,
  type RenderProgress,
} from '../../src/render/progress';
import type { RenderRequest, RenderResult } from '../../src/render/types';
import type { KineticSignature } from '../../src/signature/types';

describe('progress fraction', () => {
  const at = (phase: RenderProgress['phase'], framesDone = 0): number =>
    progressFraction({ phase, framesDone, frameCount: 100 });

  it('moves from 0 to 1 through the phases and never goes back', () => {
    const sequence = [
      at('starting'),
      at('sound'),
      at('frames', 0),
      at('frames', 1),
      at('frames', 50),
      at('frames', 100),
      at('finishing', 100),
      at('done', 100),
    ];
    expect(sequence[0]).toBe(0);
    expect(sequence[sequence.length - 1]).toBe(1);
    for (let i = 1; i < sequence.length; i++) {
      expect(sequence[i]).toBeGreaterThanOrEqual(sequence[i - 1] ?? 0);
    }
    expect(at('frames', 0)).toBeCloseTo(SOUND_SHARE, 12);
    expect(at('frames', 100)).toBeCloseTo(1 - FINISH_SHARE, 12);
    expect(at('frames', 50)).toBeCloseTo(SOUND_SHARE + (1 - SOUND_SHARE - FINISH_SHARE) / 2, 12);
  });

  it('clamps odd inputs', () => {
    expect(progressFraction({ phase: 'frames', framesDone: 500, frameCount: 100 })).toBeCloseTo(
      1 - FINISH_SHARE,
    );
    expect(progressFraction({ phase: 'frames', framesDone: 5, frameCount: 0 })).toBeCloseTo(
      SOUND_SHARE,
    );
  });

  it('weighs batch tracks by their frames', () => {
    const plan = planBatch([100, 300, 0, Number.NaN]);
    expect(plan.totalFrames).toBe(400);
    expect(batchFraction(plan, 0, 0)).toBe(0);
    expect(batchFraction(plan, 0, 1)).toBe(0.25);
    expect(batchFraction(plan, 1, 0.5)).toBe(0.625);
    expect(batchFraction(plan, 3, 1)).toBe(1);
    expect(batchFraction(planBatch([]), 0, 1)).toBe(0);
  });
});

describe('time left', () => {
  it('stays quiet until the first frames are done and a second has passed', () => {
    const eta = new EtaEstimator();
    expect(eta.remainingMs()).toBeNull();
    eta.update(0, 0, 300);
    eta.update(100, 10, 300);
    expect(eta.remainingMs()).toBeNull(); // only 0.1 s in
    eta.update(1000, 100, 300);
    expect(eta.remainingMs()).toBeCloseTo(2000, 6); // 10 ms per frame, 200 to go
  });

  it('needs a few frames even when time has passed', () => {
    const eta = new EtaEstimator({ minFrames: 5 });
    eta.update(0, 0, 100);
    eta.update(3000, 2, 100);
    expect(eta.remainingMs()).toBeNull();
    eta.update(4000, 5, 100);
    expect(eta.remainingMs()).toBeCloseTo(76_000, 6);
  });

  it('follows the recent pace, not the slow start', () => {
    const eta = new EtaEstimator({ windowMs: 2000 });
    eta.update(0, 0, 1000);
    eta.update(5000, 10, 1000); // slow start: 500 ms per frame
    for (let t = 5100; t <= 9000; t += 100) eta.update(t, 10 + (t - 5000) / 10, 1000); // 10 ms/frame
    const remaining = eta.remainingMs();
    expect(remaining).not.toBeNull();
    // 400 frames done, 600 left at ~10 ms each.
    expect(remaining ?? 0).toBeGreaterThan(5000);
    expect(remaining ?? 0).toBeLessThan(7000);
  });

  it('starts over when a new render begins', () => {
    const eta = new EtaEstimator();
    eta.update(0, 0, 100);
    eta.update(2000, 50, 100);
    expect(eta.remainingMs()).not.toBeNull();
    eta.update(2100, 0, 200); // frames went back: a new render
    expect(eta.remainingMs()).toBeNull();
  });

  it('says it in plain words', () => {
    expect(formatTimeLeft(0)).toBe('A few seconds left');
    expect(formatTimeLeft(9_000)).toBe('A few seconds left');
    expect(formatTimeLeft(12_000)).toBe('About 10 seconds left');
    expect(formatTimeLeft(43_000)).toBe('About 45 seconds left');
    expect(formatTimeLeft(56_000)).toBe('About a minute left');
    expect(formatTimeLeft(89_000)).toBe('About a minute left');
    expect(formatTimeLeft(150_000)).toBe('About 3 minutes left');
    expect(formatTimeLeft(59 * 60_000)).toBe('About 59 minutes left');
    expect(formatTimeLeft(60 * 60_000)).toBe('About 1 hour left');
    expect(formatTimeLeft(80 * 60_000)).toBe('About 1 hour 20 minutes left');
    expect(formatTimeLeft(119 * 60_000)).toBe('About 2 hours left');
    expect(formatTimeLeft(-5)).toBe('A few seconds left');
  });

  it('describes lengths for people', () => {
    expect(formatLength(5.2)).toBe('5.2 seconds');
    expect(formatLength(5)).toBe('5 seconds');
    expect(formatLength(1)).toBe('1 second');
    expect(formatLength(0.04)).toBe('0 seconds');
    expect(formatLength(59.97)).toBe('1 minute');
    expect(formatLength(72)).toBe('1 minute 12 seconds');
    expect(formatLength(121)).toBe('2 minutes 1 second');
    expect(formatLength(180)).toBe('3 minutes');
  });
});

describe('render errors', () => {
  it('recognises cancellation however it arrives', () => {
    expect(isRenderCancelled(new RenderCancelledError())).toBe(true);
    expect(isRenderCancelled(new DOMException('stop', 'AbortError'))).toBe(true);
    expect(isRenderCancelled(new Error('boom'))).toBe(false);
    expect(isRenderCancelled('AbortError')).toBe(false);
  });

  it('turns browser errors into plain messages', () => {
    const code = (error: unknown, stage: Parameters<typeof toRenderError>[1], folder?: string) =>
      toRenderError(error, stage, folder ?? null).code;
    expect(code(new DOMException('full', 'QuotaExceededError'), 'frames', 'Renders')).toBe(
      'disk-full',
    );
    expect(code(new DOMException('gone', 'NotFoundError'), 'saving', 'Renders')).toBe(
      'folder-missing',
    );
    expect(code(new DOMException('no', 'NotAllowedError'), 'saving', 'Renders')).toBe(
      'folder-permission',
    );
    expect(code(new Error('odd'), 'saving', 'Renders')).toBe('write-failed');
    expect(code(new DOMException('enc', 'EncodingError'), 'frames')).toBe('encoder-failed');
    expect(code(new DOMException('cfg', 'NotSupportedError'), 'frames')).toBe('encoder-failed');
    expect(code(new Error('odd'), 'frames')).toBe('unknown');
    expect(code(new Error('odd'), 'sound')).toBe('sound-failed');
    expect(code(new Error('odd'), 'setup')).toBe('unknown');
    const passthrough = new RenderError('gpu-lost', 'x');
    expect(toRenderError(passthrough, 'frames')).toBe(passthrough);
  });

  it('names the folder and says what to do next', () => {
    expect(renderMessage('folder-missing', 'Renders')).toContain('“Renders”');
    expect(renderMessage('folder-missing', 'Renders')).toContain('Choose a folder again');
    expect(renderMessage('material-missing', 'honey')).toContain('“honey”');
    const codes: RenderErrorCode[] = [
      'no-webgl',
      'gpu-lost',
      'no-video',
      'encoder-failed',
      'sound-failed',
      'material-missing',
      'folder-missing',
      'folder-permission',
      'disk-full',
      'write-failed',
      'unknown',
    ];
    for (const c of codes) {
      const message = renderMessage(c);
      expect(message.length).toBeGreaterThan(20);
      expect(message).not.toMatch(/sorry|oops|codec|WebGL|fps/i);
    }
  });
});

describe('pause controller', () => {
  it('waits while paused and lets go on resume', async () => {
    const pause = createPauseController();
    await pause.wait(); // not paused: resolves at once
    pause.pause();
    expect(pause.paused).toBe(true);
    let released = false;
    const waiting = pause.wait().then(() => {
      released = true;
    });
    await Promise.resolve();
    expect(released).toBe(false);
    pause.resume();
    await waiting;
    expect(released).toBe(true);
  });

  it('rejects a paused wait when cancelled', async () => {
    const pause = createPauseController();
    const controller = new AbortController();
    pause.pause();
    const waiting = pause.wait(controller.signal);
    controller.abort();
    await expect(waiting).rejects.toBeInstanceOf(RenderCancelledError);
    await expect(pause.wait(controller.signal)).rejects.toBeInstanceOf(RenderCancelledError);
  });
});

describe('batch render', () => {
  const signature = { name: 'Wink' } as KineticSignature;
  const track = (name: string): BatchTrack => ({
    composition: { name, seed: 1 } as Composition,
    signature,
  });
  const fakeResult = (request: RenderRequest): RenderResult =>
    ({ fileName: `${request.composition.name}.mp4` }) as RenderResult;
  const encoding = () => Promise.resolve({ audioCodec: 'aac' as const, audioBitrate: 192_000 });
  /** A render stand-in that settles on a later microtask, like a real render. */
  const later =
    (fn: (request: RenderRequest) => RenderResult) =>
    (request: RenderRequest): Promise<RenderResult> =>
      Promise.resolve().then(() => fn(request));

  it('renders every track in order with shared settings and reports each', async () => {
    const seen: string[] = [];
    const events: string[] = [];
    const summary = await renderBatch({
      tracks: [track('01'), track('02'), track('03')],
      output: { width: 1280, height: 720, fps: 30, sidecar: true },
      destination: { kind: 'memory' },
      resolveEncoding: encoding,
      render: later((request) => {
        seen.push(`${request.composition.name} ${request.output.width} ${request.output.sidecar}`);
        request.onProgress?.({ phase: 'frames', framesDone: 1, frameCount: 2 });
        return fakeResult(request);
      }),
      onTrackStart: (i) => events.push(`start ${i}`),
      onTrackProgress: (i, p) => events.push(`progress ${i} ${p.framesDone}`),
      onTrackEnd: (i, o) => events.push(`end ${i} ${o.status}`),
    });
    expect(seen).toEqual(['01 1280 true', '02 1280 true', '03 1280 true']);
    expect(events).toEqual([
      'start 0',
      'progress 0 1',
      'end 0 rendered',
      'start 1',
      'progress 1 1',
      'end 1 rendered',
      'start 2',
      'progress 2 1',
      'end 2 rendered',
    ]);
    expect(summary).toMatchObject({ rendered: 3, failed: 0, skipped: 0, cancelled: false });
  });

  it('records a failed track and carries on', async () => {
    const summary = await renderBatch({
      tracks: [track('01'), track('02'), track('03')],
      output: { width: 1280, height: 720, fps: 30 },
      destination: { kind: 'memory' },
      resolveEncoding: encoding,
      render: later((request) => {
        if (request.composition.name === '02') {
          throw new RenderError('material-missing', renderMessage('material-missing', 'honey'));
        }
        return fakeResult(request);
      }),
    });
    expect(summary.outcomes.map((o) => o.status)).toEqual(['rendered', 'failed', 'rendered']);
    expect(summary).toMatchObject({ rendered: 2, failed: 1, skipped: 0, stoppedBy: null });
    const failed = summary.outcomes[1];
    expect(failed?.status === 'failed' && failed.message).toContain('honey');
  });

  it('stops when the folder itself fails, skipping the rest', async () => {
    const summary = await renderBatch({
      tracks: [track('01'), track('02'), track('03')],
      output: { width: 1280, height: 720, fps: 30 },
      destination: { kind: 'memory' },
      resolveEncoding: encoding,
      render: later((request) => {
        if (request.composition.name === '02') throw new RenderError('disk-full', 'full');
        return fakeResult(request);
      }),
    });
    expect(summary.outcomes.map((o) => o.status)).toEqual(['rendered', 'failed', 'skipped']);
    expect(summary.stoppedBy?.code).toBe('disk-full');
  });

  it('cancels the current track and skips the rest', async () => {
    const controller = new AbortController();
    const summary = await renderBatch({
      tracks: [track('01'), track('02'), track('03')],
      output: { width: 1280, height: 720, fps: 30 },
      destination: { kind: 'memory' },
      signal: controller.signal,
      resolveEncoding: encoding,
      render: later((request) => {
        if (request.composition.name === '02') {
          controller.abort();
          throw new RenderCancelledError();
        }
        return fakeResult(request);
      }),
    });
    expect(summary.outcomes.map((o) => o.status)).toEqual(['rendered', 'cancelled', 'skipped']);
    expect(summary).toMatchObject({ cancelled: true, rendered: 1, skipped: 1 });
  });

  it('holds between tracks while paused', async () => {
    const pause = createPauseController();
    const started: string[] = [];
    let resume: () => void = () => {};
    const done = renderBatch({
      tracks: [track('01'), track('02')],
      output: { width: 1280, height: 720, fps: 30 },
      destination: { kind: 'memory' },
      pause,
      resolveEncoding: encoding,
      render: later((request) => {
        started.push(request.composition.name);
        if (request.composition.name === '01') {
          pause.pause();
          resume = () => pause.resume();
        }
        return fakeResult(request);
      }),
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(started).toEqual(['01']);
    resume();
    const summary = await done;
    expect(started).toEqual(['01', '02']);
    expect(summary.rendered).toBe(2);
  });

  it('looks up the sound codec once for the whole batch', async () => {
    let lookups = 0;
    const codecs: (string | null)[] = [];
    await renderBatch({
      tracks: [track('01'), track('02')],
      output: { width: 1280, height: 720, fps: 30 },
      destination: { kind: 'memory' },
      resolveEncoding: () => {
        lookups++;
        return Promise.resolve({ audioCodec: 'opus', audioBitrate: 128_000 });
      },
      render: later((request) => {
        codecs.push(request.encoding?.audioCodec ?? null);
        return fakeResult(request);
      }),
    });
    expect(lookups).toBe(1);
    expect(codecs).toEqual(['opus', 'opus']);
  });
});
