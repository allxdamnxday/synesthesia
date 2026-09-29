import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// The Guide page renders docs/USER_GUIDE.md itself: these tests read the file for what to expect.
const GUIDE = readFileSync(join(import.meta.dirname, '..', '..', 'docs', 'USER_GUIDE.md'), 'utf8');
const SECTIONS = [...GUIDE.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
const SUBSECTIONS = [...GUIDE.matchAll(/^### (.+)$/gm)].map((m) => m[1].trim());
/** Sections and their sub-sections, in the order the contents lists them. */
const HEADINGS = [...GUIDE.matchAll(/^###? (.+)$/gm)].map((m) => m[1].trim());
const PICTURES = (GUIDE.match(/!\[/g) ?? []).length;

/** Console errors, page errors, and any request that leaves this site. */
function watch(page: Page, baseURL: string | undefined) {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  page.on('request', (r) => {
    const url = r.url();
    if (!url.startsWith(baseURL ?? '') && !/^(data|blob):/.test(url)) {
      problems.push(`request: ${url}`);
    }
  });
  return problems;
}

/** Scroll each picture into view (they load lazily) and check it arrived at its reserved size. */
async function expectEveryPictureLoads(page: Page) {
  const pictures = page.locator('article img');
  await expect(pictures).toHaveCount(PICTURES);
  for (let i = 0; i < PICTURES; i++) {
    const picture = pictures.nth(i);
    await picture.scrollIntoViewIfNeeded();
    await expect
      .poll(() => picture.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
      .toBeGreaterThan(0);
    const [natural, reserved] = await picture.evaluate((img: HTMLImageElement) => [
      `${img.naturalWidth}×${img.naturalHeight}`,
      `${img.getAttribute('width')}×${img.getAttribute('height')}`,
    ]);
    expect(natural).toBe(reserved);
  }
}

/**
 * Neither the screen's content nor the guide is wider than the window, and tables fit their
 * boxes. The app header is left out: at phone widths it is wider than the screen on every
 * screen for now (it is being redesigned separately).
 */
async function expectNoSidewaysScroll(page: Page) {
  const sizes = await page.evaluate(() => {
    const main = document.querySelector('main');
    const article = document.querySelector('article');
    return {
      window: window.innerWidth,
      main: main?.scrollWidth ?? 0,
      articleRight: article?.getBoundingClientRect().right ?? 0,
      tablesOverflow: [...document.querySelectorAll('article table')].some(
        (t) => (t.parentElement?.scrollWidth ?? 0) > (t.parentElement?.clientWidth ?? 0),
      ),
    };
  });
  expect(sizes.main).toBeLessThanOrEqual(sizes.window);
  expect(sizes.articleRight).toBeLessThanOrEqual(sizes.window);
  expect(sizes.tablesOverflow).toBe(false);
}

test('#/guide shows every section of docs/USER_GUIDE.md, in order, and every picture', async ({
  page,
  baseURL,
}) => {
  const problems = watch(page, baseURL);
  await page.goto('./#/guide');
  await expect(page.getByRole('heading', { level: 1, name: 'Synesthesia: a guide' })).toBeVisible();
  await expect(page.locator('article h2')).toHaveText(SECTIONS);
  await expect(page.locator('article h3')).toHaveText(SUBSECTIONS);
  await expectEveryPictureLoads(page);
  expect(problems).toEqual([]);
});

test('each entry in the contents goes to its section', async ({ page, baseURL }) => {
  const problems = watch(page, baseURL);
  await page.goto('./#/guide');
  const contents = page.getByRole('navigation', { name: 'Guide contents' });
  const links = contents.getByRole('link');
  await expect(links).toHaveText(HEADINGS);
  const count = await links.count();
  for (let i = 0; i < count; i++) {
    const link = links.nth(i);
    const to = (await link.getAttribute('href')) ?? '';
    expect(to).toMatch(/^#\/guide\/[a-z-]+$/);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${to}$`));
    const heading = page.locator(`#guide-${to.split('/').pop()}`);
    await expect(heading).toHaveText((await link.textContent()) ?? '');
    await expect(heading).toBeInViewport();
    await expect(heading).toBeFocused();
    await expect(link).toHaveAttribute('aria-current', 'location');
  }
  // Clicking the entry for where the address already is still goes there.
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.locator('h1')).toBeInViewport();
  await links.last().click();
  await expect(
    page.locator(`#guide-${(await links.last().getAttribute('href'))?.split('/').pop()}`),
  ).toBeInViewport();
  expect(problems).toEqual([]);
});

test('deep links go straight to a section; a wrong one shows the guide from the top', async ({
  page,
  baseURL,
}) => {
  const problems = watch(page, baseURL);
  await page.goto('./#/guide/albums');
  const albums = page.getByRole('heading', { level: 2, name: 'Albums' });
  await expect(albums).toBeInViewport();
  await expect(albums).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

  // A link inside the guide's text (to "Keeping your work safe") goes through the router.
  await page.goto('./#/guide/before-you-start');
  await page
    .locator('article')
    .getByRole('link', { name: 'Keeping your work safe' })
    .first()
    .click();
  await expect(page).toHaveURL(/#\/guide\/backup$/);
  await expect(
    page.getByRole('heading', { level: 2, name: 'Keeping your work safe' }),
  ).toBeInViewport();

  await page.goto('./#/guide/no-such-section');
  await expect(page.getByText('The guide has no section called “no-such-section”.')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toBeInViewport();
  await expect(page.locator('article h2')).toHaveText(SECTIONS);
  expect(problems).toEqual([]);
});

test('a picture opens larger and closes again', async ({ page, baseURL }) => {
  const problems = watch(page, baseURL);
  await page.goto('./#/guide/library');
  const open = page.getByRole('button', { name: 'The Library (show larger)' });
  await open.click();
  const viewer = page.getByRole('dialog', { name: 'The Library' });
  await expect(viewer).toBeVisible();
  const large = viewer.getByRole('img', { name: 'The Library' });
  await expect
    .poll(() => large.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
    .toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await expect(viewer).toBeHidden();
  await expect(open).toBeFocused();
  await open.click();
  await viewer.getByRole('button', { name: 'Close' }).click();
  await expect(viewer).toBeHidden();
  expect(problems).toEqual([]);
});

test('on a phone the guide fits the screen, with its contents folded away', async ({
  page,
  baseURL,
}) => {
  const problems = watch(page, baseURL);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('./#/guide');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expectNoSidewaysScroll(page);

  const contents = page.getByRole('navigation', { name: 'Guide contents' });
  await expect(contents.getByRole('link')).toHaveCount(0); // folded
  await contents.getByText('Contents').click();
  await contents.getByRole('link', { name: 'Albums' }).click();
  await expect(page).toHaveURL(/#\/guide\/albums$/);
  await expect(page.getByRole('heading', { level: 2, name: 'Albums' })).toBeInViewport();
  await expect(contents.getByRole('link')).toHaveCount(0); // folded again

  // At the end of a section, back to the contents at the top, unfolded.
  await page
    .getByRole('link', { name: 'Back to contents' })
    .nth(SECTIONS.indexOf('Albums'))
    .click();
  await expect(contents.getByRole('link', { name: 'The Studio', exact: true })).toBeInViewport();

  // The wide table becomes labelled rows rather than hiding a column off the side.
  await page.goto('./#/guide/reference');
  await expect(page.locator('td', { hasText: 'How slowly the sound follows' })).toBeInViewport();
  await expectNoSidewaysScroll(page);

  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('./#/guide/prepare');
  await expectNoSidewaysScroll(page);
  expect(problems).toEqual([]);
});

test('Help leads to the guide and to its sections', async ({ page, baseURL }) => {
  const problems = watch(page, baseURL);
  await page.goto('./#/help');
  await page.getByRole('link', { name: 'Read the guide' }).click();
  await expect(page).toHaveURL(/#\/guide$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Synesthesia: a guide' })).toBeVisible();

  await page.goBack();
  await page.getByRole('link', { name: 'The Studio', exact: true }).click();
  await expect(page).toHaveURL(/#\/guide\/studio$/);
  await expect(page.getByRole('heading', { level: 2, name: 'The Studio' })).toBeInViewport();
  expect(problems).toEqual([]);
});
