/**
 * The Signature screen (#/signature/:id), reached from the Library after importing the
 * sample wink (tests/fixtures/sample.sig.json: 2.2 s, onsets at frames 21 and 37 of 66).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';

const FIXTURE_PATH = resolve(import.meta.dirname, '../fixtures/sample.sig.json');
const FIXTURE = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as {
  id: string;
  name: string;
  contentHash: string;
  frameCount: number;
  source: { fileName: string; focusArea: unknown };
  features: { onsets: number[] };
};

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error' || /WebGL context/i.test(msg.text())) errors.push(msg.text());
  });
  return errors;
}

/** Remember every WebGL2 context made for a wake canvas, to check they are released. */
async function trackWakeContexts(page: Page) {
  await page.addInitScript(() => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- called below with the canvas as `this`
    const original = HTMLCanvasElement.prototype.getContext;
    const contexts: WebGL2RenderingContext[] = [];
    (window as unknown as { spWakeContexts: WebGL2RenderingContext[] }).spWakeContexts = contexts;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      ...args: Parameters<HTMLCanvasElement['getContext']>
    ) {
      const ctx = original.apply(this, args);
      if (args[0] === 'webgl2' && ctx && this.dataset.wakeCanvas !== undefined) {
        contexts.push(ctx as WebGL2RenderingContext);
      }
      return ctx;
    } as HTMLCanvasElement['getContext'];
  });
}

function liveWakeContexts(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (window as unknown as { spWakeContexts: WebGL2RenderingContext[] }).spWakeContexts.filter(
        (c) => !c.isContextLost(),
      ).length,
  );
}

async function importSample(page: Page) {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Library', level: 1 })).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import file' }).click();
  await (await chooser).setFiles(FIXTURE_PATH);
  await expect(page.getByText(`Added the signature “${FIXTURE.name}”.`)).toBeVisible();
}

/** Share of pixels brighter than a dim grey, and the brightest, in a screenshot of `target`. */
async function brightness(page: Page, target: Locator): Promise<{ lit: number; max: number }> {
  const png = await target.screenshot();
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2D context');
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let lit = 0;
    let max = 0;
    for (let i = 0; i < data.length; i += 4) {
      const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      if (l > 60) lit++;
      if (l > max) max = l;
    }
    return { lit: lit / (data.length / 4), max };
  }, png.toString('base64'));
}

test('a saved signature plays its wake, with its facts and what to do next', async ({ page }) => {
  const errors = watchErrors(page);
  await trackWakeContexts(page);
  await importSample(page);

  await page.getByRole('button', { name: `Open ${FIXTURE.name}`, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#/signature/${FIXTURE.id}$`));
  await expect(page.getByRole('heading', { name: FIXTURE.name, level: 1 })).toBeVisible();

  const about = page.getByRole('complementary', { name: 'About this signature' });
  await expect(about).toContainText('2.2 seconds of movement');
  await expect(about).toContainText('2 moments of sudden movement');
  await expect(about).toContainText('Plays at 1× by default');
  await expect(about).toContainText(
    `“${FIXTURE.source.fileName}”${FIXTURE.source.focusArea ? ', using a focus area' : ''}`,
  );

  await expect(page.getByTestId('sparklines')).toBeVisible();
  await expect(page.getByTestId('onset-marker')).toHaveCount(FIXTURE.features.onsets.length);
  await expect(page.getByText('Moments of sudden movement', { exact: true })).toBeVisible();

  // Space pauses; then move the playhead to the eyelid closing: the wake is drawn there.
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  const plots = page.getByRole('group', { name: /^Movement over time/ });
  const area = await plots.boundingBox();
  if (!area) throw new Error('No sparklines');
  const onset = (FIXTURE.features.onsets[0] + 1) / FIXTURE.frameCount;
  await page.mouse.click(area.x + onset * area.width, area.y + area.height / 2);
  await page.waitForTimeout(300);
  const lit = await brightness(page, page.getByRole('img', { name: /^The wake of/ }));
  expect(lit.max).toBeGreaterThan(120);
  expect(lit.lit).toBeGreaterThan(0.001);
  // Still paused after seeking.
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();

  // Rename in place.
  await page.getByRole('button', { name: `Rename ${FIXTURE.name}` }).click();
  const field = page.getByRole('textbox', { name: `New name for ${FIXTURE.name}` });
  await expect(field).toBeFocused();
  await field.fill('Left eye');
  await field.press('Enter');
  await expect(page.getByRole('heading', { name: 'Left eye', level: 1 })).toBeVisible();

  // Export downloads the same movement under the new name.
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export file' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('Left-eye.sig.json');
  const exported = JSON.parse(readFileSync(await download.path(), 'utf8')) as typeof FIXTURE;
  expect(exported.contentHash).toBe(FIXTURE.contentHash);
  await expect(page.getByText('Exported as “Left-eye.sig.json”.')).toBeVisible();

  expect(await liveWakeContexts(page)).toBe(1);
  await page.getByRole('button', { name: 'Start a composition' }).click();
  await expect(page).toHaveURL(new RegExp(`#/studio/new/${FIXTURE.id}$`));
  // Leaving the screen releases the wake's graphics context.
  await expect.poll(() => liveWakeContexts(page)).toBe(0);

  await page.goto('./#/');
  await expect(
    page.getByRole('list', { name: 'Signatures' }).getByRole('heading', { name: 'Left eye' }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('visiting a signature again and again never piles up graphics contexts', async ({ page }) => {
  const errors = watchErrors(page);
  await trackWakeContexts(page);
  await importSample(page);
  for (let i = 0; i < 20; i++) {
    await page.goto(`./#/signature/${FIXTURE.id}`);
    await expect(page.getByRole('heading', { name: FIXTURE.name, level: 1 })).toBeVisible();
    await expect(page.locator('[data-wake-canvas]')).toHaveCount(1);
    await page.goto('./#/');
    await expect(page.getByRole('heading', { name: 'Library', level: 1 })).toBeVisible();
  }
  await expect.poll(() => liveWakeContexts(page)).toBe(0);
  expect(errors).toEqual([]);
});

test('with reduced motion preferred, the wake waits to be played', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await importSample(page);
  await page.goto(`./#/signature/${FIXTURE.id}`);
  await expect(page.getByRole('heading', { name: FIXTURE.name, level: 1 })).toBeVisible();
  const play = page.getByRole('button', { name: 'Play', exact: true });
  await expect(play).toBeVisible();
  const scrub = page.getByRole('slider', { name: 'Playhead' });
  await page.waitForTimeout(500);
  await expect(scrub).toHaveAttribute('aria-valuenow', '0');
  await play.click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await expect
    .poll(async () => Number(await scrub.getAttribute('aria-valuenow')))
    .toBeGreaterThan(0);
});

test('a signature that is not in the library says so calmly', async ({ page }) => {
  await page.goto('./#/signature/not-a-real-signature');
  await expect(
    page.getByRole('heading', { name: 'This signature isn’t in your library' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Back to the library' }).click();
  await expect(page.getByRole('heading', { name: 'Library', level: 1 })).toBeVisible();
});
