import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';

// Phones and tablets (docs/DECISIONS.md, 2026-09-29 "Phones and tablets"): every screen fits
// from 320 px wide without scrolling sideways, its main controls are on screen, the
// Studio's wake keeps a usable size, the header's Menu works, and a finger drags sliders
// and the scrub bar without moving the page. Each size runs as a touch phone or tablet
// (isMobile, hasTouch), so the 44 px touch targets are in play.

const FIXTURES = resolve(import.meta.dirname, '../fixtures');
const FIXTURE_PATH = join(FIXTURES, 'sample.sig.json');
const FIXTURE = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as { id: string; name: string };

const SIZES = [
  { width: 320, height: 640 },
  { width: 375, height: 812 },
  { width: 812, height: 375 },
  { width: 768, height: 1024 },
];

/** At this width and narrower the header's links fold into the Menu (MainNav.tsx). */
const COMPACT_NAV_MAX = 720;
const NAV_ITEMS = ['Library', 'Guide', 'Help', 'Settings', 'Diagnostics'];

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
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

function viewport(page: Page): { width: number; height: number } {
  const size = page.viewportSize();
  if (!size) throw new Error('no viewport');
  return size;
}

/** The page never scrolls sideways. */
async function expectFits(page: Page): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, 'page width').toBeLessThanOrEqual(clientWidth);
}

async function boxOf(
  target: Locator,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await target.boundingBox();
  if (!box) throw new Error(`no box for ${target.toString()}`);
  return box;
}

/** Visible, and within the screen from left to right (it may be further down the page). */
async function expectInside(page: Page, target: Locator): Promise<void> {
  await expect(target).toBeVisible();
  const box = await boxOf(target);
  const { width } = viewport(page);
  expect(box.x, `${target.toString()} left edge`).toBeGreaterThanOrEqual(-0.5);
  expect(box.x + box.width, `${target.toString()} right edge`).toBeLessThanOrEqual(width + 0.5);
}

/** Within the screen on every side (dialogs, menus, popovers). */
async function expectOnScreen(page: Page, target: Locator): Promise<void> {
  await expect(target).toBeVisible();
  const box = await boxOf(target);
  const { width, height } = viewport(page);
  expect(box.x, `${target.toString()} left`).toBeGreaterThanOrEqual(-0.5);
  expect(box.y, `${target.toString()} top`).toBeGreaterThanOrEqual(-0.5);
  expect(box.x + box.width, `${target.toString()} right`).toBeLessThanOrEqual(width + 0.5);
  expect(box.y + box.height, `${target.toString()} bottom`).toBeLessThanOrEqual(height + 0.5);
}

/** No two of these overlap. */
async function expectApart(targets: Locator[]): Promise<void> {
  const boxes = await Promise.all(targets.map(boxOf));
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      expect(
        overlapX > 0.5 && overlapY > 0.5,
        `${targets[i].toString()} overlaps ${targets[j].toString()}`,
      ).toBe(false);
    }
  }
}

async function scrollY(page: Page): Promise<number> {
  return page.evaluate(() => window.scrollY);
}

/**
 * Wait for a swipe's momentum to die away: a tap during a fling only stops it (the browser
 * sends no click), as on a real phone.
 */
async function settle(page: Page): Promise<void> {
  for (let i = 0; i < 40; i++) {
    const before = await scrollY(page);
    await page.waitForTimeout(250);
    if ((await scrollY(page)) === before) return;
  }
  throw new Error('the page kept scrolling');
}

