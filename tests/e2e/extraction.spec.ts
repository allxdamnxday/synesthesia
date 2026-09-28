/**
 * Extraction integration tests (SPEC 8.5, 15.1): run the real pipeline (Mediabunny decode
 * → OpenCV Farneback in the worker → features) on the synthetic fixture clips in
 * tests/fixtures/ (made by scripts/make-fixtures.mjs) and check the expected features.
 *
 * Features are averaged over "active" frames, where energy is well above the noise floor.
 * Divergence and curl are compared through a unitless "shape" value, value × spread /
 * peak: about 2 for a pure expansion or rotation, 0 for a translation.
 */
import { basename, join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { ClipInfo, SignatureBody } from '../../src/signature/extractClient';
import { noiseFloorLooksHigh } from '../../src/signature/noiseFloor';
import type { ExtractionOptions } from '../../src/signature/types';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures');
const MIN_NOISE_FLOOR = 1e-3;

interface RunTiming {
  totalMs: number;
  framesMs: number;
  analysisFrames: number;
  msPerFrame: number;
}

interface CancelOutcome {
  errorName: string;
  isExtractionCancelled: boolean;
  doneWhenCancelled: number;
  totalWhenCancelled: number;
}

/** The harness page's test API (dev/extraction/main.ts). */
interface Harness {
  spExtract: (url: string, options?: Partial<ExtractionOptions>) => Promise<SignatureBody>;
  spProbe: (url: string) => Promise<ClipInfo>;
  spCancelDuring: (url: string) => Promise<CancelOutcome>;
  spLastRun: RunTiming | null;
}

const url = (name: string) => `./__fixtures__/${name}`;

function extract(page: Page, name: string, options: Partial<ExtractionOptions> = {}) {
  return page.evaluate(([u, o]) => (window as unknown as Harness).spExtract(u, o), [
    url(name),
    options,
  ] as const);
}

/** Frames whose energy is well above the floor. */
function activeFrames(body: SignatureBody, factor = 3): number[] {
  const floor = body.extraction.noiseFloor;
  return body.features.energy.flatMap((e, i) => (e > factor * floor ? [i] : []));
}

function meanOver(values: number[], frames: number[]): number {
  return frames.reduce((sum, i) => sum + (values[i] ?? 0), 0) / Math.max(1, frames.length);
}

/** Circular mean of direction over the given frames. */
function meanDirection(body: SignatureBody, frames: number[]): number {
  const d = body.features.direction;
  const s = frames.reduce((sum, i) => sum + Math.sin(d[i] ?? 0), 0);
  const c = frames.reduce((sum, i) => sum + Math.cos(d[i] ?? 0), 0);
  return Math.atan2(s, c);
}

/** Mean of feature × spread / peak over the active frames (unitless; ≈ 2 when pure). */
function shape(body: SignatureBody, feature: 'divergence' | 'curl'): number {
  const { spread, peak } = body.features;
  const values = body.features[feature].map((x, i) =>
    (peak[i] ?? 0) > 0 ? (x * (spread[i] ?? 0)) / (peak[i] ?? 1) : 0,
  );
  return meanOver(values, activeFrames(body));
}

function summary(name: string, body: SignatureBody): string {
  const active = activeFrames(body);
  const m = (feature: keyof SignatureBody['features']) =>
    meanOver(body.features[feature], active).toPrecision(3);
  return (
    `${name}: ${body.frameCount} frames, floor ${body.extraction.noiseFloor.toPrecision(3)}, ` +
    `${active.length} active; energy ${m('energy')}, direction ${meanDirection(body, active).toFixed(3)}, ` +
    `coherence ${m('coherence')}, divergence ${m('divergence')} (shape ${shape(body, 'divergence').toFixed(3)}), ` +
    `curl ${m('curl')} (shape ${shape(body, 'curl').toFixed(3)}), ` +
    `density mean ${body.stats.density?.mean.toPrecision(3)}, onsets [${body.features.onsets.join(', ')}]`
  );
}

test.describe.configure({ mode: 'serial' });

let page: Page;
const errors: string[] = [];

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.route('**/__fixtures__/*', (route) => {
    const name = basename(new URL(route.request().url()).pathname);
    return name === 'not-a-video.mp4'
      ? route.fulfill({ body: 'This is a text file, not a movie.', contentType: 'video/mp4' })
      : route.fulfill({ path: join(FIXTURES, name), contentType: 'video/mp4' });
  });
  await page.goto('./dev/extraction/');
  await page.waitForFunction(() => typeof (window as unknown as Harness).spExtract === 'function');
});

