import { expect, test, type Page } from '@playwright/test';

// Mirrors window.spVisual in dev/materials/main.ts (the node test project can't see it).
type Kind = 'wink' | 'sweep' | 'still' | 'swirl';
interface RenderOpts {
  materialId: string;
  kind: Kind;
  steps: number;
  props?: Record<string, number>;
  /** Applied to the final draw only (every step runs with `props`). */
  finalProps?: Record<string, number>;
  seed?: number;
  width?: number;
  height?: number;
  quality?: 'draft' | 'standard' | 'high';
  overrides?: { forceManualFiltering?: boolean; forceRgba?: boolean };
}
interface RenderStats {
  hash: string;
  meanLuma: number;
  meanRgb: [number, number, number];
  litFraction: number;
  ms: number;
}
interface MaterialSummary {
  id: string;
  name: string;
  version: number;
  properties: { id: string; label: string; kind: 'continuous' | 'choice'; primary: boolean }[];
}
interface BenchmarkResult {
  tier: 'draft' | 'standard' | 'high';
  fpsByTier: Record<'draft' | 'standard' | 'high', number>;
  width: number;
  height: number;
  ms: number;
}
interface SpVisualApi {
  ready: boolean;
  listMaterials(): MaterialSummary[];
  renderStats(opts: RenderOpts): Promise<RenderStats>;
  renderHash(opts: RenderOpts): Promise<string>;
  benchmark(opts?: {
    width?: number;
    height?: number;
    durationMs?: number;
  }): Promise<BenchmarkResult>;
  solverHookProbe(): Promise<{
    withHooks: { hash: string; meanLuma: number };
    withoutHooks: { hash: string; meanLuma: number };
    hookCalls: number;
    glErrors: number;
  }>;
}
type Win = { spVisual: SpVisualApi };

/** The wink is opening at step 80 (t = 1.33 s): the close has happened, the open is under way. */
const STEPS = 80;
/** A render must finish within this (it takes ~0.1 s on the builder's machine). */
const MAX_RENDER_MS = 5000;

const stats = (page: Page, opts: RenderOpts) =>
  page.evaluate((o) => (window as unknown as Win).spVisual.renderStats(o), opts);
const hash = (page: Page, opts: RenderOpts) =>
  page.evaluate((o) => (window as unknown as Win).spVisual.renderHash(o), opts);

function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on('pageerror', (err) => problems.push(err.message));
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error' || /too many active webgl contexts/i.test(text)) {
      problems.push(`${msg.type()}: ${text}`);
    }
  });
  return problems;
}

async function openHarness(page: Page): Promise<void> {
  await page.goto('./dev/materials/?autoplay=0');
  await page.waitForFunction(() => (window as unknown as Win).spVisual?.ready === true);
}

