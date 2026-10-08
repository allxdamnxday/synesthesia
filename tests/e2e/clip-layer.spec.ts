/**
 * The Studio's clip layer (SPEC 6.3 "Clip layer"), driven like a person would: make a
 * signature from a clip, open it in the Studio, and raise the Clip slider to see the clip
 * over the wake. The layer is hidden until then, follows the transport, sits where the
 * signature was read from, and is gone after a reload (the clip is never stored).
 *
 * Fixture: dot-right.mp4 (320×180, 30 fps, 2.5 s): a bright textured dot gliding right.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures');
const SAMPLE = JSON.parse(readFileSync(join(FIXTURES, 'sample.sig.json'), 'utf8')) as {
  id: string;
  name: string;
};
/** One frame of the fixture clip, in seconds. */
const FRAME = 1 / 30;

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

async function openClip(page: Page, name: string) {
  await page.goto('./#/prepare');
  const chooser = page.waitForEvent('filechooser');
  await page
    .getByRole('button', { name: /^Choose (a|another) clip…$/ })
    .first()
    .click();
  await (await chooser).setFiles(join(FIXTURES, name));
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

/** Extract, save, and arrive in the Studio with the wake on screen. */
async function extractAndOpenInStudio(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Extract signature' }).click();
  await expect(page.getByRole('heading', { name: 'Signature', exact: true })).toBeVisible({
    timeout: 90_000,
  });
  await page.getByRole('button', { name: 'Save and open in Studio' }).click();
  await expect(page).toHaveURL(/#\/studio\/new\/[0-9a-f-]{36}$/);
  const wake = page.getByRole('img', { name: 'The wake' });
  await expect(wake).toBeVisible({ timeout: 30_000 });
  return wake;
}

type Rect = { x: number; y: number; width: number; height: number };

async function box(target: Locator): Promise<Rect> {
  const rect = await target.boundingBox();
  if (!rect) throw new Error('Nothing on screen to measure');
  return rect;
}

/** The brightest pixel (luma, 0..255) of a part of the page as it is on screen. */
async function brightest(page: Page, clip: Rect): Promise<number> {
  const png = await page.screenshot({ clip });
  return page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const g = canvas.getContext('2d');
    if (!g) throw new Error('no 2d context');
    g.drawImage(bitmap, 0, 0);
    const d = g.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let max = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.2126 * (d[i] ?? 0) + 0.7152 * (d[i + 1] ?? 0) + 0.0722 * (d[i + 2] ?? 0);
      if (l > max) max = l;
    }
    return max;
  }, png.toString('base64'));
}

function clipSlider(page: Page): Locator {
  return page.getByRole('slider', { name: 'Clip', exact: true });
}

function playhead(page: Page): Locator {
  return page.getByRole('slider', { name: 'Playhead' });
}

async function position(page: Page): Promise<number> {
  return Number(await playhead(page).getAttribute('aria-valuenow'));
}

/** Where the clip's <video> is, and whether it is running. */
function clipState(page: Page): Promise<{ time: number; paused: boolean; rate: number }> {
  return page.locator('video').evaluate((v: HTMLVideoElement) => ({
    time: v.currentTime,
    paused: v.paused,
    rate: v.playbackRate,
  }));
}