test.afterAll(async () => {
  await page.close();
});

test('probes a clip', async () => {
  const info = await page.evaluate(
    (u) => (window as unknown as Harness).spProbe(u),
    url('dot-right.mp4'),
  );
  expect(info).toMatchObject({
    fileName: 'dot-right.mp4',
    nativeFps: 30,
    width: 320,
    height: 180,
    rotation: 0,
    codec: 'avc',
    canDecode: true,
  });
  expect(info.durationSec).toBeCloseTo(2.5, 2);
});

test('dot moving right: direction ≈ 0, coherence high, divergence and curl ≈ 0', async () => {
  const body = await extract(page, 'dot-right.mp4');
  const timing = await page.evaluate(() => (window as unknown as Harness).spLastRun);
  console.log(summary('dot-right', body));
  if (timing) {
    console.log(
      `dot-right timing: ${timing.totalMs.toFixed(0)} ms total, ${timing.msPerFrame.toFixed(1)} ms per ` +
        `320×180 analysis frame over ${timing.analysisFrames} frames; ` +
        `10 s at 30 fps ≈ ${((timing.msPerFrame * 300) / 1000).toFixed(1)} s`,
    );
  }
  const active = activeFrames(body);
  expect(active.length).toBeGreaterThan(0.8 * body.frameCount);
  expect(meanOver(body.features.energy, active)).toBeGreaterThan(3 * body.extraction.noiseFloor);
  expect(Math.abs(meanDirection(body, active))).toBeLessThan(0.15);
  expect(meanOver(body.features.coherence, active)).toBeGreaterThan(0.9);
  expect(Math.abs(shape(body, 'divergence'))).toBeLessThan(0.1);
  expect(Math.abs(shape(body, 'curl'))).toBeLessThan(0.1);
  // Steady movement from the first frame: no onsets.
  expect(body.features.onsets).toEqual([]);
  expect(noiseFloorLooksHigh(body)).toBe(false);
});

test('dot moving up: direction ≈ π/2', async () => {
  const body = await extract(page, 'dot-up.mp4');
  console.log(summary('dot-up', body));
  const active = activeFrames(body);
  expect(active.length).toBeGreaterThan(0.8 * body.frameCount);
  expect(meanDirection(body, active)).toBeGreaterThan(Math.PI / 2 - 0.15);
  expect(meanDirection(body, active)).toBeLessThan(Math.PI / 2 + 0.15);
  expect(meanOver(body.features.coherence, active)).toBeGreaterThan(0.9);
  expect(Math.abs(shape(body, 'curl'))).toBeLessThan(0.1);
  expect(body.features.onsets).toEqual([]);
});

for (const [fixture, where] of [
  ['ring-expand.mp4', 'rings that reach past the frame'],
  ['ring-expand-inside.mp4', 'a ring that stays inside the frame'],
] as const) {
  test(`expanding: divergence > 0 (${where})`, async () => {
    const body = await extract(page, fixture);
    console.log(summary(fixture, body));
    expect(activeFrames(body).length).toBeGreaterThan(30);
    const divergence = shape(body, 'divergence');
    expect(divergence).toBeGreaterThan(0.5);
    expect(divergence).toBeGreaterThan(5 * Math.abs(shape(body, 'curl')));
    expect(noiseFloorLooksHigh(body)).toBe(false);
  });
}