for (const size of SIZES) {
  test.describe(`${size.width}×${size.height}`, () => {
    test.use({ viewport: size, isMobile: true, hasTouch: true });
    const portrait = size.height > size.width;

    test('the empty library: how it works, and the sample wink', async ({ page }) => {
      const errors = watchErrors(page);
      await page.goto('./');
      const strip = page.getByRole('region', { name: 'How it works' });
      await expect(strip).toBeVisible();
      await expectFits(page);
      for (const name of ['New from clip', 'Try the sample wink', 'Hide how it works']) {
        await expectInside(page, strip.getByRole('button', { name }));
      }
      await expectInside(page, strip.getByRole('link', { name: /^Guide: / }));
      await strip.getByRole('button', { name: 'Try the sample wink' }).tap();
      await expectInside(
        page,
        strip.getByRole('button', { name: `Start a composition from ${FIXTURE.name}` }),
      );
      await expectFits(page);
      expect(errors).toEqual([]);
    });

    test('the library, the header and the plain pages', async ({ page }) => {
      const errors = watchErrors(page);
      await importSignature(page);
      await expectFits(page);
      await expectInside(page, page.getByRole('link', { name: 'Synesthesia' }));
      for (const name of ['New from clip', 'Import file', 'Back up everything']) {
        await expectInside(page, page.getByRole('button', { name }));
      }
      await expectInside(page, page.getByRole('button', { name: 'Restore from backup' }));
      await expectInside(
        page,
        page.getByRole('button', { name: `More actions for ${FIXTURE.name}` }),
      );
      // The steps and the signature's ways forward.
      await expectInside(page, page.getByRole('region', { name: 'How it works' }));
      await expectInside(page, page.getByRole('link', { name: 'Guide: The Library' }));
      const signatures = page.getByRole('list', { name: 'Signatures' });
      for (const name of [
        `Start a composition from ${FIXTURE.name}`,
        `New album from ${FIXTURE.name}`,
        `Open ${FIXTURE.name}`,
      ]) {
        await expectInside(page, signatures.getByRole('button', { name, exact: true }));
      }

      const nav = page.getByRole('navigation', { name: 'Main' });
      const menu = nav.getByRole('button', { name: 'Menu' });
      const links = nav.getByRole('link');
      if (size.width <= COMPACT_NAV_MAX) {
        // The links fold into the Menu, which opens a list of all of them.
        await expectInside(page, menu);
        await expect(menu).toHaveAttribute('aria-expanded', 'false');
        await expect(links.first()).toBeHidden();
        await menu.tap();
        await expect(menu).toHaveAttribute('aria-expanded', 'true');
        const count = await links.count();
        expect(count).toBeGreaterThanOrEqual(NAV_ITEMS.length);
        for (let i = 0; i < count; i++) await expectOnScreen(page, links.nth(i));
        for (const name of NAV_ITEMS) await expect(nav.getByRole('link', { name })).toBeVisible();
        await expect(nav.getByRole('link', { name: 'Library' })).toHaveAttribute(
          'aria-current',
          'page',
        );
        await expectApart([page.getByRole('link', { name: 'Synesthesia' }), menu]);

        // Esc closes it and puts focus back on the button.
        await page.keyboard.press('Tab');
        await expect(nav.getByRole('link', { name: 'Library' })).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(menu).toHaveAttribute('aria-expanded', 'false');
        await expect(menu).toBeFocused();
        await expect(links.first()).toBeHidden();

        // A tap elsewhere (below the open list) closes it.
        await menu.tap();
        await expect(menu).toHaveAttribute('aria-expanded', 'true');
        await page.getByRole('heading', { name: 'Signatures', level: 2 }).tap();
        await expect(menu).toHaveAttribute('aria-expanded', 'false');

        // Choosing a screen goes there and closes it.
        await menu.tap();
        await nav.getByRole('link', { name: 'Settings' }).tap();
        await expect(page).toHaveURL(/#\/settings$/);
        await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
        await expect(menu).toHaveAttribute('aria-expanded', 'false');
        await expect(nav.getByRole('link', { name: 'Settings' })).toBeHidden();
      } else {
        await expect(menu).toBeHidden();
        for (const name of NAV_ITEMS) await expectInside(page, nav.getByRole('link', { name }));
        await nav.getByRole('link', { name: 'Settings' }).tap();
        await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
      }
      await expectFits(page);

      await page.goto('./#/help');
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await expectFits(page);

      await page.goto('./#/diagnostics');
      await expect(page.getByRole('heading', { name: 'Diagnostics', level: 1 })).toBeVisible();
      await expect(page.locator('[data-check-id][data-status="pending"]')).toHaveCount(0, {
        timeout: 90_000,
      });
      await expectFits(page);
      await expectInside(page, page.getByRole('button', { name: /^Copy report/ }));
      expect(errors).toEqual([]);
    });

    test('prepare: a clip, then its signature', async ({ page }) => {
      test.setTimeout(180_000);
      const errors = watchErrors(page);
      await page.goto('./#/prepare');
      await expect(page.getByRole('heading', { name: 'Prepare', level: 1 })).toBeVisible();
      await expectFits(page);
      const choose = page.getByRole('button', { name: 'Choose a clip…' });
      await expectInside(page, choose.first());

      const chooser = page.waitForEvent('filechooser');
      await choose.first().click();
      await (await chooser).setFiles(join(FIXTURES, 'dot-right.mp4'));
      const extract = page.getByRole('button', { name: 'Extract signature' });
      await expect(extract).toBeEnabled();
      await expectFits(page);
      const frame = await boxOf(page.getByTestId('clip-frame'));
      if (portrait) expect(frame.width).toBeGreaterThanOrEqual(0.9 * size.width);
      expect(frame.height).toBeGreaterThanOrEqual(120);
      for (const name of ['Play the clip', 'Back one frame', 'Forward one frame', 'Draw a box']) {
        await expectInside(page, page.getByRole('button', { name }));
      }
      for (const name of ['Trim start', 'Trim end', 'Speed']) {
        await expectInside(page, page.getByRole('slider', { name }));
      }
      await expectInside(page, extract);
      // Extract stays in reach at the bottom of the screen while the settings scroll.
      await page.getByRole('button', { name: 'Draw a box' }).tap();
      await expectOnScreen(page, extract);

      await extract.tap();
      await expect(page.getByRole('heading', { name: 'Signature', exact: true })).toBeVisible({
        timeout: 90_000,
      });
      await expect(page.getByRole('progressbar')).toHaveCount(0);
      await expectFits(page);
      await expectInside(page, page.getByRole('button', { name: 'Save', exact: true }));
      await expectInside(page, page.getByRole('button', { name: 'Save and open in Studio' }));
      await expectInside(page, page.getByRole('switch', { name: 'Hide source' }));
      await expectInside(page, page.getByRole('button', { name: 'Extract again' }));
      await expectInside(page, page.getByRole('slider', { name: 'Playhead' }));
      // Both the clip and the wake, one above the other upright.
      await page.getByRole('switch', { name: 'Hide source' }).click();
      await expect(page.getByTestId('clip-pane')).toBeVisible();
      await expectFits(page);
      const clip = await boxOf(page.getByTestId('clip-pane'));
      const wake = await boxOf(page.getByTestId('wake-pane'));
      if (portrait) expect(wake.y).toBeGreaterThanOrEqual(clip.y + clip.height - 1);
      expect(errors).toEqual([]);
    });

    test('a signature', async ({ page }) => {
      const errors = watchErrors(page);
      await importSignature(page);
      await page.goto(`./#/signature/${FIXTURE.id}`);
      await expect(page.getByRole('heading', { name: FIXTURE.name, level: 1 })).toBeVisible();
      await expectFits(page);
      const wake = await boxOf(page.getByRole('img', { name: /^The wake of/ }));
      if (portrait) expect(wake.width).toBeGreaterThanOrEqual(0.9 * size.width);
      expect(wake.height).toBeGreaterThanOrEqual(150);
      for (const name of [
        'Export file',
        'Start a composition',
        'New album',
        `Rename ${FIXTURE.name}`,
      ]) {
        await expectInside(page, page.getByRole('button', { name }));
      }
      await expectInside(
        page,
        page.getByRole('link', { name: 'Guide: Making a signature (Prepare)' }),
      );
      await expectInside(page, page.getByRole('button', { name: /^(Play|Pause)$/ }));
      await expectInside(page, page.getByRole('slider', { name: 'Playhead' }));
      await expectInside(page, page.getByTestId('sparklines'));
      expect(errors).toEqual([]);
    });

    test('the studio', async ({ page }) => {
      test.setTimeout(180_000);
      const errors = watchErrors(page);
      await importSignature(page);
      // The first visit measures this computer first.
      await page.goto(`./#/studio/new/${FIXTURE.id}`);
      const wake = page.getByRole('img', { name: 'The wake' });
      await expect(wake).toBeVisible({ timeout: 60_000 });
      await expect(page.getByText('Getting to know this computer…')).toBeHidden({
        timeout: 60_000,
      });
      await expectFits(page);

      // The wake keeps a usable size.
      const stage = await boxOf(wake);
      if (portrait) {
        expect(stage.width).toBeGreaterThanOrEqual(0.9 * size.width);
      } else {
        expect(stage.width).toBeGreaterThanOrEqual(0.5 * size.width);
      }
      expect(stage.height).toBeGreaterThanOrEqual(180);

      // Everything is on screen from left to right.
      const play = page.getByRole('button', { name: 'Play' });
      const save = page.getByRole('button', { name: 'Save', exact: true });
      const more = page.getByRole('button', { name: 'More actions' });
      for (const target of [
        play,
        page.getByRole('button', { name: 'Loop' }),
        page.getByRole('slider', { name: 'Playhead' }),
        save,
        more,
        page.getByRole('button', { name: 'Draw by chance' }),
        page.getByRole('button', { name: 'Visual Water' }),
        page.getByRole('button', { name: 'Sound Water' }),
        page.getByRole('button', { name: 'Mute visual' }),
        page.getByRole('slider', { name: 'Viscosity' }),
        page.getByRole('textbox', { name: 'Notes' }),
      ]) {
        await expectInside(page, target);
      }
      for (const slot of ['A', 'B', 'C', 'D']) {
        await expectInside(page, page.getByRole('button', { name: `Store snapshot ${slot}` }));
      }

      // The header's texts and buttons don't overlap.
      const crumbs = page.getByRole('navigation', { name: 'Where you are' });
      const guide = page.getByRole('link', { name: 'Guide: The Studio' });
      await expectInside(page, guide);
      await expectApart([
        crumbs.getByRole('link', { name: 'Library' }),
        crumbs.getByRole('link', { name: FIXTURE.name }),
        page.getByRole('button', { name: /\. Rename$/ }),
        page.getByTestId('save-state'),
        save,
        more,
        guide,
      ]);

      // The transport stays in reach while the controls scroll; a phone on its side keeps
      // everything in the window.
      if (portrait) {
        await page.evaluate(() => window.scrollTo(0, 600));
        await expectOnScreen(page, play);
        await expectOnScreen(page, page.getByRole('slider', { name: 'Playhead' }));
        await page.evaluate(() => window.scrollTo(0, 0));
      } else {
        const { scrollHeight, clientHeight } = await page.evaluate(() => ({
          scrollHeight: document.documentElement.scrollHeight,
          clientHeight: document.documentElement.clientHeight,
        }));
        expect(scrollHeight).toBeLessThanOrEqual(clientHeight);
        await expectOnScreen(page, play);
      }

      // Save as new, Render MP4 and Present are in the More menu.
      await more.tap();
      const renderItem = page.getByRole('menuitem', { name: 'Render MP4' });
      await expectOnScreen(page, page.getByRole('menu', { name: 'More actions' }));
      await expect(page.getByRole('menuitem', { name: 'Save as new' })).toBeDisabled();
      await renderItem.tap();
      const render = page.getByRole('dialog', { name: 'Render MP4' });
      await expectOnScreen(page, render);
      await expect(render.getByRole('heading', { name: 'Render MP4' })).toBeInViewport();
      await page.keyboard.press('Escape');
      await expect(render).toBeHidden();

      // Draw by chance and the material list fit too.
      await page.getByRole('button', { name: 'Draw by chance' }).tap();
      const chance = page.getByRole('dialog', { name: 'Draw by chance' });
      await expectOnScreen(page, chance);
      await page.keyboard.press('Escape');
      await expect(chance).toBeHidden();
      await page.getByRole('button', { name: 'Visual Water' }).tap();
      await expectInside(page, page.getByRole('listbox', { name: 'Visual material' }));
      await page.keyboard.press('Escape');
      await expectFits(page);

      // Presentation: the wake alone; on a touch screen a Close button comes back.
      await more.tap();
      await page.getByRole('menuitem', { name: 'Present' }).tap();
      await expect(save).toBeHidden();
      await expect(wake).toBeVisible();
      const close = page.getByRole('button', { name: 'Close' });
      await expectOnScreen(page, close);
      await close.tap();
      await expect(save).toBeVisible();
      await expectFits(page);
      expect(errors).toEqual([]);
    });

    test('a new album and the album', async ({ page }) => {
      const errors = watchErrors(page);
      await importSignature(page);
      await page.goto(`./#/album/new/${FIXTURE.id}`);
      await expect(page.getByRole('heading', { name: 'New album', level: 1 })).toBeVisible();
      await page.getByRole('textbox', { name: 'Master seed' }).fill('314159');
      await expectFits(page);
      await expectInside(page, page.getByRole('textbox', { name: 'Title' }));
      await expectInside(page, page.getByRole('spinbutton', { name: 'Tracks' }));
      await expectInside(page, page.getByRole('button', { name: 'New seed' }));
      const generate = page.getByRole('button', { name: 'Generate album' });
      await expectInside(page, generate);

      await generate.tap();
      await expect(
        page.getByRole('heading', { name: 'Sample wink album', level: 1 }),
      ).toBeVisible();
      await expectFits(page);
      await expectInside(page, page.getByRole('radiogroup', { name: 'Status of track 01' }));
      await expectInside(page, page.getByRole('button', { name: 'Notes for track 01' }));
      await expectInside(page, page.getByRole('button', { name: 'Open in Studio: track 01' }));
      const actions = page.getByRole('button', { name: 'More actions for Sample wink album' });
      await expectInside(page, actions);
      await actions.tap();
      await expectOnScreen(
        page,
        page.getByRole('menu', { name: 'More actions for Sample wink album' }),
      );
      await page.getByRole('menuitem', { name: 'Delete album' }).tap();
      await expectOnScreen(page, page.getByRole('dialog'));
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeHidden();
      expect(errors).toEqual([]);
    });
  });
}

// A finger on a phone ---------------------------------------------------------------------

interface Point {
  x: number;
  y: number;
}

/** Real touch input through the browser (touch events, gestures and scrolling included). */
async function touch(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: Point[]) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  return {
    /** A drag that comes to rest before the finger lifts (so it doesn't fling the page). */
    async drag(from: Point, to: Point, steps = 12): Promise<void> {
      await send('touchStart', [from]);
      for (let i = 1; i <= steps; i++) {
        await send('touchMove', [
          { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps },
        ]);
      }
      for (let i = 0; i < 3; i++) {
        await page.waitForTimeout(40);
        await send('touchMove', [to]);
      }
      await send('touchEnd', []);
    },
    async tap(at: Point): Promise<void> {
      await send('touchStart', [at]);
      await send('touchEnd', []);
    },
    async hold(at: Point, ms: number): Promise<void> {
      await send('touchStart', [at]);
      await page.waitForTimeout(ms);
      await send('touchEnd', []);
    },
    detach: () => cdp.detach(),
  };
}

