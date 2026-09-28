import { execFileSync } from 'node:child_process';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures');

interface Probe {
  streams: Array<{ codec_type: string; codec_name: string; nb_frames?: string }>;
  format: { duration: string };
}

function ffprobe(file: string): Probe {
  const out = execFileSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'stream=codec_type,codec_name,nb_frames:format=duration',
      '-of',
      'json',
      file,
    ],
    { encoding: 'utf8' },
  );
  return JSON.parse(out) as Probe;
}

/** "0:05.2" → 5.2 */
function seconds(label: string): number {
  const [m = '0', s = '0'] = label.trim().split(':');
  return Number(m) * 60 + Number(s);
}

// SPEC 15.1: import a clip → extract → open the Studio → switch materials → save the
// composition → render an MP4 → the file exists and its duration is within one frame.
test('the whole workflow: clip to signature to composition to MP4', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // Prepare: bring in a clip and extract its signature.
  await page.goto('./#/prepare');
  const chooser = page.waitForEvent('filechooser');
  await page
    .getByRole('button', { name: /^Choose (a|another) clip…$/ })
    .first()
    .click();
  await (await chooser).setFiles(join(FIXTURES, 'dot-up.mp4'));
  await page.getByRole('button', { name: 'Extract signature' }).click();
  await expect(page.getByRole('heading', { name: 'Signature', exact: true })).toBeVisible({
    timeout: 120_000,
  });
  const name = page.getByRole('textbox', { name: 'Name' });
  await name.fill('Workflow rise');
  await page.getByRole('button', { name: 'Save and open in Studio' }).click();

  // Studio: switch both materials, then save.
  await expect(page).toHaveURL(/#\/studio\/new\//, { timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Render MP4' })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: /^Visual\s*Water/ }).click();
  await page.getByRole('option', { name: /^Honey/ }).click();
  await expect(page.getByRole('button', { name: /^Visual\s*Honey/ })).toBeVisible();
  await page.getByRole('button', { name: /^Sound\s*Water/ }).click();
  await page.getByRole('option', { name: /^Breath/ }).click();
  await expect(page.getByRole('button', { name: /^Sound\s*Breath/ })).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/#\/studio\/(?!new)/, { timeout: 30_000 });

  const timeText = await page
    .getByText(/^\d+:\d\d\.\d \/ \d+:\d\d\.\d$/)
    .first()
    .textContent();
  const timeline = seconds((timeText ?? '0:00.0 / 0:00.0').split('/')[1] ?? '0');
  expect(timeline).toBeGreaterThan(1);

  // Render: 720p30 to a download.
  await page.getByRole('button', { name: 'Render MP4' }).click();
  const dialog = page.getByRole('dialog', { name: 'Render MP4' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('radio', { name: /^720p/ }).check();
  // A folder needs the system folder picker, which a test can't answer: use downloads.
  await dialog.getByRole('radio', { name: 'Downloads' }).check();
  const downloadPromise = page.waitForEvent('download', { timeout: 240_000 });
  await dialog.getByRole('button', { name: 'Render', exact: true }).click();
  const download = await downloadPromise;
  const dir = mkdtempSync(join(tmpdir(), 'sp-workflow-'));
  const file = join(dir, download.suggestedFilename());
  await download.saveAs(file);
  expect(download.suggestedFilename()).toMatch(/^SP_Workflow-rise_.+_\d{6}\.mp4$/);
  expect(statSync(file).size).toBeGreaterThan(20_000);

  const probe = ffprobe(file);
  const video = probe.streams.find((s) => s.codec_type === 'video');
  const audio = probe.streams.find((s) => s.codec_type === 'audio');
  expect(video?.codec_name).toBe('h264');
  expect(audio?.codec_name).toMatch(/aac|opus/);
  // The transport shows tenths, so allow that rounding plus one frame.
  expect(Math.abs(Number(probe.format.duration) - timeline)).toBeLessThan(0.1 + 1 / 30);

  // The Library lists the signature and the composition.
  await page.getByRole('dialog', { name: 'Render finished' }).getByRole('button').first().click();
  await page.goto('./#/');
  await expect(page.getByText('Workflow rise').first()).toBeVisible();
  expect(errors).toEqual([]);
});
