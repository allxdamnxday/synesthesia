import { describe, expect, it, vi } from 'vitest';
import type { Composition } from '../../src/engine/composition';
import {
  BATCH_MESSAGES,
  BatchController,
  TrackRenderError,
  renderTracks,
  type BatchCallbacks,
  type RenderOneFn,
  type RenderOneRequest,
} from '../../src/screens/Album/batch/renderTracks';
import type { KineticSignature } from '../../src/signature/types';

const SIGNATURE = { id: 'sig' } as KineticSignature;

function tracks(n: number): Composition[] {
  return Array.from(
    { length: n },
    (_, i) =>
      ({
        id: `c${i + 1}`,
        name: String(i + 1).padStart(2, '0'),
        seed: 1000 + i,
        signature: { id: 'sig', contentHash: 'h', name: 'Wink' },
      }) as Composition,
  );
}

const OPTIONS = { destination: { kind: 'downloads' as const }, normalize: true, sidecar: true };

/** Let pending promise callbacks and timers run. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * A renderer that takes `frames` frames per track, each 100 ms on a fake clock, awaiting
 * `checkpoint()` before each frame (as the real render loop will). `fail` maps a track
 * index to the error it throws halfway through.
 */
function fakeRenderer(
  options: { frames?: number; fail?: Record<number, Error>; checkpoints?: boolean } = {},
) {
  const frames = options.frames ?? 4;
  let clock = 0;
  const calls: RenderOneRequest[] = [];
  const renderOne: RenderOneFn = async (request) => {
    const index = calls.length;
    calls.push(request);
    for (let f = 0; f < frames; f++) {
      if (options.checkpoints !== false) await request.checkpoint();
      else if (request.signal.aborted) throw new DOMException('stop', 'AbortError');
      await settle();
      clock += 100;
      if (options.fail?.[index] && f === Math.floor(frames / 2)) throw options.fail[index];
      request.onProgress((f + 1) / frames);
    }
    return { fileName: `SP_Wink_${request.composition.name}_${request.composition.seed}.mp4` };
  };
  return {
    renderOne,
    calls,
    now: () => clock,
    advance: (ms: number) => (clock += ms),
  };
}

function recorder() {
  const log: string[] = [];
  const etas: Array<number | null> = [];
  const callbacks: BatchCallbacks = {
    onTrackStart: (i) => log.push(`start ${i}`),
    onTrackProgress: (i, f, eta) => {
      log.push(`progress ${i} ${f}`);
      etas.push(eta);
    },
    onTrackDone: (i, outcome) => {
      log.push(`done ${i} ${outcome.status}`);
    },
    onHoldChange: (holding) => log.push(holding ? 'hold' : 'release'),
  };
  return { log, etas, callbacks };
}