for (const [fixture, where] of [
  ['ring-contract.mp4', 'rings that reach past the frame'],
  ['ring-contract-inside.mp4', 'a ring that stays inside the frame'],
] as const) {
  test(`contracting: divergence < 0 (${where})`, async () => {
    const body = await extract(page, fixture);
    console.log(summary(fixture, body));
    expect(activeFrames(body).length).toBeGreaterThan(30);
    const divergence = shape(body, 'divergence');
    expect(divergence).toBeLessThan(-0.5);
    expect(-divergence).toBeGreaterThan(5 * Math.abs(shape(body, 'curl')));
  });
}

for (const [fixture, where] of [
  ['bar-rotate-cw.mp4', 'a bar longer than the frame'],
  ['bar-rotate-cw-inside.mp4', 'a bar that stays inside the frame'],
] as const) {
  test(`turning clockwise on screen: curl high and positive (${where})`, async () => {
    const body = await extract(page, fixture);
    console.log(summary(fixture, body));
    const active = activeFrames(body);
    expect(active.length).toBeGreaterThan(0.8 * body.frameCount);
    // Documented convention (src/signature/features.ts): y down, so curl > 0 = clockwise.
    const curl = shape(body, 'curl');
    expect(curl).toBeGreaterThan(0.5);
    expect(curl).toBeGreaterThan(5 * Math.abs(shape(body, 'divergence')));
    // Rotation has no single direction, and steady turning has no onsets.
    expect(meanOver(body.features.coherence, active)).toBeLessThan(0.2);
    expect(body.features.onsets).toEqual([]);
  });
}

test('still frame: energy ≈ 0, density ≈ 0', async () => {
  const body = await extract(page, 'still.mp4');
  console.log(summary('still', body));
  expect(Math.max(...body.features.energy)).toBeLessThan(MIN_NOISE_FLOOR);
  expect(body.stats.density?.mean).toBeLessThan(0.01);
  expect(body.features.onsets).toEqual([]);
  expect(noiseFloorLooksHigh(body)).toBe(false);
});

test('still frame with sensor noise: density ≈ 0 after the auto noise floor, no onsets', async () => {
  const body = await extract(page, 'still-noise.mp4');
  console.log(summary('still-noise', body));
  expect(body.extraction.noiseFloorMode).toBe('auto');
  // The floor rose above its minimum to meet the noise…
  expect(body.extraction.noiseFloor).toBeGreaterThan(2 * MIN_NOISE_FLOOR);
  expect(body.stats.density?.mean).toBeLessThan(0.05);
  expect(body.features.onsets).toEqual([]);
  // …which is right for noise, so Prepare shows no hint.
  expect(noiseFloorLooksHigh(body)).toBe(false);
  // Without it, the same noise would light up much of the frame.
  const raw = await extract(page, 'still-noise.mp4', {
    noiseFloorMode: 'manual',
    manualNoiseFloor: MIN_NOISE_FLOOR,
  });
  console.log(summary('still-noise (manual minimum floor)', raw));
  expect(raw.stats.density?.mean).toBeGreaterThan(0.3);
});

test('dot that stops abruptly: onset near the start, low continuity at the stop', async () => {
  const body = await extract(page, 'dot-stop.mp4');
  console.log(summary('dot-stop', body));
  const fps = body.frameRate;
  // The dot starts moving 0.3 s in: one onset there, none when it stops.
  expect(body.features.onsets.length).toBe(1);
  expect(body.features.onsets[0]).toBeLessThanOrEqual(Math.round(0.5 * fps));
  const active = activeFrames(body);
  const stop = active[active.length - 1] ?? 0;
  expect(stop / fps).toBeGreaterThan(1.6);
  expect(stop / fps).toBeLessThan(2.1);
  const around = body.features.continuity.slice(stop - 3, stop + 4);
  expect(Math.min(...around)).toBeLessThan(0.5);
  // Smooth while it glides.
  const glide = body.features.continuity.slice(Math.round(0.6 * fps), Math.round(1.6 * fps));
  const sorted = [...glide].sort((a, b) => a - b);
  expect(sorted[Math.floor(sorted.length / 2)]).toBeGreaterThan(0.9);
});

