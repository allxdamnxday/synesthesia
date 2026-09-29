import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';

// Where to go next (docs/DECISIONS.md, 2026-09-29 "Where to go next"): the Library's How it
// works steps, signature cards and the Signature screen that lead forward, Prepare's main
// button, the Studio's notes, the guide links on every screen, and new screens starting at
// the top.

const FIXTURES = resolve(import.meta.dirname, '../fixtures');
const FIXTURE_PATH = join(FIXTURES, 'sample.sig.json');
const FIXTURE = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as { id: string; name: string };
const EMPTY_TEXT = 'Bring in a clip to make your first signature.';
const NEXT_TEXT = 'Saved in your Library.';
const TIP_TEXT = 'Press Play (or Space) to see and hear the signature move through the materials.';
/** Honey, the primary button's colour. */
const HONEY = 'rgb(217, 164, 65)';

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

function steps(page: Page): Locator {
  return page.getByRole('region', { name: 'How it works' });
}

/** Each step's state, in order: done, current or upcoming. */
async function stepStates(page: Page): Promise<string[]> {
  return steps(page)
    .getByRole('listitem')
    .evaluateAll((items) => items.map((li) => li.getAttribute('data-state') ?? ''));
}

async function importSignature(page: Page): Promise<void> {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Library', level: 1 })).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import file' }).click();
  await (await chooser).setFiles(FIXTURE_PATH);
  await expect(page.getByText(`Added the signature “${FIXTURE.name}”.`)).toBeVisible();
}

/** A new composition's Studio, ready (the first visit measures this computer first). */
async function waitForStudio(page: Page): Promise<void> {
  await expect(page.getByRole('img', { name: 'The wake' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Getting to know this computer…')).toBeHidden({ timeout: 60_000 });
}

/** The Studio's note after a first save (its notices area filtered to it). */
function nextNote(page: Page): Locator {
  return page.getByRole('status').filter({ hasText: NEXT_TEXT });
}

test('the How it works steps follow the journey, and hide and come back', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = watchErrors(page);
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Library', level: 1 })).toBeVisible();

  // Nothing yet: the steps stand in for the empty Library, the first one lit.
  const strip = steps(page);
  await expect(strip).toBeVisible();
  expect(await stepStates(page)).toEqual(['current', 'upcoming', 'upcoming']);
  await expect(strip.getByRole('heading', { level: 3 })).toHaveText([
    'Make a signature from a clip: next',
    'Start a composition',
    'Render a video or make an album',
  ]);
  await expect(page.getByText(EMPTY_TEXT)).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'New from clip' })).toHaveCount(1);
  await expect(strip.getByRole('button', { name: 'New from clip' })).toBeVisible();
  await expect(
    strip.getByRole('link', { name: 'Guide: Making a signature (Prepare)' }),
  ).toHaveAttribute('href', '#/guide/prepare');

  // Try the sample wink: it joins the signatures, and the next step takes over (and focus).
  await strip.getByRole('button', { name: 'Try the sample wink' }).click();
  await expect(
    page.getByText(`Added the signature “${FIXTURE.name}”. Start a composition from it next.`),
  ).toBeVisible();
  const card = page.getByRole('list', { name: 'Signatures' }).getByRole('listitem');
  await expect(card).toHaveCount(1);
  expect(await stepStates(page)).toEqual(['done', 'current', 'upcoming']);
  await expect(strip.getByRole('heading', { level: 3 }).first()).toHaveText(
    'Make a signature from a clip: done',
  );
  await expect(page.getByText(EMPTY_TEXT)).toHaveCount(0);
  const start = strip.getByRole('button', { name: `Start a composition from ${FIXTURE.name}` });
  await expect(start).toBeFocused();

  // Start a composition, save it.
  await start.click();
  await expect(page).toHaveURL(new RegExp(`#/studio/new/${FIXTURE.id}$`));
  await waitForStudio(page);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('save-state')).toHaveText('Saved');
  await page
    .getByRole('navigation', { name: 'Where you are' })
    .getByRole('link', { name: 'Library' })
    .click();

  // Then a video or an album: the composition to open, or a new album from its signature.
  await expect(strip.getByRole('button', { name: 'Open your composition' })).toBeVisible();
  expect(await stepStates(page)).toEqual(['done', 'done', 'current']);
  await expect(strip.getByRole('link', { name: 'Guide: Rendering a video' })).toHaveAttribute(
    'href',
    '#/guide/render',
  );
  await strip.getByRole('button', { name: `New album from ${FIXTURE.name}` }).click();
  await expect(page).toHaveURL(new RegExp(`#/album/new/${FIXTURE.id}$`));
  await page.getByRole('spinbutton', { name: 'Tracks' }).fill('2');
  await page.getByRole('button', { name: 'Generate album' }).click();
  await expect(page.getByRole('heading', { name: 'Sample wink album', level: 1 })).toBeVisible();

  // Every step done.
  await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link').click();
  await expect(strip.getByText('Every step is done.', { exact: false })).toBeVisible();
  expect(await stepStates(page)).toEqual(['done', 'done', 'done']);

  // Hide: it goes, says how to bring it back, and stays hidden after a reload.
  await strip.getByRole('button', { name: 'Hide how it works' }).click();
  await expect(strip).toHaveCount(0);
  await expect(
    page.getByText('“How it works” is hidden. You can bring it back in Settings.'),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Library', level: 1 })).toBeFocused();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Signatures', level: 2 })).toBeVisible();
  await expect(strip).toHaveCount(0);

  // Settings brings it back.
  await page.goto('./#/settings');
  const toggle = page.getByRole('switch', { name: 'Show how it works' });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await page.goto('./#/');
  await expect(strip).toBeVisible();
  expect(errors).toEqual([]);
});

