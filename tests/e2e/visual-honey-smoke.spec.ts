import { expect, test, type Page } from '@playwright/test';

// Material-specific checks for V2 Honey and V3 Smoke, on top of the checks every visual
// material gets in visual.spec.ts. Frames come from the materials harness
// (window.spVisual, dev/materials/main.ts) at its default draft 480×270.

type Kind = 'wink' | 'sweep' | 'still' | 'swirl';
interface RenderOpts {
  materialId: string;
  kind: Kind;
  steps: number;
  props?: Record<string, number>;
  seed?: number;
  width?: number;
  height?: number;
  quality?: 'draft' | 'standard' | 'high';
}
interface RenderStats {
  hash: string;
  meanLuma: number;
  litFraction: number;
  ms: number;
}
interface SpVisualApi {
  ready: boolean;
  renderStats(opts: RenderOpts): Promise<RenderStats>;
  renderFilmstrip(opts: RenderOpts & { checkpoints: number[] }): Promise<string[]>;
}
type Win = { spVisual: SpVisualApi };

/** The frame's light: mean luma, and the height of its light-weighted centre (0 bottom, 1 top). */
interface Light {
  luma: number;
  height: number;
}

/** Steps (1/60 s) worth looking at in the synthetic wink (close 0.6–0.9 s, open 1.15–1.45 s). */
const AFTER_CLOSE = 69; // 1.15 s: the close is done, the open is about to start
const OPENED = 87; // 1.45 s: the open is done
const SETTLED = 120; // 2 s
const RISING = 180; // 3 s: smoke still on its way up
const LATE = 240; // 4 s, in the tail

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

const stats = (page: Page, opts: RenderOpts) =>
  page.evaluate((o) => (window as unknown as Win).spVisual.renderStats(o), opts);

/** Render one run and measure the light at each checkpoint (ascending steps). */
function light(page: Page, opts: Omit<RenderOpts, 'steps'>, checkpoints: number[]) {
  return page.evaluate(
    async ({ o, cps }) => {
      const urls = await (window as unknown as Win).spVisual.renderFilmstrip({
        ...o,
        steps: Math.max(...cps) + 1,
        checkpoints: cps,
      });
      const out: { luma: number; height: number }[] = [];
      for (const url of urls.slice(0, cps.length)) {
        const img = new Image();
        img.src = url;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('No 2D context');
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, img.width, img.height).data;
        let sum = 0;
        let weighted = 0;
        for (let y = 0; y < img.height; y++) {
          for (let x = 0; x < img.width; x++) {
            const i = (y * img.width + x) * 4;
            const l =
              (0.2126 * (data[i] ?? 0) +
                0.7152 * (data[i + 1] ?? 0) +
                0.0722 * (data[i + 2] ?? 0)) /
              255;
            sum += l;
            weighted += l * (1 - (y + 0.5) / img.height);
          }
        }
        out.push({
          luma: sum / (img.width * img.height),
          height: sum > 0 ? weighted / sum : Number.NaN,
        });
      }
      return out;
    },
    { o: opts, cps: checkpoints },
  ) as Promise<Light[]>;
}

test.describe('Honey', () => {
  test('the same wink as Water: color arrives on time, then Honey comes to rest and keeps its wake', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const problems = watchConsole(page);
    await openHarness(page);
    for (const seed of [7, 3]) {
      const cps = [30, 51, AFTER_CLOSE, OPENED, SETTLED, LATE];
      const water = await light(page, { materialId: 'water', kind: 'wink', seed }, cps);
      // Elasticity 0 isolates the drag: no spring-back.
      const honey = await light(
        page,
        { materialId: 'honey', kind: 'wink', seed, props: { elasticity: 0 } },
        cps,
      );
      for (const [name, run] of [
        ['Water', water],
        ['Honey', honey],
      ] as const) {
        const [before, closing, , opened] = run;
        // Timing: nothing before the wink, color with the close, more with the open.
        expect(before?.luma ?? 1, `${name} is dark before the wink`).toBeLessThan(0.002);
        expect(closing?.luma ?? 0, `${name} shows the close`).toBeGreaterThan(0.01);
        expect(opened?.luma ?? 0, `${name} shows the open`).toBeGreaterThan(
          (closing?.luma ?? 0) * 1.5,
        );
      }
      // After the wink, Water drifts on; Honey's drag brings it to rest.
      const drift = (run: Light[]) => Math.abs((run[5]?.height ?? 0) - (run[4]?.height ?? 0));
      expect(drift(honey), `seed ${seed}: Honey comes to rest`).toBeLessThan(drift(water) * 0.5);
      // Honey keeps its wake far longer than Water keeps its dye.
      const kept = (run: Light[]) => (run[5]?.luma ?? 0) / Math.max(...run.map((m) => m.luma));
      expect(kept(honey), `seed ${seed}: Honey keeps its wake`).toBeGreaterThan(kept(water) * 1.8);
    }
    expect(problems).toEqual([]);
  });

  test('sliders move the honey the way their labels promise', async ({ page }) => {
    test.setTimeout(240_000);
    const problems = watchConsole(page);
    await openHarness(page);
    for (const seed of [7, 3]) {
      const honey = (props: Record<string, number>, cps: number[]) =>
        light(page, { materialId: 'honey', kind: 'wink', seed, props }, cps);
      // Viscosity: thicker honey sags less at the close.
      const [thin] = await honey({ viscosity: 0 }, [AFTER_CLOSE]);
      const [thick] = await honey({ viscosity: 1 }, [AFTER_CLOSE]);
      expect(thick?.height ?? 0, `seed ${seed}: thick honey sags less`).toBeGreaterThan(
        (thin?.height ?? 0) + 0.05,
      );
      // Intensity: a stronger drag pulls it further down.
      const [weak] = await honey({ intensity: 0.1 }, [AFTER_CLOSE]);
      const [strong] = await honey({ intensity: 0.9 }, [AFTER_CLOSE]);
      expect(strong?.height ?? 1, `seed ${seed}: stronger push, deeper sag`).toBeLessThan(
        (weak?.height ?? 0) - 0.1,
      );
      // Elasticity: after the open lifts it, elastic honey springs back down toward rest.
      const [, loose] = await honey({ elasticity: 0 }, [SETTLED, LATE]);
      const [, springy] = await honey({ elasticity: 1 }, [SETTLED, LATE]);
      expect(springy?.height ?? 1, `seed ${seed}: elastic honey springs back`).toBeLessThan(
        (loose?.height ?? 0) - 0.05,
      );
    }
    const at = (props: Record<string, number>, steps = 100) =>
      stats(page, { materialId: 'honey', kind: 'wink', steps, seed: 3, props });
    // Brightness and density: more light, more color.
    expect((await at({ brightness: 0.9 })).meanLuma).toBeGreaterThan(
      (await at({ brightness: 0.1 })).meanLuma * 1.5,
    );
    expect((await at({ density: 0.9 })).meanLuma).toBeGreaterThan(
      (await at({ density: 0.1 })).meanLuma * 1.5,
    );
    // Persistence: long after the wink, more of it remains.
    expect((await at({ persistence: 0.9 }, 420)).meanLuma).toBeGreaterThan(
      (await at({ persistence: 0.1 }, 420)).meanLuma * 1.5,
    );
    // Range: a magnified movement drags more of the bowl.
    expect((await at({ range: 0.9 })).litFraction).toBeGreaterThan(
      (await at({ range: 0.1 })).litFraction * 1.5,
    );
    // The still signature leaves the honey black.
    expect((await stats(page, { materialId: 'honey', kind: 'still', steps: 100 })).meanLuma).toBe(
      0,
    );
    expect(problems).toEqual([]);
  });
});

