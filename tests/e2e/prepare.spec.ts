/**
 * The Prepare screen, driven like a person would: pick a clip, trim it, box the moving
 * part, turn it, extract, look at the wake, name it, save it and take it to the Studio.
 * Fixture clips (tests/fixtures/, made by scripts/make-fixtures.mjs) are 320×180, 30 fps:
 * dot-right.mp4 (2.5 s, a dot gliding right), ring-expand.mp4 (2 s), pan-right.mp4 (2 s, the
 * whole picture drifting, so the automatic noise floor comes out high).
 */
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures');
const FORMAT_MESSAGE = "This clip's format can't be read in this browser.";

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

type ChosenFile = string | { name: string; mimeType: string; buffer: Buffer };

async function chooseClip(page: Page, file: ChosenFile) {
  const chooser = page.waitForEvent('filechooser');
  await page
    .getByRole('button', { name: /^Choose (a|another) clip…$/ })
    .first()
    .click();
  await (await chooser).setFiles(typeof file === 'string' ? join(FIXTURES, file) : file);
}

async function openClip(page: Page, name: string) {
  await chooseClip(page, name);
  await expect(page.getByRole('button', { name: 'Extract signature' })).toBeEnabled();
}

/** Drag across the clip from one point to another (fractions of the displayed frame). */
async function drawBox(page: Page, from: [number, number], to: [number, number]) {
  const frame = await page.getByTestId('clip-frame').boundingBox();
  if (!frame) throw new Error('No clip frame');
  const at = ([x, y]: [number, number]) => [frame.x + x * frame.width, frame.y + y * frame.height];
  const [x0, y0] = at(from);
  const [x1, y1] = at(to);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 });
  await page.mouse.move(x1, y1, { steps: 4 });
  await page.mouse.up();
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

interface StoredSignature {
  id: string;
  name: string;
  preferredSpeed: number;
  frameCount: number;
  source: {
    fileName: string;
    trim: { startSec: number; endSec: number };
    rotate: number;
    mirror: boolean;
    focusArea: { x: number; y: number; w: number; h: number } | null;
  };
  [key: string]: unknown;
}

/** Read a saved signature straight from the library's IndexedDB. */
function storedSignature(page: Page, id: string): Promise<StoredSignature | undefined> {
  return page.evaluate(async (key) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('synesthesia');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('open failed'));
    });
    try {
      return await new Promise<StoredSignature | undefined>((resolve, reject) => {
        const request = db.transaction('signatures').objectStore('signatures').get(key);
        request.onsuccess = () => resolve(request.result as StoredSignature | undefined);
        request.onerror = () => reject(request.error ?? new Error('get failed'));
      });
    } finally {
      db.close();
    }
  }, id);
}

