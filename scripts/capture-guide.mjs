/**
 * Capture the screenshots used in docs/USER_GUIDE.md.
 *
 *   npm run dev                         # in another terminal
 *   node scripts/capture-guide.mjs      # or: node scripts/capture-guide.mjs http://localhost:5173/
 *
 * Uses a fresh browser profile (empty library), the fixture clips in tests/fixtures/ and the
 * bundled sample wink. Writes PNGs to docs/images/guide/.
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.argv[2] ?? 'http://localhost:5173/';
const out = join(root, 'docs', 'images', 'guide');
const fixtures = join(root, 'tests', 'fixtures');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const shot = async (name, options = {}) => {
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(out, `${name}.png`), ...options });
  console.log('captured', name);
};
const go = async (hash) => {
  await page.goto(new URL(hash, base).href);
  await page.waitForTimeout(400);
};
/** Wait until the transport reads between `from` and `to` seconds, then pause. */
const pauseBetween = async (from, to) => {
  const time = page.getByText(/^\d+:\d\d\.\d \/ \d+:\d\d\.\d$/).first();
  for (let i = 0; i < 400; i++) {
    const text = (await time.textContent()) ?? '';
    const [m = '0', s = '0'] = text.split('/')[0].trim().split(':');
    const t = Number(m) * 60 + Number(s);
    if (t >= from && t <= to) break;
    await page.waitForTimeout(25);
  }
  const pause = page.getByRole('button', { name: 'Pause' }).first();
  if (await pause.isVisible()) await pause.click();
};

// First run: introduction and dedication (forced; they stay out of automated browsers).
await go('?introduction=1#/');
await page.getByRole('dialog', { name: 'Welcome' }).waitFor();
await shot('introduction');
await page.getByRole('button', { name: 'Skip' }).click();
await go('?dedication=1#/');
await page.getByTestId('dedication').waitFor();
await shot('dedication');
await page.mouse.click(10, 10);
await page.waitForTimeout(900);

// Library, empty.
await go('#/');
await page.getByRole('heading', { name: 'Library' }).waitFor();
await shot('library-empty');

// Prepare: a clip, a focus box, extraction, the bare wake.
await go('#/prepare');
const chooser = page.waitForEvent('filechooser');
await page
  .getByRole('button', { name: /^Choose (a|another) clip…$/ })
  .first()
  .click();
await (await chooser).setFiles(join(fixtures, 'ring-expand-inside.mp4'));
await page.getByRole('button', { name: 'Extract signature' }).waitFor();
await page.waitForTimeout(800);
await shot('prepare-clip');
const frame = await page.getByTestId('clip-frame').boundingBox();
if (frame) {
  const at = (x, y) => [frame.x + x * frame.width, frame.y + y * frame.height];
  const [x0, y0] = at(0.22, 0.12);
  const [x1, y1] = at(0.78, 0.88);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 });
  await page.mouse.move(x1, y1, { steps: 4 });
  await page.mouse.up();
  await shot('prepare-focus');
}
await page.getByRole('button', { name: 'Extract signature' }).click();
await page.getByRole('progressbar', { name: 'Extracting the signature' }).waitFor();
await shot('prepare-extracting');
await page.getByRole('heading', { name: 'Signature', exact: true }).waitFor({ timeout: 120_000 });
await pauseBetween(1.1, 1.5);
await shot('prepare-signature');
await page.getByRole('textbox', { name: 'Name' }).fill('Expanding ring');
await page.getByRole('button', { name: 'Save', exact: true }).click();
await page.waitForTimeout(800);

// Library with the sample wink imported too.
await go('#/');
const importer = page.waitForEvent('filechooser');
await page.getByRole('button', { name: 'Import file' }).click();
await (await importer).setFiles(join(fixtures, 'sample.sig.json'));
await page.getByText('Sample wink').first().waitFor();
await page.waitForTimeout(600);
await shot('library');

// The sample's signature screen.
const sampleId = '5a3c1e2f-8b7d-4c6a-9e0f-1d2b3c4a5e6f';
await go(`#/signature/${sampleId}`);
await pauseBetween(0.8, 1.0);
await shot('signature');

// Studio.
await go(`#/studio/new/${sampleId}`);
await page.getByRole('button', { name: 'Render MP4' }).waitFor({ timeout: 60_000 });
await page
  .getByText('Getting to know this computer…')
  .waitFor({ state: 'hidden', timeout: 30_000 })
  .catch(() => {});
await page.getByRole('button', { name: 'Play' }).click();
await page.waitForTimeout(1500);
await page.getByRole('button', { name: 'Pause' }).click();
await shot('studio');
await page.getByRole('button', { name: /^Visual\s*Water/ }).click();
await page.waitForTimeout(300);
await shot('studio-materials');
await page.keyboard.press('Escape');
await page.getByRole('button', { name: 'Draw by chance' }).click();
await page.waitForTimeout(400);
await shot('studio-chance');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await page.getByRole('button', { name: 'Render MP4' }).click();
await page.getByRole('dialog', { name: 'Render MP4' }).waitFor();
await shot('render');
await page.keyboard.press('Escape');
await page.getByRole('button', { name: 'Save', exact: true }).click();
await page.waitForTimeout(1200);

// Album.
await go(`#/album/new/${sampleId}`);
await page.getByRole('button', { name: 'Generate album' }).waitFor();
await shot('album-new', { fullPage: true });
await page.getByRole('spinbutton', { name: 'Tracks' }).fill('9');
await page.getByRole('button', { name: 'Generate album' }).click();
await page.getByRole('button', { name: 'Batch render' }).waitFor({ timeout: 30_000 });
await page.waitForTimeout(800);
await shot('album');
await page.getByRole('button', { name: 'Batch render' }).click();
await page.waitForTimeout(500);
await shot('album-batch');

// Library with everything, Settings, Help, Diagnostics.
await go('#/');
await page.waitForTimeout(800);
await shot('library-full', { fullPage: true });
await go('#/settings');
await page.getByRole('heading', { name: 'Settings' }).waitFor();
await shot('settings');
await go('#/help');
await shot('help');
await go('#/diagnostics');
await page.waitForTimeout(4000);
await shot('diagnostics');

await browser.close();
