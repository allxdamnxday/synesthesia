import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';

// The Studio, played like a person would: the transport, sliders, snapshots, Draw by
// chance, saving, the Library, and presentation mode (SPEC 6.3, 13.3, 13.4).

const FIXTURE_PATH = resolve(import.meta.dirname, '../fixtures/sample.sig.json');
const FIXTURE = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as { id: string; name: string };

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error' || /too many active webgl contexts/i.test(text)) errors.push(text);
  });
  return errors;
}

async function importSignature(page: Page): Promise<void> {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Library', level: 1 })).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import file' }).click();
  await (await chooser).setFiles(FIXTURE_PATH);
  await expect(page.getByText(`Added the signature “${FIXTURE.name}”.`)).toBeVisible();
}

/** Open a new composition from the fixture; the first visit measures this computer. */
async function openNewComposition(page: Page): Promise<Locator> {
  await page.goto(`./#/studio/new/${FIXTURE.id}`);
  const wake = page.getByRole('img', { name: 'The wake' });
  await expect(wake).toBeVisible({ timeout: 30_000 });
  return wake;
}

/** Mean luma and the share of clearly lit pixels, from what is actually on screen. */
async function brightness(page: Page, wake: Locator): Promise<{ mean: number; lit: number }> {
  const png = await wake.screenshot();
  return page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const g = canvas.getContext('2d');
    if (!g) throw new Error('no 2d context');
    g.drawImage(bitmap, 0, 0);
    const d = g.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let sum = 0;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i] ?? 0;
      const gg = d[i + 1] ?? 0;
      const b = d[i + 2] ?? 0;
      sum += 0.2126 * r + 0.7152 * gg + 0.0722 * b;
      if (Math.max(r, gg, b) > 24) lit++;
    }
    const n = d.length / 4;
    return { mean: sum / n / 255, lit: lit / n };
  }, png.toString('base64'));
}

function playhead(page: Page): Locator {
  return page.getByRole('slider', { name: 'Playhead' });
}

async function position(page: Page): Promise<number> {
  return Number(await playhead(page).getAttribute('aria-valuenow'));
}

/** Wait until the playhead is inside [from, to) seconds (the composition loops). */
async function waitForPlayhead(page: Page, from: number, to: number): Promise<void> {
  await expect
    .poll(
      async () => {
        const t = await position(page);
        return t >= from && t < to;
      },
      { timeout: 15_000, intervals: [50] },
    )
    .toBe(true);
}

function slider(page: Page, name: string): Locator {
  return page.getByRole('slider', { name, exact: true });
}

async function clickAt(page: Page, target: Locator, fraction: number): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error('no box');
  await page.mouse.click(box.x + box.width * fraction, box.y + box.height / 2);
}

async function lockedNames(page: Page): Promise<string[]> {
  const buttons = page.getByRole('button', { name: /^Unlock / });
  const labels = await buttons.evaluateAll((els) =>
    els.map((el) => (el.getAttribute('aria-label') ?? '').replace(/^Unlock /, '')),
  );
  return labels.sort();
}

