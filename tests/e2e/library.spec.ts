import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type FileChooser, type Page } from '@playwright/test';

// The Library screen, driven like a person would: file pickers, menus, dialogs.

const FIXTURE_PATH = resolve(import.meta.dirname, '../fixtures/sample.sig.json');
const FIXTURE = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as {
  id: string;
  name: string;
  contentHash: string;
};
const EMPTY_TEXT = 'Bring in a clip to make your first signature.';

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

async function importFiles(page: Page, files: Parameters<FileChooser['setFiles']>[0]) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import file' }).click();
  await (await chooser).setFiles(files);
}

async function openMenu(page: Page, name: string) {
  await page.getByRole('button', { name: `More actions for ${name}`, exact: true }).click();
  await expect(
    page.getByRole('menu', { name: `More actions for ${name}`, exact: true }),
  ).toBeVisible();
}

/** A composition file that uses the sample signature. */
function compositionFile(name: string) {
  const now = '2026-09-28T12:00:00.000Z';
  const composition = {
    format: 'sp-composition',
    version: 1,
    id: 'e2e-composition-1',
    name,
    createdAt: now,
    updatedAt: now,
    signature: { id: FIXTURE.id, contentHash: FIXTURE.contentHash, name: FIXTURE.name },
    seed: 123456,
    timeline: {
      speed: 1,
      loops: 1,
      loopMode: 'loop',
      tailSec: 3,
      smoothing: 0.2,
      signatureStrength: 1,
    },
    linked: true,
    visual: { materialId: 'water', materialVersion: 1, properties: { viscosity: 0.5 } },
    sound: { materialId: 'water', materialVersion: 1, properties: { brightness: 0.5 } },
    mute: { visual: false, sound: false },
    chance: null,
    render: { width: 1920, height: 1080, fps: 30 },
    status: 'kept',
    notes: 'From the end-to-end test.',
  };
  return {
    name: 'blink.spcomp.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(composition)),
  };
}