test('the clip lies over the wake when its slider is raised, and only then', async ({ page }) => {
  const errors = watchErrors(page);
  await openClip(page, 'dot-right.mp4');
  // Box the path of the dot: 60% wide and 50% tall, 20% from the left, 25% from the top.
  await drawBox(page, [0.2, 0.25], [0.8, 0.75]);
  const wake = await extractAndOpenInStudio(page);

  // Every composition opens with the source out of sight: no clip in the page at all.
  const slider = clipSlider(page);
  await expect(slider).toHaveAttribute('aria-valuetext', '0%');
  await expect(page.locator('video')).toHaveCount(0);
  await expect(page.getByTestId('clip-layer')).toHaveCount(0);
  const canvas = await box(wake);
  // Nothing has played yet, so the stage is dark.
  expect(await brightest(page, canvas)).toBeLessThan(40);

  // All the way up: the clip alone, exactly over the canvas.
  await slider.focus();
  await slider.press('End');
  await expect(slider).toHaveAttribute('aria-valuetext', '100%');
  const layer = page.getByTestId('clip-layer');
  await expect(layer).toBeVisible();
  await expect(layer).toHaveCSS('opacity', '1');
  await expect(page.locator('video')).toHaveCount(1);
  const over = await box(layer);
  for (const side of ['x', 'y', 'width', 'height'] as const) {
    expect(Math.abs(over[side] - canvas[side])).toBeLessThanOrEqual(1);
  }
  await expect.poll(() => brightest(page, canvas)).toBeGreaterThan(120);

  // The boxed part of the clip fills the rectangle the movement acts on (full width here,
  // 15/32 of it tall, since the box is wider than the 16:9 canvas), so the whole clip is
  // 1/0.6 as wide and 1/0.5 as tall as that, and spills past the canvas.
  const video = await box(page.locator('video'));
  const fieldHeight = (canvas.width * 15) / 32;
  expect(Math.abs(video.width - canvas.width / 0.6)).toBeLessThanOrEqual(2);
  expect(Math.abs(video.height - fieldHeight / 0.5)).toBeLessThanOrEqual(2);
  expect(Math.abs(video.x + 0.2 * video.width - canvas.x)).toBeLessThanOrEqual(2);
  expect(
    Math.abs(video.y + 0.25 * video.height - (canvas.y + (canvas.height - fieldHeight) / 2)),
  ).toBeLessThanOrEqual(2);

  // Halfway: the clip and the (still dark) wake share the picture.
  await slider.press('Home');
  await expect(page.locator('video')).toHaveCount(0);
  for (let i = 0; i < 5; i++) await slider.press('Shift+ArrowRight');
  await expect(slider).toHaveAttribute('aria-valuetext', '50%');
  await expect(layer).toHaveCSS('opacity', '0.5');
  await expect.poll(() => brightest(page, canvas)).toBeGreaterThan(60);
  expect(await brightest(page, canvas)).toBeLessThan(170);

  // Paused, the clip shows the frame the playhead is at: one frame into the trim at the
  // start, and wherever the playhead is put.
  await expect.poll(async () => (await clipState(page)).time).toBeCloseTo(FRAME, 1);
  expect((await clipState(page)).paused).toBe(true);
  const track = await box(playhead(page));
  await page.mouse.click(track.x + track.width * 0.2, track.y + track.height / 2);
  const at = await position(page);
  expect(at).toBeGreaterThan(0.5);
  expect(at).toBeLessThan(2.4); // still inside the movement, before the tail
  await expect
    .poll(async () => Math.abs((await clipState(page)).time - (at + FRAME)))
    .toBeLessThan(FRAME);

  // Playing, it runs along with the playhead.
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(async () => (await clipState(page)).paused).toBe(false);
  await page.waitForTimeout(600);
  const [running, t] = await Promise.all([clipState(page), position(page)]);
  if (t < 2.3) expect(Math.abs(running.time - (t + FRAME))).toBeLessThan(0.25);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect.poll(async () => (await clipState(page)).paused).toBe(true);

  // Saving keeps the view as it is, and puts no picture in the composition.
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/#\/studio\/[0-9a-f-]{36}$/);
  await expect(slider).toHaveAttribute('aria-valuetext', '50%');
  await expect(layer).toBeVisible();

  // Presentation mode shows the picture as it is set, clip included.
  await page.keyboard.press('f');
  await expect(page.getByRole('complementary', { name: 'Composition controls' })).toBeHidden();
  await expect(layer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(slider).toBeVisible();

  // The clip is never stored: after a reload it is gone, and so is its slider.
  await page.reload();
  await expect(page.getByRole('img', { name: 'The wake' })).toBeVisible({ timeout: 30_000 });
  await expect(clipSlider(page)).toHaveCount(0);
  await expect(page.locator('video')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a turned and mirrored clip lies over the wake the way it was read', async ({ page }) => {
  const errors = watchErrors(page);
  await openClip(page, 'dot-right.mp4');
  await page.getByRole('radio', { name: '90°', exact: true }).click();
  await page.getByRole('switch', { name: 'Mirror' }).click();
  const wake = await extractAndOpenInStudio(page);

  const slider = clipSlider(page);
  await slider.focus();
  await slider.press('End');
  const video = page.locator('video');
  await expect(page.getByTestId('clip-layer')).toBeVisible();
  expect(await video.evaluate((v) => v.style.transform)).toBe(
    'translate(-50%, -50%) scaleX(-1) rotate(90deg)',
  );
  // A quarter turn stands the clip up: fitted inside the 16:9 canvas, as tall as it.
  const canvas = await box(wake);
  const shown = await box(video);
  expect(Math.abs(shown.height - canvas.height)).toBeLessThanOrEqual(2);
  expect(Math.abs(shown.width - (canvas.height * 18) / 32)).toBeLessThanOrEqual(2);
  expect(Math.abs(shown.x + shown.width / 2 - (canvas.x + canvas.width / 2))).toBeLessThanOrEqual(
    2,
  );

  // Range moves the movement, so it moves the clip with it: all the way up is 2.5 times.
  // (Range is a shared property: while Linked is on it sits with the linked sliders.)
  const linked = page.getByRole('region', { name: 'Linked properties' });
  await linked.getByRole('button', { name: /^More/ }).click();
  const range = linked.getByRole('slider', { name: 'Range' });
  await range.focus();
  await range.press('End');
  await expect.poll(async () => (await box(video)).height / canvas.height).toBeCloseTo(2.5, 1);
  expect(errors).toEqual([]);
});

test('a signature whose clip was not brought in this visit has no clip to show', async ({
  page,
}) => {
  await page.goto('./');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import file' }).click();
  await (await chooser).setFiles(join(FIXTURES, 'sample.sig.json'));
  await expect(page.getByText(`Added the signature “${SAMPLE.name}”.`)).toBeVisible();

  await page.goto(`./#/studio/new/${SAMPLE.id}`);
  await expect(page.getByRole('img', { name: 'The wake' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('slider', { name: 'Signature strength' })).toBeVisible();
  await expect(clipSlider(page)).toHaveCount(0);
  await expect(page.locator('video')).toHaveCount(0);
});
