import { expect, test, type Page } from '@playwright/test';

// Material-specific checks for V4 Descending bubbles and V5 Filaments, measured from the
// pixels the harness renders (dev/materials, window.spVisual).
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
interface SpVisualApi {
  ready: boolean;
  renderImage(opts: RenderOpts): Promise<string>;
}
type Win = { spVisual: SpVisualApi };

const WIDTH = 480;
const HEIGHT = 270;

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

/** Render one frame and return it as RGBA bytes, top row first. */
async function frame(page: Page, opts: RenderOpts): Promise<Uint8Array> {
  // Base64 keeps the transfer fast (a JSON array of half a million numbers is not).
  const base64 = await page.evaluate(async (o) => {
    const url = await (window as unknown as Win).spVisual.renderImage(o);
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(img, 0, 0);
    const bytes = ctx.getImageData(0, 0, img.width, img.height).data;
    let text = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(text);
  }, opts);
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

function luma(rgba: Uint8Array): Float64Array {
  const out = new Float64Array(rgba.length / 4);
  for (let i = 0; i < out.length; i++) {
    out[i] =
      0.2126 * (rgba[i * 4] ?? 0) +
      0.7152 * (rgba[i * 4 + 1] ?? 0) +
      0.0722 * (rgba[i * 4 + 2] ?? 0);
  }
  return out;
}

/**
 * The vertical shift (pixels, positive = down the image) that best aligns frame `a` with
 * frame `b`: normalized cross-correlation over the overlapping rows.
 */
function bestVerticalShift(a: Float64Array, b: Float64Array, maxShift: number): number {
  let best = 0;
  let bestScore = -Infinity;
  for (let dy = -maxShift; dy <= maxShift; dy++) {
    let sa = 0;
    let sb = 0;
    let saa = 0;
    let sbb = 0;
    let sab = 0;
    let n = 0;
    for (let y = Math.max(0, -dy); y < Math.min(HEIGHT, HEIGHT - dy); y++) {
      for (let x = 0; x < WIDTH; x++) {
        const va = a[y * WIDTH + x] ?? 0;
        const vb = b[(y + dy) * WIDTH + x] ?? 0;
        sa += va;
        sb += vb;
        saa += va * va;
        sbb += vb * vb;
        sab += va * vb;
        n++;
      }
    }
    const cov = sab / n - (sa / n) * (sb / n);
    const denom = Math.sqrt((saa / n - (sa / n) ** 2) * (sbb / n - (sb / n) ** 2));
    const score = denom > 0 ? cov / denom : -Infinity;
    if (score > bestScore) {
      bestScore = score;
      best = dy;
    }
  }
  return best;
}

/** Mean absolute luma difference between two frames (0..255). */
function meanDifference(a: Float64Array, b: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  return sum / a.length;
}

/**
 * The wake's color: the light the wink adds over the still frame, summed per channel,
 * as green ÷ blue (low: ultramarine, moving down; high: sea-glass, moving up).
 */
function wakeGreenness(wink: Uint8Array, still: Uint8Array): number {
  let g = 0;
  let b = 0;
  for (let i = 0; i < wink.length; i += 4) {
    g += Math.max(0, (wink[i + 1] ?? 0) - (still[i + 1] ?? 0));
    b += Math.max(0, (wink[i + 2] ?? 0) - (still[i + 2] ?? 0));
  }
  return b > 0 ? g / b : 0;
}

test.describe('particle and strand materials', () => {
  test('Descending bubbles sink when the signature is still, faster with Fall speed', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const problems = watchConsole(page);
    await openHarness(page);
    const shift = async (props: Record<string, number>) => {
      const base: RenderOpts = {
        materialId: 'bubbles',
        kind: 'still',
        steps: 60,
        seed: 11,
        width: WIDTH,
        height: HEIGHT,
        props,
      };
      const a = luma(await frame(page, base));
      const b = luma(await frame(page, { ...base, steps: 90 }));
      return bestVerticalShift(a, b, 80);
    };
    // Half a second of sinking: about 0.055 short sides (15 px) at baseline.
    const baseline = await shift({});
    expect(baseline).toBeGreaterThan(4);
    expect(baseline).toBeLessThan(30);
    const fast = await shift({ fallSpeed: 1 });
    expect(fast).toBeGreaterThan(baseline * 2);
    expect(problems).toEqual([]);
  });

  test('Filaments spring back toward where they rest with Elasticity', async ({ page }) => {
    test.setTimeout(120_000);
    const problems = watchConsole(page);
    await openHarness(page);
    // Five seconds in, well after the wink; ribbons fade fast so only the strands remain.
    const render = (kind: Kind, elasticity: number) =>
      frame(page, {
        materialId: 'filaments',
        kind,
        steps: 300,
        seed: 3,
        width: WIDTH,
        height: HEIGHT,
        props: { elasticity, persistence: 0 },
      });
    const rest = luma(await render('still', 0.5));
    const slack = meanDifference(luma(await render('wink', 0)), rest);
    const springy = meanDifference(luma(await render('wink', 1)), rest);
    expect(slack).toBeGreaterThan(0.2);
    expect(springy).toBeLessThan(slack * 0.5);
    expect(problems).toEqual([]);
  });

  for (const materialId of ['bubbles', 'filaments']) {
    test(`${materialId}: the close and the open arrive in two different colors`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      const problems = watchConsole(page);
      await openHarness(page);
      const at = async (steps: number) => {
        const opts: RenderOpts = {
          materialId,
          kind: 'wink',
          steps,
          seed: 2,
          width: WIDTH,
          height: HEIGHT,
        };
        return wakeGreenness(
          await frame(page, opts),
          await frame(page, { ...opts, kind: 'still' }),
        );
      };
      // Closing (t = 0.9 s): moving down, ultramarine. Opening (t = 1.4 s): up, sea-glass
      // (over what is left of the close), so the wake turns clearly greener.
      const closing = await at(54);
      const opening = await at(84);
      expect(closing).toBeLessThan(0.7);
      expect(opening).toBeGreaterThan(closing * 1.3);
      expect(problems).toEqual([]);
    });
  }
});