test.describe('Smoke', () => {
  test('warm smoke rises; with Rise below the middle it sinks', async ({ page }) => {
    test.setTimeout(180_000);
    const problems = watchConsole(page);
    await openHarness(page);
    for (const seed of [7, 3]) {
      const smoke = (props: Record<string, number>) =>
        light(page, { materialId: 'smoke', kind: 'wink', seed, props }, [
          30,
          51,
          OPENED,
          RISING,
          LATE,
        ]);
      const [before, closing, opened, rising, late] = await smoke({});
      expect(before?.luma ?? 1, `seed ${seed}: dark before the wink`).toBeLessThan(0.002);
      expect(closing?.luma ?? 0, `seed ${seed}: smoke with the close`).toBeGreaterThan(0.01);
      expect(opened?.luma ?? 0, `seed ${seed}: more smoke with the open`).toBeGreaterThan(
        (closing?.luma ?? 0) * 1.5,
      );
      expect(late?.height ?? 0, `seed ${seed}: smoke rises`).toBeGreaterThan(
        (opened?.height ?? 1) + 0.15,
      );
      // Then it thins away.
      expect(late?.luma ?? 1, `seed ${seed}: smoke thins`).toBeLessThan((opened?.luma ?? 0) * 0.8);

      const [, , heavyOpened, , heavyLate] = await smoke({ rise: 0.1 });
      expect(heavyLate?.height ?? 1, `seed ${seed}: heavy smoke sinks`).toBeLessThan(
        (heavyOpened?.height ?? 0) - 0.15,
      );
      // More rise: higher smoke while it is still on its way up.
      const [, , , lighter] = await smoke({ rise: 0.9 });
      expect(lighter?.height ?? 0, `seed ${seed}: more rise, higher smoke`).toBeGreaterThan(
        (rising?.height ?? 1) + 0.03,
      );
    }
    expect(problems).toEqual([]);
  });

  test('sliders move the smoke the way their labels promise', async ({ page }) => {
    test.setTimeout(180_000);
    const problems = watchConsole(page);
    await openHarness(page);
    const at = (props: Record<string, number>, steps = 100) =>
      stats(page, { materialId: 'smoke', kind: 'wink', steps, seed: 3, props });
    expect((await at({ brightness: 0.9 })).meanLuma).toBeGreaterThan(
      (await at({ brightness: 0.1 })).meanLuma * 1.5,
    );
    expect((await at({ density: 0.9 })).meanLuma).toBeGreaterThan(
      (await at({ density: 0.1 })).meanLuma * 1.5,
    );
    expect((await at({ persistence: 0.9 }, 300)).meanLuma).toBeGreaterThan(
      (await at({ persistence: 0.1 }, 300)).meanLuma * 1.5,
    );
    expect((await at({ range: 0.9 })).litFraction).toBeGreaterThan(
      (await at({ range: 0.1 })).litFraction * 1.5,
    );
    expect((await stats(page, { materialId: 'smoke', kind: 'still', steps: 100 })).meanLuma).toBe(
      0,
    );
    expect(problems).toEqual([]);
  });

  test('the same flow at every quality tier, so a preview and a render match', async ({ page }) => {
    test.setTimeout(180_000);
    const problems = watchConsole(page);
    await openHarness(page);
    const heights: number[] = [];
    for (const quality of ['draft', 'standard', 'high'] as const) {
      const [, late] = await light(
        page,
        { materialId: 'smoke', kind: 'wink', seed: 3, quality, width: 640, height: 360 },
        [OPENED, LATE],
      );
      heights.push(late?.height ?? 0);
    }
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(0.05);
    expect(problems).toEqual([]);
  });
});