test('movement that never stops: the auto floor mutes it and Prepare would say so', async () => {
  const body = await extract(page, 'pan-right.mp4');
  console.log(summary('pan-right', body));
  // The whole picture moves in every frame, so the automatic floor rises to meet it…
  expect(body.extraction.noiseFloor).toBeGreaterThan(0.1);
  expect(body.stats.density?.mean).toBeLessThan(0.05);
  expect(noiseFloorLooksHigh(body)).toBe(true);
  // …and a manual floor (higher Sensitivity) brings it back: a clean pan to the right.
  const manual = await extract(page, 'pan-right.mp4', {
    noiseFloorMode: 'manual',
    manualNoiseFloor: MIN_NOISE_FLOOR,
  });
  console.log(summary('pan-right (manual minimum floor)', manual));
  const active = activeFrames(manual);
  expect(active.length).toBeGreaterThan(0.9 * manual.frameCount);
  expect(Math.abs(meanDirection(manual, active))).toBeLessThan(0.1);
  expect(meanOver(manual.features.coherence, active)).toBeGreaterThan(0.95);
  expect(manual.stats.density?.mean).toBeGreaterThan(0.9);
  // Pure translation: no divergence or curl, and no onsets.
  expect(Math.abs(shape(manual, 'divergence'))).toBeLessThan(0.1);
  expect(Math.abs(shape(manual, 'curl'))).toBeLessThan(0.1);
  expect(manual.features.onsets).toEqual([]);
  expect(noiseFloorLooksHigh(manual)).toBe(false);
});

test('analysis size applies to the longer side: a clip turned portrait costs no more', async () => {
  // Rotate the 320×180 dot clip a quarter turn clockwise: it becomes 180×320, and the dot
  // that moved right now moves down.
  const body = await extract(page, 'dot-right.mp4', { rotate: 90 });
  console.log(summary('dot-right rotated 90°', body));
  expect(body.extraction.analysisWidth).toBe(320);
  expect(body.grid).toEqual({ cols: 32, rows: 48 });
  expect(meanDirection(body, activeFrames(body))).toBeCloseTo(-Math.PI / 2, 1);
});

test('extracting the same clip twice gives the identical content hash', async () => {
  const a = await extract(page, 'dot-right.mp4');
  const b = await extract(page, 'dot-right.mp4');
  expect(b.contentHash).toMatch(/^[0-9a-f]{64}$/);
  expect(b.contentHash).toBe(a.contentHash);
});

test('cancelling mid-extraction rejects with ExtractionCancelled; the next extraction works', async () => {
  const outcome = await page.evaluate(
    (u) => (window as unknown as Harness).spCancelDuring(u),
    url('ring-expand.mp4'),
  );
  expect(outcome.errorName).toBe('ExtractionCancelled');
  expect(outcome.isExtractionCancelled).toBe(true);
  expect(outcome.doneWhenCancelled).toBeGreaterThan(0);
  expect(outcome.doneWhenCancelled).toBeLessThan(outcome.totalWhenCancelled);
  const after = await extract(page, 'still.mp4');
  expect(after.frameCount).toBe(59);
});

test('a file that is not a readable clip is refused with the plain-language format message', async () => {
  const outcome = await page.evaluate(async (u) => {
    try {
      await (window as unknown as Harness).spProbe(u);
      return 'resolved';
    } catch (error) {
      return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    }
  }, url('not-a-video.mp4'));
  expect(outcome).toMatch(/^ClipFormatError: This clip's format can't be read in this browser\./);
  expect(outcome).toContain('Most Compatible');
});

test('a trim longer than 60 s is refused', async () => {
  const outcome = await page.evaluate(async (u) => {
    try {
      await (window as unknown as Harness).spExtract(u, { trim: { startSec: 0, endSec: 61 } });
      return 'resolved';
    } catch (error) {
      return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    }
  }, url('still.mp4'));
  expect(outcome).toMatch(/^ClipTooLongError: .*60 seconds/);
});

test('no page or console errors', () => {
  expect(errors).toEqual([]);
});
