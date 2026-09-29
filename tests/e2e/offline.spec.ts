import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures');

test.use({ serviceWorkers: 'allow' });

// SPEC C5 / M8: after the first visit, the instrument loads and works with the network off.
test('after the first visit, the instrument works offline, extraction included', async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();
  // `ready` resolves once the service worker has installed (precached everything) and is active.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();

  await page.goto('./#/help');
  await expect(page.getByRole('heading', { name: 'The idea' })).toBeVisible();

  // The guide and every one of its pictures (lazy-loaded, never seen online) come from the cache.
  await page.goto('./#/guide/albums');
  await expect(page.getByRole('heading', { level: 2, name: 'Albums' })).toBeInViewport();
  const pictures = page.locator('article img');
  const count = await pictures.count();
  expect(count).toBeGreaterThan(10);
  for (let i = 0; i < count; i++) {
    const picture = pictures.nth(i);
    await picture.scrollIntoViewIfNeeded();
    await expect
      .poll(() => picture.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
      .toBeGreaterThan(0);
  }

  // Extract a signature with the network off: OpenCV.js and the worker come from the cache.
  await page.goto('./#/prepare');
  const chooser = page.waitForEvent('filechooser');
  await page
    .getByRole('button', { name: /^Choose (a|another) clip…$/ })
    .first()
    .click();
  await (await chooser).setFiles(join(FIXTURES, 'dot-right.mp4'));
  await page.getByRole('button', { name: 'Extract signature' }).click();
  await expect(page.getByRole('heading', { name: 'Signature', exact: true })).toBeVisible({
    timeout: 120_000,
  });
  await context.setOffline(false);
});
