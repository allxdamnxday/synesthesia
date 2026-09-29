/**
 * The sound scheduler under a busy main thread (SPEC 9.1 "Sound scheduling"), for every
 * registered sound material, through the harness page dev/sound (window.spSound):
 *
 * - a stall long enough for the scheduled sound to run out: playback resyncs without a click
 *   or a snap (the jump happens in the engine's silence);
 * - a Persistence drag with slider-sized steps (each one can mean a new reverb impulse
 *   response): the scheduler never runs out.
 *
 * The preview is recorded through the harness's worklet tap and compared with offline renders
 * of the same settings (the same click analysis as tests/e2e/sound.spec.ts).
 */
import { expect, test, type Page } from '@playwright/test';

interface MaterialInfo {
  id: string;
  properties: { id: string }[];
}

interface ActionResult {
  kind: string;
  recSec: number;
  levelBefore: number;
  quietMs: number;
  previewClick: number;
  referenceClick: number;
  previewJump: number;
  referenceJump: number;
}

interface ProbeResult {
  contextState: string;
  actions: ActionResult[];
  scheduler: { ticks: number; resyncs: number; lastResyncAt: number; minLeadSec: number };
  setPropsMs: number[];
  skips: { recSec: number; frames: number }[];
}

interface ProbeOptions {
  materialId: string;
  kind: 'wink' | 'sweep';
  seconds: number;
  tailSec?: number;
  props?: Record<string, number>;
  stall?: { at: number; ms: number };
  drag?: {
    prop: string;
    from: number;
    to: number;
    startAt: number;
    seconds: number;
    steps?: number;
  };
  playSeconds?: number;
}

const errors: string[] = [];

async function open(page: Page): Promise<void> {
  errors.length = 0;
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.goto('./dev/sound/');
  await page.waitForFunction(() => 'spSound' in window);
}

async function materials(page: Page): Promise<MaterialInfo[]> {
  const list = await page.evaluate(() =>
    (window as unknown as { spSound: { listMaterials(): MaterialInfo[] } }).spSound.listMaterials(),
  );
  expect(list.length).toBeGreaterThan(0);
  return list;
}

async function probe(page: Page, opts: ProbeOptions): Promise<ProbeResult> {
  return (await page.evaluate(
    (o) =>
      (
        window as unknown as { spSound: { previewProbe(o: unknown): Promise<unknown> } }
      ).spSound.previewProbe(o),
    opts,
  )) as ProbeResult;
}

/** The preview is no rougher than steady renders of the same settings at the same moments. */
function expectNoClick(a: ActionResult, label: string): void {
  expect(a.previewClick, `${label}: click`).toBeLessThanOrEqual(a.referenceClick * 1.5 + 0.01);
  expect(a.previewJump, `${label}: jump`).toBeLessThanOrEqual(a.referenceJump * 1.5 + 0.02);
}

test.describe('sound scheduler under a busy main thread', () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
  });

  test.afterEach(() => {
    expect(errors).toEqual([]);
  });

  test('a stall resyncs without a click or a snap', async ({ page }) => {
    test.setTimeout(240_000);
    for (const m of await materials(page)) {
      const configs: [string, Record<string, number>][] = [['baseline', {}]];
      if (m.properties.some((p) => p.id === 'density')) configs.push(['density 1', { density: 1 }]);
      for (const [label, props] of configs) {
        // The main thread is blocked for 450 ms from 1.2 s, during the wink's open: the
        // scheduled sound (200 ms ahead) runs out while the sound is loud, and playback
        // resyncs ~0.3 s later in the composition, in the quieter tail.
        const p = await probe(page, {
          materialId: m.id,
          kind: 'wink',
          seconds: 2.4,
          tailSec: 0.5,
          props,
          stall: { at: 1.2, ms: 450 },
          playSeconds: 2.2,
        });
        const name = `${m.id} (${label})`;
        expect(p.contextState).toBe('running');
        expect(p.skips, `${name}: the recording is complete`).toEqual([]);
        expect(p.scheduler.resyncs, `${name}: the stall starved the scheduler`).toBeGreaterThan(0);
        const resync = p.actions.find((a) => a.kind === 'stall');
        if (!resync) throw new Error(`${name}: no stall recorded`);
        expect(resync.levelBefore, `${name}: sounding before the resync`).toBeGreaterThan(0.02);
        // The jump happens where nothing is heard (the engine's dip): no snap, however
        // different the sound is on either side of it.
        expect(resync.quietMs, `${name}: silent at the jump`).toBeGreaterThanOrEqual(3);
        expectNoClick(resync, `${name} resync`);
      }
    }
  });

  test('a Persistence drag keeps the scheduler fed', async ({ page }) => {
    test.setTimeout(300_000);
    for (const m of await materials(page)) {
      if (!m.properties.some((p) => p.id === 'persistence')) continue;
      for (const [from, to] of [
        [0, 1],
        [1, 0.2],
      ] as const) {
        // A hand-sized drag: a step every 30 ms (like a slider's input events), each a new
        // reverb decay, over the rising sweep.
        const p = await probe(page, {
          materialId: m.id,
          kind: 'sweep',
          seconds: 3.2,
          tailSec: 0.5,
          props: { persistence: from },
          drag: { prop: 'persistence', from, to, startAt: 0.4, seconds: 1.2, steps: 40 },
          playSeconds: 2.4,
        });
        const name = `${m.id} persistence ${from} → ${to}`;
        const steps = p.actions.filter((a) => a.kind === 'drag');
        expect(steps.length, `${name}: every step was taken`).toBe(41);
        expect(p.scheduler.resyncs, `${name}: the schedule never ran out`).toBe(0);
        // Normally ~150 ms of sound is scheduled when a tick comes; it may dip, not vanish.
        expect(p.scheduler.minLeadSec, `${name}: scheduler lead`).toBeGreaterThan(0.04);
        for (const a of steps) expectNoClick(a, `${name} at ${a.recSec.toFixed(2)} s`);
      }
    }
  });

  test('on a slower computer (CPU throttled 2×), a Persistence drag still keeps it fed', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    // A 2017 MacBook Pro is the target: roughly half this machine's single-thread speed.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 2 });
    for (const [from, to] of [
      [0, 1],
      [1, 0.2],
    ] as const) {
      const p = await probe(page, {
        materialId: 'water',
        kind: 'sweep',
        seconds: 3.2,
        tailSec: 0.5,
        props: { persistence: from },
        drag: { prop: 'persistence', from, to, startAt: 0.4, seconds: 1.2, steps: 40 },
        playSeconds: 2.4,
      });
      const name = `water persistence ${from} → ${to}, 2× slower`;
      expect(p.actions.filter((a) => a.kind === 'drag').length, name).toBe(41);
      expect(p.scheduler.resyncs, `${name}: the schedule never ran out`).toBe(0);
    }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  });
});