test('play, compare, draw by chance, save and reopen a composition', async ({ page }) => {
  const errors = watchErrors(page);
  await importSignature(page);

  await page.goto(`./#/studio/new/${FIXTURE.id}`);
  await expect(page.getByText('Getting to know this computer…')).toBeVisible();
  const wake = page.getByRole('img', { name: 'The wake' });
  await expect(wake).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Getting to know this computer…')).toBeHidden();
  await expect(page.getByTestId('save-state')).toHaveText('Not saved yet');
  await expect(page.locator('video')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Visual Water' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sound Water' })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Linked' })).toBeChecked();

  // Play for about two seconds: the wake appears.
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await waitForPlayhead(page, 1.6, 2.6);
  const water = await brightness(page, wake);
  expect(water.lit).toBeGreaterThan(0.02);

  // Pause (Space, with the Pause button focused) and switch to the bare wake (Signature
  // view): the playhead stays put. Its strokes show the eye opening.
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  const paused = await position(page);
  await page.getByRole('button', { name: 'Visual Water' }).click();
  await page.getByRole('option', { name: /^Signature/ }).click();
  await expect(page.getByRole('button', { name: 'Visual Signature' })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Show readout' })).toBeVisible();
  expect(await position(page)).toBeCloseTo(paused, 2);
  await page.keyboard.press('Space');
  await waitForPlayhead(page, 1.15, 1.35);
  expect((await brightness(page, wake)).lit).toBeGreaterThan(0.001);
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  await page.getByRole('button', { name: 'Visual Signature' }).click();
  await page.getByRole('option', { name: /^Water/ }).click();
  await expect(page.getByRole('button', { name: 'Visual Water' })).toBeVisible();

  // Move a slider, then undo and redo it.
  const viscosity = slider(page, 'Viscosity');
  await expect(viscosity).toHaveAttribute('aria-valuenow', '0.5');
  await clickAt(page, viscosity, 0.8);
  await expect(viscosity).toHaveAttribute('aria-valuenow', '0.8');
  await expect(page.getByTestId('save-state')).toHaveText('Not saved yet');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(viscosity).toHaveAttribute('aria-valuenow', '0.5');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(viscosity).toHaveAttribute('aria-valuenow', '0.8');

  // Snapshot A; change something; recall A while playing: playback carries on.
  await page.getByRole('button', { name: 'Store snapshot A' }).click();
  const brightnessSlider = slider(page, 'Brightness');
  await clickAt(page, brightnessSlider, 0.9);
  await expect(brightnessSlider).toHaveAttribute('aria-valuenow', '0.9');
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await waitForPlayhead(page, 0.8, 1.6);
  const before = await position(page);
  await page.getByRole('button', { name: /^Snapshot A: recall/ }).click();
  await expect(brightnessSlider).toHaveAttribute('aria-valuenow', '0.5');
  await expect(viscosity).toHaveAttribute('aria-valuenow', '0.8');
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect.poll(() => position(page)).toBeGreaterThan(before + 0.2);

  // Keyboard: Space pauses even with a button focused; Shift+2 stores B, 2 recalls it.
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  await page.keyboard.press('Shift+Digit2');
  await expect(page.getByRole('button', { name: /^Snapshot B: recall/ })).toBeVisible();
  await page.keyboard.press('l');
  await expect(page.getByRole('button', { name: 'Loop' })).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('l');
  await expect(page.getByRole('button', { name: 'Loop' })).toHaveAttribute('aria-pressed', 'true');

  // A known seed, then Draw by chance: every other shared property is locked.
  const seed = page.getByRole('textbox', { name: 'Seed' }).first();
  await seed.fill('123456');
  await seed.press('Enter');
  await expect(seed).toHaveValue('123456');
  // Shortcuts don't fire while typing in a field.
  await page.keyboard.press('c');
  await expect(page.getByRole('dialog', { name: 'Draw by chance' })).toBeHidden();
  await seed.blur();
  await page.keyboard.press('c');
  const chance = page.getByRole('dialog', { name: 'Draw by chance' });
  await expect(chance).toBeVisible();
  await expect(chance.getByRole('checkbox', { name: 'Water' })).toHaveCount(2);
  await chance.getByRole('button', { name: 'Draw', exact: true }).click();
  await expect(chance).toBeHidden();
  const locked = await lockedNames(page);
  expect(locked.length).toBeGreaterThanOrEqual(4);
  const first = locked[0] ?? '';
  await expect(slider(page, first)).toHaveAttribute('aria-disabled', 'true');

  // Unlock one deliberately (recorded as an override) and lengthen the tail.
  await page.getByRole('button', { name: `Unlock ${first}` }).click();
  await expect(slider(page, first)).not.toHaveAttribute('aria-disabled', 'true');
  const tail = slider(page, 'Tail');
  await tail.focus();
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
  await expect(tail).toHaveAttribute('aria-valuenow', '4');
  await expect(page.getByText('0:06', { exact: false }).first()).toBeVisible();

  // Notes and status.
  await page.getByRole('textbox', { name: 'Notes' }).fill('The close reads as a fall.');
  await page.getByRole('radio', { name: 'Kept' }).click();

  // Save: the address becomes the saved composition's.
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('save-state')).toHaveText('Saved');
  await expect(page).toHaveURL(/#\/studio\/[0-9a-f-]{36}$/);
  const savedUrl = page.url();

  // The Library lists it with a still of its wake.
  await page
    .getByRole('navigation', { name: 'Where you are' })
    .getByRole('link', { name: 'Library' })
    .click();
  const compositions = page.getByRole('list', { name: 'Compositions' });
  const card = compositions
    .getByRole('listitem')
    .filter({ hasText: 'Sample wink · Water and Water' });
  await expect(card).toHaveCount(1);
  await expect(card.locator('img')).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
  await expect(card).toContainText('kept');

  // Reopen it: everything is as it was saved.
  await card.getByRole('button', { name: /^Open / }).click();
  await expect(page).toHaveURL(savedUrl);
  await expect(wake).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('save-state')).toHaveText('Saved');
  await expect(slider(page, 'Tail')).toHaveAttribute('aria-valuenow', '4');
  await expect(page.getByRole('textbox', { name: 'Seed' }).first()).toHaveValue('123456');
  expect(await lockedNames(page)).toEqual(locked.filter((n) => n !== first));
  await expect(page.getByRole('textbox', { name: 'Notes' })).toHaveValue(
    'The close reads as a fall.',
  );
  await expect(page.getByRole('radio', { name: 'Kept' })).toHaveAttribute('aria-checked', 'true');

  // Presentation mode: only the wake.
  await page.keyboard.press('f');
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeHidden();
  await expect(page.getByRole('complementary', { name: 'Composition controls' })).toBeHidden();
  await expect(playhead(page)).toBeHidden();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
  await expect(wake).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();

  // The source clip never appears in the Studio.
  await expect(page.locator('video')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('unsaved work comes back after a reload, and can be discarded', async ({ page }) => {
  const errors = watchErrors(page);
  await importSignature(page);
  await openNewComposition(page);
  const tail = slider(page, 'Tail');
  await tail.focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft');
  await expect(tail).toHaveAttribute('aria-valuenow', '2.5');
  // Autosave writes about a second after the last change.
  await page.waitForTimeout(1600);

  await page.reload();
  await expect(page.getByRole('img', { name: 'The wake' })).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByText('Restored the composition you were making from this signature.'),
  ).toBeVisible();
  await expect(slider(page, 'Tail')).toHaveAttribute('aria-valuenow', '2.5');

  await page.getByRole('button', { name: 'Discard changes' }).click();
  const confirm = page.getByRole('dialog', { name: 'Discard the unsaved changes?' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Discard changes' }).click();
  await expect(slider(page, 'Tail')).toHaveAttribute('aria-valuenow', '3');
  await expect(page.getByText('Restored the composition')).toBeHidden();

  // Nothing is restored next time.
  await page.reload();
  await expect(page.getByRole('img', { name: 'The wake' })).toBeVisible({ timeout: 30_000 });
  await expect(slider(page, 'Tail')).toHaveAttribute('aria-valuenow', '3');
  await expect(page.getByText('Restored the composition')).toBeHidden();
  expect(errors).toEqual([]);
});