test.describe('visual materials', () => {
  test('every registered material is deterministic, visible, and responds to the signature and its properties', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const problems = watchConsole(page);
    await openHarness(page);
    const materials = await page.evaluate(() =>
      (window as unknown as Win).spVisual.listMaterials(),
    );
    expect(materials.map((m) => m.id)).toEqual(expect.arrayContaining(['water', 'signature']));

    for (const material of materials) {
      await test.step(material.name, async () => {
        const base: RenderOpts = { materialId: material.id, kind: 'wink', steps: STEPS, seed: 7 };
        const first = await stats(page, base);
        const second = await stats(page, base);
        expect(second.hash, `${material.name}: same inputs, same frame`).toBe(first.hash);
        expect(first.meanLuma, `${material.name}: the wink shows`).toBeGreaterThan(0.005);
        expect(first.litFraction, `${material.name}: the wink shows`).toBeGreaterThan(0.01);
        expect(first.ms).toBeLessThan(MAX_RENDER_MS);
        expect(second.ms).toBeLessThan(MAX_RENDER_MS);

        const still = await stats(page, { ...base, kind: 'still' });
        expect(still.hash, `${material.name}: responds to movement`).not.toBe(first.hash);
        expect(still.meanLuma).toBeLessThan(first.meanLuma);

        const primary = material.properties.filter((p) => p.kind === 'continuous' && p.primary);
        for (const property of primary) {
          const low = await hash(page, { ...base, props: { [property.id]: 0.1 } });
          const high = await hash(page, { ...base, props: { [property.id]: 0.9 } });
          expect(high, `${material.name}: ${property.label} changes the wake`).not.toBe(low);
        }
      });
    }
    expect(problems).toEqual([]);
  });

  test('Water: sliders move the wake the way their labels promise', async ({ page }) => {
    test.setTimeout(180_000);
    const problems = watchConsole(page);
    await openHarness(page);
    const water = (props: Record<string, number>, steps = STEPS) =>
      stats(page, { materialId: 'water', kind: 'wink', steps, seed: 3, props });

    // Brightness and density: more light, more dye.
    expect((await water({ brightness: 0.9 })).meanLuma).toBeGreaterThan(
      (await water({ brightness: 0.1 })).meanLuma * 1.5,
    );
    expect((await water({ density: 0.9 })).meanLuma).toBeGreaterThan(
      (await water({ density: 0.1 })).meanLuma * 1.5,
    );
    // Persistence: two seconds after the wink, more of it remains.
    expect((await water({ persistence: 0.9 }, 240)).meanLuma).toBeGreaterThan(
      (await water({ persistence: 0.1 }, 240)).meanLuma * 1.5,
    );
    // Range: a magnified movement stirs more of the bowl than a compressed one.
    expect((await water({ range: 0.9 })).litFraction).toBeGreaterThan(
      (await water({ range: 0.1 })).litFraction * 1.5,
    );
    // The still signature leaves the water black.
    const still = await stats(page, { materialId: 'water', kind: 'still', steps: STEPS });
    expect(still.meanLuma).toBe(0);
    // A different seed gives a different (but equally valid) wake.
    expect(await hash(page, { materialId: 'water', kind: 'wink', steps: STEPS, seed: 4 })).not.toBe(
      await hash(page, { materialId: 'water', kind: 'wink', steps: STEPS, seed: 3 }),
    );
    expect(problems).toEqual([]);
  });

  test('Hue turns the colors of every material where it is drawn, and nothing else', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const problems = watchConsole(page);
    await openHarness(page);
    // The Brightness at which each material draws its colors exactly as mixed (saturation 1,
    // and no surface light): a third of a turn then gives the same frame with its channels
    // cycled, red from blue, green from red, blue from green.
    const plain: Record<string, Record<string, number>> = {
      water: { brightness: 6 / 13, surfaceLight: 0 },
      honey: { brightness: 0.4, surfaceLight: 0 },
      smoke: { brightness: 0.8 },
      bubbles: { brightness: 6 / 13 },
      filaments: { brightness: 6 / 13 },
    };
    const apart = (a: number[], b: number[]) =>
      a.reduce((sum, x, i) => sum + Math.abs(x - (b[i] ?? 0)), 0);
    /** A third of a turn on: the frame's color with its channels cycled, and not the reverse. */
    const expectCycled = (before: number[], after: number[], label: string) => {
      const [r = 0, g = 0, b = 0] = before;
      const cycled = apart(after, [b, r, g]);
      const reversed = apart(after, [g, b, r]);
      expect(reversed, `${label}: there are colors to turn`).toBeGreaterThan(0.05 * (r + g + b));
      expect(cycled, `${label}: red from blue, green from red, blue from green`).toBeLessThan(
        0.25 * reversed,
      );
    };

    for (const [materialId, props] of Object.entries(plain)) {
      await test.step(materialId, async () => {
        // Smoke is measured while the eye closes, when its falling tint is clearest.
        const steps = materialId === 'smoke' ? 54 : STEPS;
        const base: RenderOpts = { materialId, kind: 'wink', steps, seed: 7 };
        const own = await hash(page, base);
        expect(
          await hash(page, { ...base, props: { hue: 0.5 } }),
          'the middle changes nothing',
        ).toBe(own);
        const turned = await hash(page, { ...base, props: { hue: 0.8 } });
        expect(turned, 'Hue changes the frame').not.toBe(own);
        expect(await hash(page, { ...base, props: { hue: 0.8 } }), 'same inputs, same frame').toBe(
          turned,
        );
        expect(await hash(page, { ...base, props: { hue: 0 } }), 'the slider’s ends meet').toBe(
          await hash(page, { ...base, props: { hue: 1 } }),
        );
        // Every step at the baseline and only the final draw turned gives the frame of a wake
        // turned all along. Hue reaching the dye or the ribbons would give another.
        expect(
          await hash(page, { ...base, props: { hue: 0.5 }, finalProps: { hue: 0.8 } }),
          'Hue only changes how the wake is drawn',
        ).toBe(turned);

        const before = await stats(page, { ...base, props });
        const after = await stats(page, { ...base, props: { ...props, hue: 0.5 + 1 / 3 } });
        expectCycled(before.meanRgb, after.meanRgb, materialId);
        expect(after.litFraction, 'the wake keeps its shape').toBeCloseTo(before.litFraction, 2);
      });
    }

    // A still signature leaves the fluids exactly black at any Hue.
    for (const materialId of ['water', 'honey', 'smoke']) {
      for (const hue of [0, 0.2, 0.5 + 1 / 3]) {
        const still = await stats(page, {
          materialId,
          kind: 'still',
          steps: STEPS,
          props: { hue, brightness: 1, surfaceLight: 1 },
        });
        expect(still.meanLuma, `${materialId} at Hue ${hue}`).toBe(0);
        expect(still.litFraction, `${materialId} at Hue ${hue}`).toBe(0);
      }
    }

    // Bubbles and strands at rest, drawn before any step: Hue shows from the first frame.
    for (const materialId of ['bubbles', 'filaments']) {
      const rest: RenderOpts = { materialId, kind: 'still', steps: 0, seed: 2 };
      const own = (await stats(page, rest)).meanRgb;
      const turned = (await stats(page, { ...rest, props: { hue: 0.5 + 1 / 3 } })).meanRgb;
      // Pearl and silver-blue at rest: more blue than red, and the other way once turned.
      expect(own[2], `${materialId} at rest`).toBeGreaterThan(own[0]);
      expect(turned[0], `${materialId} at rest, turned`).toBeGreaterThan(turned[2]);
      expectCycled(own, turned, `${materialId} at rest`);
    }
    expect(problems).toEqual([]);
  });

  test('Water still works on the capability fallbacks (RGBA targets, manual filtering)', async ({
    page,
  }) => {
    const problems = watchConsole(page);
    await openHarness(page);
    const base: RenderOpts = { materialId: 'water', kind: 'wink', steps: STEPS, seed: 5 };
    const normal = await stats(page, base);
    const rgba = await stats(page, { ...base, overrides: { forceRgba: true } });
    const manual = await stats(page, { ...base, overrides: { forceManualFiltering: true } });
    const both = await stats(page, {
      ...base,
      overrides: { forceRgba: true, forceManualFiltering: true },
    });
    for (const fallback of [rgba, manual, both]) {
      expect(fallback.meanLuma).toBeGreaterThan(normal.meanLuma * 0.8);
      expect(fallback.meanLuma).toBeLessThan(normal.meanLuma * 1.25);
    }
    expect(problems).toEqual([]);
  });

  test('Signature view: the readout adds labelled bars', async ({ page }) => {
    const problems = watchConsole(page);
    await openHarness(page);
    const base: RenderOpts = {
      materialId: 'signature',
      kind: 'wink',
      steps: STEPS,
      width: 960,
      height: 540,
    };
    const off = await stats(page, base);
    const on = await stats(page, { ...base, props: { showReadout: 1 } });
    expect(on.hash).not.toBe(off.hash);
    expect(await hash(page, { ...base, props: { showReadout: 1 } })).toBe(on.hash);
    expect(problems).toEqual([]);
  });

  test("the fluid solver's extension hooks run custom fields and passes (for Smoke and Honey)", async ({
    page,
  }) => {
    const problems = watchConsole(page);
    await openHarness(page);
    const probe = await page.evaluate(() => (window as unknown as Win).spVisual.solverHookProbe());
    expect(probe.hookCalls).toBe(180); // two hooks × 90 steps
    expect(probe.glErrors).toBe(0);
    expect(probe.withHooks.meanLuma).toBeGreaterThan(0.005);
    expect(probe.withHooks.hash).not.toBe(probe.withoutHooks.hash);
    expect(problems).toEqual([]);
  });

  test('the quality benchmark measures every tier in about three seconds', async ({ page }) => {
    const problems = watchConsole(page);
    await openHarness(page);
    const result = await page.evaluate(() =>
      (window as unknown as Win).spVisual.benchmark({ width: 1280, height: 720 }),
    );
    for (const tier of ['draft', 'standard', 'high'] as const) {
      expect(result.fpsByTier[tier]).toBeGreaterThan(0);
    }
    // SPEC 16 M2: at least 30 fps at Standard on the builder's machine.
    expect(result.fpsByTier.standard).toBeGreaterThanOrEqual(30);
    expect(['draft', 'standard', 'high']).toContain(result.tier);
    expect(result.ms).toBeLessThan(8000);
    expect(problems).toEqual([]);
  });

  test('spike 5: fluid in React passes its checks without leaking contexts', async ({ page }) => {
    test.setTimeout(180_000);
    const problems = watchConsole(page);
    await page.goto('./spikes/05-fluid/?run=1');
    await page.waitForFunction(
      () => (window as unknown as { spSpike5?: { done: boolean } }).spSpike5?.done === true,
      null,
      { timeout: 150_000 },
    );
    const outcome = await page.evaluate(() => {
      const s = (
        window as unknown as {
          spSpike5: { report: string; error: string | null; results: { pass: boolean } | null };
        }
      ).spSpike5;
      return { report: s.report, error: s.error, pass: s.results?.pass ?? false };
    });
    console.log(outcome.report);
    expect(outcome.error).toBeNull();
    expect(outcome.pass, outcome.report).toBe(true);
    expect(problems).toEqual([]);
  });
});