test('an empty library without the steps shows its plain invitation', async ({ page }) => {
  await page.goto('./#/settings');
  await page.getByRole('switch', { name: 'Show how it works' }).uncheck();
  await page.goto('./#/');
  await expect(page.getByRole('heading', { name: 'Library', level: 1 })).toBeVisible();
  await expect(page.getByText(EMPTY_TEXT)).toBeVisible();
  await expect(page.getByRole('button', { name: 'New from clip' })).toBeVisible();
  await expect(steps(page)).toHaveCount(0);
});

test('signature cards and the Signature screen lead to the Studio and to a new album', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await importSignature(page);
  const card = page
    .getByRole('list', { name: 'Signatures' })
    .getByRole('listitem')
    .filter({ hasText: FIXTURE.name });

  // Rename, Duplicate, Export file and Delete stay in the menu; the ways forward are on the card.
  await card.getByRole('button', { name: `More actions for ${FIXTURE.name}` }).click();
  await expect(
    page.getByRole('menu', { name: `More actions for ${FIXTURE.name}` }).getByRole('menuitem'),
  ).toHaveText(['Rename', 'Duplicate', 'Export file', 'Delete']);
  await page.keyboard.press('Escape');

  await card.getByRole('button', { name: `Start a composition from ${FIXTURE.name}` }).click();
  await expect(page).toHaveURL(new RegExp(`#/studio/new/${FIXTURE.id}$`));
  await page.goBack();
  await card.getByRole('button', { name: `New album from ${FIXTURE.name}` }).click();
  await expect(page).toHaveURL(new RegExp(`#/album/new/${FIXTURE.id}$`));
  await expect(page.getByRole('heading', { name: 'New album', level: 1 })).toBeVisible();
  await page.goBack();

  // The picture opens the signature: its two ways forward, one plain line each.
  await card.getByRole('button', { name: `Open ${FIXTURE.name}`, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#/signature/${FIXTURE.id}$`));
  const ways = page.getByRole('region', { name: 'Use this signature' });
  await expect(ways).toContainText('Shape one piece by hand in the Studio.');
  await expect(ways).toContainText('Let chance draw a set of compositions from this signature.');
  await ways.getByRole('button', { name: 'New album' }).click();
  await expect(page).toHaveURL(new RegExp(`#/album/new/${FIXTURE.id}$`));
  await page.goBack();
  await ways.getByRole('button', { name: 'Start a composition' }).click();
  await expect(page).toHaveURL(new RegExp(`#/studio/new/${FIXTURE.id}$`));
  await waitForStudio(page);
  expect(errors).toEqual([]);
});

test('Prepare: Save and open in Studio is the main button, and opens the Studio', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors = watchErrors(page);
  await page.goto('./#/prepare');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose a clip…' }).first().click();
  await (await chooser).setFiles(join(FIXTURES, 'dot-right.mp4'));
  await page.getByRole('button', { name: 'Extract signature' }).click();
  await expect(page.getByRole('heading', { name: 'Signature', exact: true })).toBeVisible({
    timeout: 120_000,
  });
  const open = page.getByRole('button', { name: 'Save and open in Studio' });
  const save = page.getByRole('button', { name: 'Save', exact: true });
  await expect(open).toHaveCSS('background-color', HONEY);
  await expect(save).not.toHaveCSS('background-color', HONEY);
  await expect(
    page.getByText('Not saved yet. Next comes the Studio, where it moves through', {
      exact: false,
    }),
  ).toBeVisible();
  await open.click();
  await expect(page).toHaveURL(/#\/studio\/new\/[0-9a-f-]{36}$/);
  await waitForStudio(page);
  expect(errors).toEqual([]);
});

test('after a first save the Studio says where to go next, once', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = watchErrors(page);
  await importSignature(page);
  await page.goto(`./#/studio/new/${FIXTURE.id}`);
  await waitForStudio(page);
  // No first-visit tip in an automated browser unless asked for (?studiotip=1).
  await expect(page.getByText(TIP_TEXT)).toHaveCount(0);

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/#\/studio\/(?!new)[0-9a-f-]{36}$/);
  const note = nextNote(page);
  await expect(note).toContainText(
    `Saved in your Library. Next, make a video of it, or let chance draw an album of compositions from “${FIXTURE.name}”.`,
  );

  // Its Render MP4 opens the render dialog; the note has done its job.
  await note.getByRole('button', { name: 'Render MP4' }).click();
  const render = page.getByRole('dialog', { name: 'Render MP4' });
  await expect(render).toBeVisible();
  await expect(render.getByRole('link', { name: 'Guide: Rendering a video' })).toHaveAttribute(
    'href',
    '#/guide/render',
  );
  await page.keyboard.press('Escape');
  await expect(render).toBeHidden();
  await expect(nextNote(page)).toHaveCount(0);

  // Saving again, or coming back, doesn't bring it back.
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('save-state')).toHaveText('Saved');
  await page.reload();
  await waitForStudio(page);
  await expect(nextNote(page)).toHaveCount(0);

  // Another new composition: its note's New album goes to this signature's new album.
  await page.goto(`./#/studio/new/${FIXTURE.id}`);
  await waitForStudio(page);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(nextNote(page)).toBeVisible();
  await nextNote(page).getByRole('button', { name: 'New album' }).click();
  await expect(page).toHaveURL(new RegExp(`#/album/new/${FIXTURE.id}$`));

  // With how it works turned off, a first save says nothing more.
  await page.goto('./#/settings');
  await page.getByRole('switch', { name: 'Show how it works' }).uncheck();
  await page.goto(`./#/studio/new/${FIXTURE.id}`);
  await waitForStudio(page);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/#\/studio\/(?!new)[0-9a-f-]{36}$/);
  await expect(page.getByTestId('save-state')).toHaveText('Saved');
  await page.waitForTimeout(500);
  await expect(nextNote(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the first visit to the Studio suggests Play, until it plays, and only once', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await importSignature(page);
  await page.goto(`./?studiotip=1#/studio/new/${FIXTURE.id}`);
  await waitForStudio(page);
  const tip = page.getByText(TIP_TEXT, { exact: false });
  await expect(tip).toBeVisible();
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect(tip).toHaveCount(0);

  await page.reload();
  await waitForStudio(page);
  await page.waitForTimeout(500);
  await expect(tip).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('each screen links to its part of the guide', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await importSignature(page);
  const expectLink = async (name: string, slug: string, scope: Page | Locator = page) => {
    await expect(scope.getByRole('link', { name, exact: true })).toHaveAttribute(
      'href',
      `#/guide/${slug}`,
    );
  };

  await expectLink('Guide: The Library', 'library');
  await page.goto(`./#/signature/${FIXTURE.id}`);
  await expectLink('Guide: Making a signature (Prepare)', 'prepare');
  await page.goto('./#/prepare');
  await expectLink('Guide: Making a signature (Prepare)', 'prepare');
  await page.goto(`./#/album/new/${FIXTURE.id}`);
  await expectLink('Guide: Albums', 'albums');
  await page.getByRole('spinbutton', { name: 'Tracks' }).fill('1');
  await page.getByRole('button', { name: 'Generate album' }).click();
  await expect(page.getByRole('button', { name: 'Batch render' })).toBeVisible();
  await expectLink('Guide: Albums', 'albums');
  await page.goto('./#/settings');
  await expectLink('Guide: Settings', 'settings');
  await page.goto('./#/diagnostics');
  await expectLink('Guide: If something goes wrong', 'trouble');

  await page.goto(`./#/studio/new/${FIXTURE.id}`);
  await waitForStudio(page);
  await expectLink('Guide: The Studio', 'studio');
  await page.getByRole('button', { name: 'Draw by chance' }).click();
  const chance = page.getByRole('dialog', { name: 'Draw by chance' });
  await expectLink('Guide: Draw by chance', 'chance', chance);

  // Following one lands on its section.
  await chance.getByRole('link', { name: 'Guide: Draw by chance' }).click();
  await expect(page).toHaveURL(/#\/guide\/chance$/);
  const heading = page.getByRole('heading', { name: 'Draw by chance', level: 3 });
  await expect(heading).toBeInViewport();
  await expect(heading).toBeFocused();
  await page.goto('./#/');
  await page.getByRole('link', { name: 'Guide: The Library', exact: true }).click();
  await expect(page).toHaveURL(/#\/guide\/library$/);
  await expect(page.getByRole('heading', { name: 'The Library', level: 2 })).toBeInViewport();
  expect(errors).toEqual([]);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

  test('arriving on another screen starts at the top; the same screen keeps its place', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const errors = watchErrors(page);
    await page.goto('./#/guide');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Synesthesia: a guide' }),
    ).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
    const nav = page.getByRole('navigation', { name: 'Main' });
    await nav.getByRole('button', { name: 'Menu' }).tap();
    await nav.getByRole('link', { name: 'Help' }).tap();
    await expect(page.getByRole('heading', { name: 'The idea', level: 1 })).toBeVisible();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    // A guide section still lands on its heading.
    await page.evaluate(() => window.scrollTo(0, 400));
    await page.getByRole('link', { name: 'The Studio', exact: true }).tap();
    await expect(page.getByRole('heading', { name: 'The Studio', level: 2 })).toBeInViewport();
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

    // The Studio after a first save is the same screen at a new address: it keeps its place
    // (saved with the S key, so nothing scrolls the Save button into view first).
    await importSignature(page);
    await page.goto(`./#/studio/new/${FIXTURE.id}`);
    await waitForStudio(page);
    await page.evaluate(() => window.scrollTo(0, 500));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(400);
    await page.keyboard.press('s');
    await expect(page).toHaveURL(/#\/studio\/(?!new)[0-9a-f-]{36}$/);
    await expect(page.getByTestId('save-state')).toHaveText('Saved');
    await expect(nextNote(page)).toBeVisible();
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(400);
    // On a phone the note sits above the wake rather than over it.
    const note = await nextNote(page).boundingBox();
    const wake = await page.getByRole('img', { name: 'The wake' }).boundingBox();
    expect(note && wake && note.y + note.height <= wake.y + 1).toBe(true);
    expect(errors).toEqual([]);
  });
});
