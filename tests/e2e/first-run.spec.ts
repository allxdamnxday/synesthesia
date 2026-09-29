import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

test('the introduction walks through three steps and opens the sample wink', async ({ page }) => {
  await page.goto('./?introduction=1#/');
  const dialog = page.getByRole('dialog', { name: 'Welcome' });
  await expect(dialog).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('dialog', { name: 'How it goes' })).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  const begin = page.getByRole('dialog', { name: 'Begin' });
  await expect(begin).toBeVisible();
  // (The Library behind it offers the sample wink too, in its How it works steps.)
  await begin.getByRole('button', { name: 'Try the sample wink' }).click();
  await expect(page).toHaveURL(/#\/studio\/new\//);

  // Finished: it doesn't come back, and the sample is in the library.
  await page.goto('./?introduction=1#/');
  await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Sample wink').first()).toBeVisible();
});

test('the introduction can be skipped and shown again from Settings', async ({ page }) => {
  await page.goto('./?introduction=1#/');
  await page.getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto('./?introduction=1#/settings');
  await page.getByRole('button', { name: 'Show the introduction again' }).click();
  await page.goto('./?introduction=1#/');
  await expect(page.getByRole('dialog', { name: 'Welcome' })).toBeVisible();
});

test('the dedication shows once, dismisses on a click, and respects the setting', async ({
  page,
}) => {
  await page.goto('./?dedication=1#/settings');
  const splash = page.getByTestId('dedication');
  await expect(splash).toBeVisible();
  await expect(splash.getByText('Made for Freeman')).toBeVisible();
  await page.mouse.click(10, 10);
  await expect(splash).toBeHidden();

  // Turn it off; a new session no longer shows it.
  await page
    .getByRole('switch', { name: 'Show the dedication when the instrument opens' })
    .uncheck();
  await page.evaluate(() => sessionStorage.clear());
  await page.goto('./?dedication=1#/');
  await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();
  await expect(page.getByTestId('dedication')).toHaveCount(0);
});

test('a clip dropped on the Library opens in Prepare, even with the introduction showing', async ({
  page,
}) => {
  await page.goto('./?introduction=1#/');
  await expect(page.getByRole('dialog', { name: 'Welcome' })).toBeVisible();
  // Simulate dropping a clip file onto the window (bytes read here, in the test process).
  const base64 = readFileSync(resolve(import.meta.dirname, '../fixtures/dot-right.mp4')).toString(
    'base64',
  );
  const dataTransfer = await page.evaluateHandle((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'dot-right.mp4', { type: 'video/mp4' }));
    return dt;
  }, base64);
  await page.dispatchEvent('body', 'dragover', { dataTransfer });
  await page.dispatchEvent('body', 'drop', { dataTransfer });
  await expect(page).toHaveURL(/#\/prepare$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('dot-right.mp4').first()).toBeVisible();
});