describe('batch render', () => {
  it('renders every track in order with progress, file names and an estimate', async () => {
    const fake = fakeRenderer();
    const { log, etas, callbacks } = recorder();
    const summary = await renderTracks(tracks(3), OPTIONS, callbacks, {
      renderOne: fake.renderOne,
      loadSignature: () => Promise.resolve(SIGNATURE),
      now: fake.now,
    });
    expect(fake.calls.map((c) => c.composition.id)).toEqual(['c1', 'c2', 'c3']);
    expect(fake.calls[0]).toMatchObject({ normalize: true, sidecar: true, signature: SIGNATURE });
    expect(summary).toMatchObject({ rendered: 3, failed: 0, skipped: 0, cancelled: false });
    expect(summary.outcomes[1]).toEqual({
      status: 'rendered',
      fileName: 'SP_Wink_02_1001.mp4',
      ms: 400,
    });
    expect(summary.elapsedMs).toBe(1200);
    expect(log.filter((l) => l.startsWith('start') || l.startsWith('done'))).toEqual([
      'start 0',
      'done 0 rendered',
      'start 1',
      'done 1 rendered',
      'start 2',
      'done 2 rendered',
    ]);
    expect(log).toContain('progress 0 0.25');
    // After the first quarter of track 1: 300 ms left of it and 400 ms for each of 2 more.
    expect(etas[0]).toBe(300 + 800);
    // Halfway through the last track: 200 ms left.
    expect(etas[etas.length - 3]).toBe(200);
    expect(etas[etas.length - 1]).toBe(0);
  });

  it('records a failed track in plain language and carries on', async () => {
    const fake = fakeRenderer({
      fail: {
        0: new TrackRenderError('The video encoder stopped. Try a smaller size.', 'EncodingError'),
        1: new TypeError("Cannot read properties of undefined (reading 'gl')"),
      },
    });
    const { callbacks } = recorder();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const summary = await renderTracks(tracks(4), OPTIONS, callbacks, {
      renderOne: fake.renderOne,
      loadSignature: (c) => Promise.resolve(c.id === 'c3' ? undefined : SIGNATURE),
      now: fake.now,
    });
    warn.mockRestore();
    expect(summary).toMatchObject({ rendered: 1, failed: 3, skipped: 0, cancelled: false });
    expect(summary.outcomes[0]).toMatchObject({
      status: 'failed',
      message: 'The video encoder stopped. Try a smaller size.',
    });
    const technical = summary.outcomes[1];
    expect(technical).toMatchObject({ status: 'failed', message: BATCH_MESSAGES.failed });
    expect(technical.status === 'failed' ? technical.detail : '').toContain('TypeError');
    expect(summary.outcomes[2]).toMatchObject({
      status: 'failed',
      message: BATCH_MESSAGES.missingSignature,
    });
    expect(summary.outcomes[3]).toMatchObject({ status: 'rendered' });
    // The track without its signature never reached the renderer.
    expect(fake.calls.map((c) => c.composition.id)).toEqual(['c1', 'c2', 'c4']);
  });

  it('pauses mid-track at a checkpoint, and paused time does not count', async () => {
    const fake = fakeRenderer();
    const controller = new BatchController();
    const { log, callbacks } = recorder();
    let paused = false;
    const run = renderTracks(
      tracks(2),
      OPTIONS,
      {
        ...callbacks,
        onTrackProgress: (i, f, eta) => {
          callbacks.onTrackProgress?.(i, f, eta);
          if (i === 0 && f === 0.5 && !paused) {
            paused = true;
            controller.pause();
          }
        },
      },
      { renderOne: fake.renderOne, loadSignature: () => Promise.resolve(SIGNATURE), now: fake.now },
      controller,
    );
    for (let k = 0; k < 10; k++) await settle();
    const held = log.length;
    expect(log[held - 1]).toBe('hold');
    expect(log).not.toContain('progress 0 0.75');
    fake.advance(60_000); // a long pause
    for (let k = 0; k < 10; k++) await settle();
    expect(log).toHaveLength(held);
    controller.resume();
    const summary = await run;
    expect(log[held]).toBe('release');
    expect(summary).toMatchObject({ rendered: 2, cancelled: false });
    expect(summary.elapsedMs).toBe(800);
  });

  it('holds between tracks when the renderer has no checkpoints', async () => {
    const fake = fakeRenderer({ checkpoints: false });
    const controller = new BatchController();
    const { log, callbacks } = recorder();
    const run = renderTracks(
      tracks(2),
      OPTIONS,
      {
        ...callbacks,
        onTrackStart: (i) => {
          callbacks.onTrackStart?.(i);
          if (i === 0) controller.pause();
        },
      },
      { renderOne: fake.renderOne, loadSignature: () => Promise.resolve(SIGNATURE), now: fake.now },
      controller,
    );
    for (let k = 0; k < 20; k++) await settle();
    expect(log).toContain('done 0 rendered');
    expect(log).not.toContain('start 1');
    expect(log[log.length - 1]).toBe('hold');
    controller.resume();
    expect(await run).toMatchObject({ rendered: 2 });
  });

  it('cancels the current track and leaves the rest unrendered', async () => {
    const fake = fakeRenderer();
    const controller = new BatchController();
    const { callbacks } = recorder();
    const summary = await renderTracks(
      tracks(4),
      OPTIONS,
      {
        ...callbacks,
        onTrackProgress: (i, f) => {
          if (i === 1 && f === 0.5) controller.cancel();
        },
      },
      { renderOne: fake.renderOne, loadSignature: () => Promise.resolve(SIGNATURE), now: fake.now },
      controller,
    );
    expect(summary).toMatchObject({ rendered: 1, failed: 0, skipped: 3, cancelled: true });
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1].signal.aborted).toBe(true);
  });

  it('cancels while paused between tracks', async () => {
    const fake = fakeRenderer({ checkpoints: false });
    const controller = new BatchController();
    const run = renderTracks(
      tracks(3),
      OPTIONS,
      { onTrackStart: () => controller.pause() },
      { renderOne: fake.renderOne, loadSignature: () => Promise.resolve(SIGNATURE), now: fake.now },
      controller,
    );
    for (let k = 0; k < 20; k++) await settle();
    controller.cancel();
    expect(await run).toMatchObject({ rendered: 1, skipped: 2, cancelled: true });
    expect(fake.calls).toHaveLength(1);
  });

  it('keeps going when recording a finished track fails', async () => {
    const fake = fakeRenderer({ frames: 1 });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const summary = await renderTracks(
      tracks(2),
      OPTIONS,
      { onTrackDone: () => Promise.reject(new Error('database closed')) },
      { renderOne: fake.renderOne, loadSignature: () => Promise.resolve(SIGNATURE), now: fake.now },
    );
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    expect(summary.rendered).toBe(2);
  });
});