async function waitForSignatureView(page: Page) {
  await expect(page.getByRole('progressbar', { name: 'Extracting the signature' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Signature', exact: true })).toBeVisible({
    timeout: 90_000,
  });
  await expect(page.getByRole('progressbar')).toHaveCount(0);
}

test('shape a clip, extract its signature, save it and open it in the Studio', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./#/prepare');
  await expect(page.getByRole('heading', { name: 'Prepare', level: 1 })).toBeVisible();
  await expect(page.getByText('Drop a clip here')).toBeVisible();

  await openClip(page, 'dot-right.mp4');
  await expect(page.getByText('dot-right.mp4', { exact: true })).toBeVisible();
  const summary = page.getByTestId('trim-summary');
  await expect(summary).toHaveText('0:00.00 to 0:02.50 · 2.5 seconds');

  // Trim three frames off each end with the keyboard.
  const start = page.getByRole('slider', { name: 'Trim start' });
  await start.focus();
  for (let i = 0; i < 3; i++) await start.press('ArrowRight');
  const end = page.getByRole('slider', { name: 'Trim end' });
  await end.focus();
  for (let i = 0; i < 3; i++) await end.press('ArrowLeft');
  await expect(summary).toHaveText('0:00.10 to 0:02.40 · 2.3 seconds');

  // While previewing, the playhead loops inside the trim.
  await page.getByRole('button', { name: 'Play the clip' }).click();
  const playhead = page.getByRole('slider', { name: 'Playhead' });
  const seen: number[] = [];
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(200);
    seen.push(Number(await playhead.getAttribute('aria-valuenow')));
  }
  await page.getByRole('button', { name: 'Pause the clip' }).click();
  expect(Math.min(...seen)).toBeGreaterThanOrEqual(0.1 - 1e-6);
  expect(Math.max(...seen)).toBeLessThanOrEqual(2.4 - 1 / 30 + 1e-6);
  expect(new Set(seen).size).toBeGreaterThan(3); // it really played

  // Box the path of the dot.
  await drawBox(page, [0.2, 0.25], [0.8, 0.75]);
  await expect(
    page.getByText('Using a box 60% wide and 50% tall, 20% from the left and 25% from the top.'),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Extract signature' }).click();
  await waitForSignatureView(page);

  // The source is hidden by default; the wake plays alone.
  await expect(page.getByTestId('clip-pane')).toBeHidden();
  await expect(page.getByTestId('wake-pane')).toBeVisible();
  await expect(page.getByTestId('sparklines')).toBeVisible();
  for (const name of [/^Energy/, /^Direction/, /^Expansion/, /^Continuity/, /^Density/]) {
    await expect(page.getByRole('img', { name })).toBeVisible();
  }
  await expect(page.getByTestId('signature-facts')).toContainText('seconds of movement');

  // Pause halfway, while the dot crosses the box: the wake is drawn, not black.
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('slider', { name: 'Playhead' }).click();
  await page.waitForTimeout(300);
  const wake = await brightness(page, page.getByTestId('wake-pane'));
  expect(wake.max).toBeGreaterThan(120);
  expect(wake.lit).toBeGreaterThan(0.001);

  // Show the source beside the wake, then hide it again.
  await page.getByText('Hide source', { exact: true }).click();
  await expect(page.getByTestId('clip-pane')).toBeVisible();
  await expect(page.getByText('Clip', { exact: true })).toBeVisible();
  await page.getByText('Hide source', { exact: true }).click();
  await expect(page.getByTestId('clip-pane')).toBeHidden();

  // Name it and save it.
  const name = page.getByRole('textbox', { name: 'Name' });
  await expect(name).toHaveValue('dot-right');
  await name.fill('E2E wink');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved to your library.')).toBeVisible();

  await page.getByRole('button', { name: 'Open in Studio' }).click();
  await expect(page).toHaveURL(/#\/studio\/new\/[0-9a-f-]{36}$/);
  const id = decodeURIComponent(page.url().split('/').pop() ?? '');
  // The clip is gone with the Prepare screen.
  await expect(page.locator('video')).toHaveCount(0);

  const saved = await storedSignature(page, id);
  expect(saved?.name).toBe('E2E wink');
  expect(saved?.preferredSpeed).toBe(1);
  expect(saved?.source.fileName).toBe('dot-right.mp4');
  expect(saved?.source.trim.startSec).toBeCloseTo(0.1, 6);
  expect(saved?.source.trim.endSec).toBeCloseTo(2.4, 6);
  expect(saved?.source.focusArea).toEqual({ x: 0.2, y: 0.25, w: 0.6, h: 0.5 });
  // Movement data only: no picture of any kind is stored.
  expect(JSON.stringify(saved)).not.toMatch(/data:image|video\/|blob:/);

  await page.goto('./#/');
  const card = page
    .getByRole('list', { name: 'Signatures' })
    .getByRole('listitem')
    .filter({ hasText: 'E2E wink' });
  await expect(card).toHaveCount(1);
  await expect(page.locator('video')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('rotate and mirror are previewed live and carried into the signature', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./#/prepare');
  await openClip(page, 'dot-right.mp4');

  // Make a box from the keyboard, move it, and make it wider.
  await page.getByRole('button', { name: 'Draw a box' }).click();
  const box = page.getByRole('group', { name: /^Focus area/ });
  await expect(box).toBeFocused();
  await expect(box).toHaveAccessibleName(
    'Focus area: 40% wide and 40% tall, 30% from the left and 30% from the top',
  );
  await box.press('Shift+ArrowUp');
  await box.press('Alt+ArrowRight');
  await expect(box).toHaveAccessibleName(
    'Focus area: 41% wide and 40% tall, 30% from the left and 25% from the top',
  );

  const video = page.locator('video');
  const frame = page.getByTestId('clip-frame');
  await page.getByRole('radio', { name: '90°', exact: true }).click();
  await expect(video).toHaveCSS('transform', /matrix/);
  expect(await video.evaluate((v) => v.style.transform)).toBe(
    'translate(-50%, -50%) rotate(90deg)',
  );
  const tall = await frame.boundingBox();
  expect(tall && tall.height > tall.width).toBe(true);
  // The box turned with the picture: the top-left box is now at the top right, standing up.
  await expect(box).toHaveAccessibleName(
    'Focus area: 40% wide and 41% tall, 35% from the left and 30% from the top',
  );

  await page.getByText('Mirror', { exact: true }).click();
  expect(await video.evaluate((v) => v.style.transform)).toBe(
    'translate(-50%, -50%) scaleX(-1) rotate(90deg)',
  );
  await expect(box).toHaveAccessibleName(
    'Focus area: 40% wide and 41% tall, 25% from the left and 30% from the top',
  );

  // A dot moving right, turned a quarter clockwise, moves down; mirroring keeps it down.
  await page.getByRole('button', { name: 'Extract signature' }).click();
  await waitForSignatureView(page);
  const arrows = await page
    .getByTestId('sparklines')
    .locator('svg[viewBox="-8 -8 16 16"]')
    .evaluateAll((els) =>
      els.map((el) => parseFloat(/-?[\d.]+/.exec(el.style.transform)?.[0] ?? 'NaN')),
    );
  expect(arrows.length).toBeGreaterThan(5);
  const median = [...arrows].sort((a, b) => a - b)[Math.floor(arrows.length / 2)];
  expect(Math.abs(median - 90)).toBeLessThan(15);

  await page.getByRole('button', { name: 'Save and open in Studio' }).click();
  await expect(page).toHaveURL(/#\/studio\/new\/[0-9a-f-]{36}$/);
  const id = decodeURIComponent(page.url().split('/').pop() ?? '');
  const saved = await storedSignature(page, id);
  expect(saved?.source.rotate).toBe(90);
  expect(saved?.source.mirror).toBe(true);
  expect(saved?.source.focusArea).toEqual({ x: 0.25, y: 0.3, w: 0.4, h: 0.41 });
  expect(errors).toEqual([]);
});

test('cancelling mid-extraction returns to the clip with its settings', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./#/prepare');
  await openClip(page, 'ring-expand.mp4');

  // Finer analysis takes a little longer, which leaves time to cancel.
  await page.getByText('Advanced', { exact: true }).click();
  await page.getByRole('radio', { name: '480', exact: true }).click();
  await page.getByRole('radio', { name: '48', exact: true }).click();

  await page.getByRole('button', { name: 'Extract signature' }).click();
  await expect(page.getByText('Finding the movement…')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Cancel' }).click();

  await expect(page.getByText('Extraction stopped. Your settings are kept.')).toBeVisible();
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Extract signature' })).toBeEnabled();
  await expect(page.getByTestId('clip-pane')).toBeVisible();
  await expect(page.getByRole('radio', { name: '480', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );

  // And it can extract again straight away.
  await page.getByRole('button', { name: 'Extract signature' }).click();
  await waitForSignatureView(page);
  expect(errors).toEqual([]);
});

test('a file that is not a clip gets the plain format message', async ({ page }) => {
  await page.goto('./#/prepare');
  await chooseClip(page, {
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('This is a text file, not a movie.'),
  });
  await expect(page.getByText(FORMAT_MESSAGE, { exact: false })).toBeVisible();
  await expect(page.getByText('Most Compatible', { exact: false })).toBeVisible();
  await expect(page.locator('video')).toHaveCount(0);

  // A real clip still opens afterwards.
  await openClip(page, 'dot-right.mp4');
  await expect(page.getByText(FORMAT_MESSAGE, { exact: false })).toHaveCount(0);
  await expect(page.locator('video')).toHaveCount(1);
});

test('a clip that keeps moving suggests raising Sensitivity', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./#/prepare');
  await openClip(page, 'pan-right.mp4');
  await page.getByRole('button', { name: 'Extract signature' }).click();
  await waitForSignatureView(page);
  await expect(page.getByText(/raise Sensitivity/)).toBeVisible();

  // Extract again brings back the clip and its settings.
  await page.getByRole('button', { name: 'Extract again' }).click();
  await expect(page.getByRole('button', { name: 'Extract signature' })).toBeEnabled();
  await expect(page.getByTestId('trim-summary')).toHaveText('0:00.00 to 0:02.00 · 2 seconds');
  expect(errors).toEqual([]);
});