/** A point on a control: `fx` of the way across, in the middle top to bottom. */
async function pointOn(target: Locator, fx: number): Promise<Point> {
  const box = await boxOf(target);
  return { x: box.x + box.width * fx, y: box.y + box.height / 2 };
}

async function valueOf(target: Locator): Promise<number> {
  return Number(await target.getAttribute('aria-valuenow'));
}

test.describe('a finger on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

  test('drags a slider without moving the page, scrolls past it, double-taps it back, and replaces a snapshot', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const errors = watchErrors(page);
    await importSignature(page);
    await page.goto(`./#/studio/new/${FIXTURE.id}`);
    await expect(page.getByRole('img', { name: 'The wake' })).toBeVisible({ timeout: 60_000 });
    const viscosity = page.getByRole('slider', { name: 'Viscosity', exact: true });
    await viscosity.scrollIntoViewIfNeeded();
    await expect(viscosity).toHaveAttribute('aria-valuenow', '0.5');
    const finger = await touch(page);

    // Sideways: the slider follows and the page stays put.
    const before = await scrollY(page);
    await finger.drag(await pointOn(viscosity, 0.5), await pointOn(viscosity, 0.8));
    await expect.poll(() => valueOf(viscosity)).toBeCloseTo(0.8, 1);
    expect(await scrollY(page)).toBe(before);
    // Snapshot A keeps this.
    await finger.tap(await pointOn(page.getByRole('button', { name: 'Store snapshot A' }), 0.5));
    const snapshotA = page.getByRole('button', { name: /^Snapshot A: recall/ });
    await expect(snapshotA).toBeVisible();

    // Up the screen from the slider: the page scrolls and the slider keeps its value.
    const start = await pointOn(viscosity, 0.3);
    await finger.drag(start, { x: start.x, y: start.y - 240 }, 16);
    await expect.poll(() => scrollY(page)).toBeGreaterThan(before + 50);
    expect(await valueOf(viscosity)).toBeCloseTo(0.8, 1);
    await settle(page);

    // A double-tap returns it to its baseline.
    const at = await pointOn(viscosity, 0.2);
    await finger.tap(at);
    await finger.tap(at);
    await expect(viscosity).toHaveAttribute('aria-valuenow', '0.5');
    // A single tap jumps there, like a click.
    await page.waitForTimeout(600);
    await finger.tap(await pointOn(viscosity, 0.25));
    await expect.poll(() => valueOf(viscosity)).toBeCloseTo(0.25, 1);

    // Press and hold snapshot A to replace it (Shift-click with a mouse): no recall.
    await finger.hold(await pointOn(snapshotA, 0.5), 900);
    await expect.poll(() => valueOf(viscosity)).toBeCloseTo(0.25, 1);
    await page.waitForTimeout(600);
    await finger.tap(await pointOn(viscosity, 0.6));
    await expect.poll(() => valueOf(viscosity)).toBeCloseTo(0.6, 1);
    // A tap recalls it: the replaced state, not the first one.
    await finger.tap(await pointOn(snapshotA, 0.5));
    await expect.poll(() => valueOf(viscosity)).toBeCloseTo(0.25, 1);
    await finger.detach();
    expect(errors).toEqual([]);
  });

  test('scrubs the playhead, trims a clip and draws a focus box without moving the page', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const errors = watchErrors(page);
    await importSignature(page);
    await page.goto(`./#/studio/new/${FIXTURE.id}`);
    await expect(page.getByRole('img', { name: 'The wake' })).toBeVisible({ timeout: 60_000 });
    const playhead = page.getByRole('slider', { name: 'Playhead' });
    const duration = Number(await playhead.getAttribute('aria-valuemax'));
    expect(duration).toBeGreaterThan(1);
    let finger = await touch(page);
    let before = await scrollY(page);
    await finger.drag(await pointOn(playhead, 0.05), await pointOn(playhead, 0.7));
    await expect.poll(() => valueOf(playhead)).toBeGreaterThan(duration * 0.6);
    expect(await valueOf(playhead)).toBeLessThan(duration * 0.8);
    expect(await scrollY(page)).toBe(before);
    await finger.detach();

    // The trim handles on Prepare.
    await page.goto('./#/prepare');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Choose a clip…' }).first().click();
    await (await chooser).setFiles(join(FIXTURES, 'dot-right.mp4'));
    await expect(page.getByRole('button', { name: 'Extract signature' })).toBeEnabled();
    const trimStart = page.getByRole('slider', { name: 'Trim start' });
    await expect(trimStart).toHaveAttribute('aria-valuenow', '0');
    const track = await boxOf(page.getByTestId('clip-frame'));
    const handle = await boxOf(trimStart);
    finger = await touch(page);
    before = await scrollY(page);
    const from = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
    await finger.drag(from, { x: from.x + track.width * 0.3, y: from.y });
    await expect.poll(() => valueOf(trimStart)).toBeGreaterThan(0.4);
    expect(await scrollY(page)).toBe(before);

    // A sideways drag on the picture draws a focus box, and the page stays put.
    const at = (fx: number, fy: number) => ({
      x: track.x + track.width * fx,
      y: track.y + track.height * fy,
    });
    await finger.drag(at(0.2, 0.3), at(0.7, 0.6));
    const described = page.getByText(/^Using a box \d+% wide and \d+% tall/);
    await expect(described).toBeVisible();
    const box = await described.textContent();
    expect(await scrollY(page)).toBe(before);
    // An up or down swipe on the picture around it scrolls the page instead.
    await finger.drag(at(0.9, 0.85), { x: at(0.9, 0.85).x, y: at(0.9, 0.85).y - 150 }, 12);
    await expect.poll(() => scrollY(page)).toBeGreaterThan(before + 50);
    await settle(page);
    await expect(described).toHaveText(box ?? '');
    await finger.detach();
    expect(errors).toEqual([]);
  });
});
