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

  // Help's open-source notices, and the two licenses they point to, come from the cache too.
  await expect(page.getByRole('link', { name: 'read their notices' })).toHaveAttribute(
    'href',
    'third-party-notices.txt',
  );
  const shipped = await page.evaluate(async () => {
    const texts: Record<string, string> = {};
    for (const file of ['third-party-notices.txt', 'vendor/opencv/LICENSE', 'fonts/OFL.txt']) {
      const response = await fetch(file);
      texts[file] = response.ok ? await response.text() : `HTTP ${response.status}`;
    }
    return texts;
  });
  expect(shipped['third-party-notices.txt']).toContain('Mozilla Public License Version 2.0');
  expect(shipped['third-party-notices.txt']).toContain('Copyright (c) 2017 Pavel Dobryakov');
  expect(shipped['vendor/opencv/LICENSE']).toContain('Apache License');
  expect(shipped['fonts/OFL.txt']).toContain('SIL OPEN FONT LICENSE');

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