test('import, rename, duplicate, export and delete a signature', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Library', level: 1 })).toBeVisible();
  await expect(page.getByText(EMPTY_TEXT)).toBeVisible();
  await expect(page.getByRole('button', { name: 'New from clip' })).toBeVisible();

  await importFiles(page, FIXTURE_PATH);
  await expect(page.getByText('Added the signature “Sample wink”.')).toBeVisible();
  await expect(page.getByText(EMPTY_TEXT)).toBeHidden();

  const signatures = page.getByRole('list', { name: 'Signatures' });
  const card = signatures.getByRole('listitem').filter({ hasText: 'Sample wink' });
  await expect(card).toHaveCount(1);
  await expect(card.locator('img')).toHaveAttribute('src', /^data:image\/png;base64,/);
  await expect(card).toContainText('2.2 seconds of movement');
  await expect(card).toContainText('Changed today at');

  // Rename inline; Esc first to check that it keeps the old name.
  await openMenu(page, 'Sample wink');
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  let field = page.getByRole('textbox', { name: 'New name for Sample wink' });
  await expect(field).toBeFocused();
  await field.fill('Something else');
  await field.press('Escape');
  await expect(signatures.getByRole('heading', { name: 'Sample wink', exact: true })).toBeVisible();

  await openMenu(page, 'Sample wink');
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  field = page.getByRole('textbox', { name: 'New name for Sample wink' });
  await field.fill('Left eye');
  await field.press('Enter');
  await expect(signatures.getByRole('heading', { name: 'Left eye', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Left eye', exact: true })).toBeFocused();

  // Duplicate.
  await openMenu(page, 'Left eye');
  await page.getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect(signatures.getByRole('listitem')).toHaveCount(2);
  await expect(
    signatures.getByRole('heading', { name: 'Left eye copy', exact: true }),
  ).toBeVisible();

  // Export downloads the signature file, with the new name and the same movement.
  const downloadPromise = page.waitForEvent('download');
  await openMenu(page, 'Left eye');
  await page.getByRole('menuitem', { name: 'Export file' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('Left-eye.sig.json');
  const exported = JSON.parse(readFileSync(await download.path(), 'utf8')) as typeof FIXTURE;
  expect(exported.name).toBe('Left eye');
  expect(exported.contentHash).toBe(FIXTURE.contentHash);

  // Delete asks first; Cancel keeps it.
  await openMenu(page, 'Left eye copy');
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  let dialog = page.getByRole('dialog', { name: 'Delete “Left eye copy”?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(signatures.getByRole('listitem')).toHaveCount(2);

  for (const name of ['Left eye copy', 'Left eye']) {
    await openMenu(page, name);
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    dialog = page.getByRole('dialog', { name: `Delete “${name}”?` });
    await expect(dialog).toContainText('This removes the signature from this browser.');
    await dialog.getByRole('button', { name: 'Delete' }).click();
    await expect(dialog).toBeHidden();
  }
  await expect(page.getByText(EMPTY_TEXT)).toBeVisible();
  expect(errors).toEqual([]);
});

test('compositions, missing signatures, back up and restore', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./');
  await expect(page.getByText(EMPTY_TEXT)).toBeVisible();

  // Import a signature and a composition that uses it, together.
  const signatureFile = {
    name: 'sample.sig.json',
    mimeType: 'application/json',
    buffer: readFileSync(FIXTURE_PATH),
  };
  await importFiles(page, [signatureFile, compositionFile('Blink study')]);
  await expect(page.getByText('Added 1 signature and 1 composition.')).toBeVisible();
  const compositions = page.getByRole('list', { name: 'Compositions' });
  const comp = compositions.getByRole('listitem').filter({ hasText: 'Blink study' });
  await expect(comp).toContainText('From “Sample wink” · kept');
  await expect(comp.locator('img')).toHaveCount(0); // no still yet: a quiet placeholder
  await expect(comp.locator('svg[viewBox="0 0 240 135"]')).toHaveCount(1);

  // Deleting the signature says how many compositions use it; they stay, waiting.
  await openMenu(page, 'Sample wink');
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete “Sample wink”?' });
  await expect(dialog).toContainText('1 composition uses this signature.');
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(comp).toContainText('Needs its signature, “Sample wink”.');

  // Importing it again lets the composition play.
  await importFiles(page, FIXTURE_PATH);
  await expect(
    page.getByText(
      'Added the signature “Sample wink”. 1 composition that was waiting can play again.',
    ),
  ).toBeVisible();
  await expect(comp).not.toContainText('Needs its signature');

  // Back up everything, delete the composition, then restore it from the backup.
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Back up everything' }).click();
  const backup = await downloadPromise;
  expect(backup.suggestedFilename()).toMatch(
    /^synesthesia-backup-\d{4}-\d{2}-\d{2}\.spbackup\.zip$/,
  );
  await expect(page.getByText(/^Backup saved as/)).toBeVisible();
  const backupPath = await backup.path();

  await openMenu(page, 'Blink study');
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page
    .getByRole('dialog', { name: 'Delete “Blink study”?' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(page.getByText('No compositions yet.', { exact: false })).toBeVisible();

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Restore from backup' }).click();
  await (
    await chooser
  ).setFiles({
    name: backup.suggestedFilename(),
    mimeType: 'application/zip',
    buffer: readFileSync(backupPath),
  });
  const restore = page.getByRole('dialog', { name: 'Restore from backup?' });
  await expect(restore).toContainText('Nothing else is removed.');
  await restore.getByRole('button', { name: 'Restore' }).click();
  await expect(
    page.getByText('Backup restored: 1 signature replaced; 1 composition added.'),
  ).toBeVisible();
  await expect(comp).toBeVisible();
  expect(errors).toEqual([]);
});

test('a file that is not a signature or composition is refused plainly', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByText(EMPTY_TEXT)).toBeVisible();
  await importFiles(page, {
    name: 'notes.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"hello": "world"}'),
  });
  await expect(
    page.getByText(
      "“notes.json” wasn't imported. This file isn't a Synesthesia signature or composition.",
    ),
  ).toBeVisible();
  await expect(page.getByText(EMPTY_TEXT)).toBeVisible();
});
