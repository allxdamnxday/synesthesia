import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Download, type Page } from '@playwright/test';

// Album mode (SPEC 12.3), driven like a person would: import a signature, plan an album,
// work through its tracks, export the log, and check that the same master seed and
// settings make the same drafts again.

const FIXTURE_PATH = resolve(import.meta.dirname, '../fixtures/sample.sig.json');
const MASTER_SEED = '314159';

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

async function importSample(page: Page) {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Library', level: 1 })).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import file' }).click();
  await (await chooser).setFiles(FIXTURE_PATH);
  await expect(page.getByText('Added the signature “Sample wink”.')).toBeVisible();
}

async function openNewAlbum(page: Page) {
  await page.getByRole('button', { name: 'More actions for Sample wink', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New album' }).click();
  await expect(page.getByRole('heading', { name: 'New album', level: 1 })).toBeVisible();
}

/** Names of the checked materials in one of the New album form's groups. */
async function checkedMaterials(page: Page, group: string): Promise<string[]> {
  return page
    .getByRole('group', { name: group })
    .getByRole('checkbox', { checked: true })
    .evaluateAll((boxes) => boxes.map((b) => b.getAttribute('aria-label') ?? ''));
}

interface TrackShape {
  visual: string;
  sound: string;
  open: string;
  seed: string;
}

/** What shapes each track, read from the album's track list. */
async function readTracks(page: Page): Promise<TrackShape[]> {
  const rows = page.getByRole('list', { name: 'Tracks' }).getByRole('listitem');
  return rows.evaluateAll((items) =>
    items.map((item) => {
      const text = (id: string) =>
        item.querySelector(`[data-testid="${id}"]`)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      const materials = /^Visual (.+) · Sound (.+)$/.exec(text('track-materials'));
      return {
        visual: materials?.[1] ?? '',
        sound: materials?.[2] ?? '',
        open: text('track-open'),
        seed: text('track-seed'),
      };
    }),
  );
}

function statusGroup(page: Page, number: string) {
  return page.getByRole('radiogroup', { name: `Status of track ${number}` });
}

/** The New album summary for a grid of `pairs` pairings and 25 tracks. */
function gridShape(pairs: number): string {
  if (pairs === 25) return '25 tracks · every visual and sound pairing once';
  if (pairs > 25) return `25 tracks · 25 of the ${pairs} visual and sound pairings`;
  if (pairs === 1) return '25 tracks · the one visual and sound pairing, each time';
  return '25 tracks · every visual and sound pairing, then repeats';
}

async function writeNotes(page: Page, number: string, notes: string) {
  const toggle = page.getByRole('button', { name: `Notes for track ${number}` });
  await toggle.click();
  const field = page.getByRole('textbox', { name: `Notes for track ${number}` });
  await field.fill(notes);
  await field.blur();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await toggle.click();
  await expect(field).toBeHidden();
}

test('a grid album: 25 drafts, worked, exported, kept after reload, and reproducible', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await importSample(page);
  await openNewAlbum(page);

  // Starting values: every material except the Signature view, grid pairing, K = 2.
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue('Sample wink album');
  await expect(page.getByRole('spinbutton', { name: 'Tracks' })).toHaveValue('25');
  await expect(page.getByRole('textbox', { name: 'Master seed' })).toHaveValue(/^\d{6}$/);
  await expect(page.getByRole('checkbox', { name: 'Signature', exact: true })).not.toBeChecked();
  await expect(page.getByRole('radio', { name: 'Every pairing once' })).toBeChecked();
  await expect(
    page.getByRole('radiogroup', { name: 'Open properties per track' }).getByRole('radio', {
      name: '2',
    }),
  ).toBeChecked();
  await expect(page.getByRole('switch', { name: 'Also choose values' })).not.toBeChecked();
  const visuals = await checkedMaterials(page, 'Visual materials');
  const sounds = await checkedMaterials(page, 'Sound materials');
  expect(visuals.length).toBeGreaterThan(0);
  expect(visuals).not.toContain('Signature');
  expect(sounds.length).toBeGreaterThan(0);
  const pairs = visuals.length * sounds.length;

  // Seeds are six digits; Enter tidies the field and never generates the album.
  const seedField = page.getByRole('textbox', { name: 'Master seed' });
  await page.getByRole('button', { name: 'New seed' }).click();
  await expect(seedField).toHaveValue(/^\d{6}$/);
  await seedField.fill('12ab');
  await seedField.press('Enter');
  await expect(seedField).toHaveValue('000012');
  await expect(page.getByRole('heading', { name: 'New album', level: 1 })).toBeVisible();
  await seedField.fill(MASTER_SEED);
  await expect(page.getByTestId('album-summary')).toContainText(gridShape(pairs));
  await expect(page.getByTestId('album-summary')).toContainText(
    'Each track opens 2 properties for play; the rest stay at their baseline.',
  );

  await page.getByRole('button', { name: 'Generate album' }).click();
  await expect(page.getByRole('heading', { name: 'Sample wink album', level: 1 })).toBeVisible();
  await expect(page.getByTestId('album-counts')).toHaveText(
    '25 tracks · 0 kept · 0 set aside · 25 draft',
  );
  await expect(page.getByText(`master seed ${MASTER_SEED}`)).toBeVisible();

  // 25 drafts; every visual × sound pairing once (then repeating, if there are fewer).
  const first = await readTracks(page);
  expect(first).toHaveLength(25);
  for (const t of first) {
    expect(visuals).toContain(t.visual);
    expect(sounds).toContain(t.sound);
    expect(t.open).toMatch(/^Open: [A-Z][a-z]+, [A-Z][a-z]+$/);
    expect(t.seed).toMatch(/^Seed \d{6}$/);
  }
  const pairOf = (t: TrackShape) => `${t.visual}/${t.sound}`;
  const everyPair = visuals.flatMap((v) => sounds.map((s) => `${v}/${s}`)).sort();
  const firstCycle = first.slice(0, Math.min(pairs, 25)).map(pairOf);
  expect(new Set(firstCycle).size).toBe(firstCycle.length);
  if (pairs <= 25) expect([...new Set(first.map(pairOf))].sort()).toEqual(everyPair);

  // Work the album: statuses save at once, notes save as they're written.
  await statusGroup(page, '01').getByRole('radio', { name: 'Kept' }).click();
  await statusGroup(page, '02').getByRole('radio', { name: 'Set aside' }).click();
  await expect(statusGroup(page, '02').getByRole('radio', { name: 'Set aside' })).toBeChecked();
  await writeNotes(page, '01', 'The close reads clearly.\nThe open is softer.');
  await writeNotes(page, '02', 'Too busy: the wink is lost.');
  const tracks = page.getByRole('list', { name: 'Tracks' }).getByRole('listitem');
  await expect(tracks.nth(0)).toContainText('“The close reads clearly.”');
  await expect(tracks.nth(1)).toContainText('“Too busy: the wink is lost.”');
  await expect(page.getByTestId('album-counts')).toHaveText(
    '25 tracks · 1 kept · 1 set aside · 23 draft',
  );

  // Export the album log and the album file.
  const downloads: Download[] = [];
  page.on('download', (d) => downloads.push(d));
  await page.getByRole('button', { name: 'Export album log' }).click();
  await expect(
    page.getByText('Saved “ALBUM_LOG.md” and “Sample-wink-album.spalbum.json”'),
  ).toBeVisible();
  await expect.poll(() => downloads.length).toBe(2);
  const byName = new Map(downloads.map((d) => [d.suggestedFilename(), d]));
  const logDownload = byName.get('ALBUM_LOG.md');
  const albumDownload = byName.get('Sample-wink-album.spalbum.json');
  if (!logDownload || !albumDownload) {
    throw new Error(`Unexpected files: ${[...byName.keys()].join(', ')}`);
  }
  const log = readFileSync(await logDownload.path(), 'utf8');
  expect(log).toContain('# Sample wink album');
  expect(log).toContain(`- **Master seed:** ${MASTER_SEED}`);
  expect(log).toContain('Kept 1 · Set aside 1 · Draft 23.');
  expect(log).toMatch(/## 02\. 02\n\n\| \| \|\n\|---\|---\|\n\| Status \| Set aside \|/);
  expect(log).toContain('**Notes.** Too busy: the wink is lost.');
  expect(log).toContain(`| Seed | ${first[1].seed.slice(5)} |`);
  const albumFile = JSON.parse(readFileSync(await albumDownload.path(), 'utf8')) as {
    format: string;
    settings: { masterSeed: number; strategy: string; trackCount: number };
    compositionIds: string[];
  };
  expect(albumFile.format).toBe('sp-album');
  expect(albumFile.settings).toMatchObject({
    masterSeed: 314159,
    strategy: 'grid',
    trackCount: 25,
  });
  expect(albumFile.compositionIds).toHaveLength(25);

  // Everything is still there after a reload.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sample wink album', level: 1 })).toBeVisible();
  await expect(statusGroup(page, '01').getByRole('radio', { name: 'Kept' })).toBeChecked();
  await expect(statusGroup(page, '02').getByRole('radio', { name: 'Set aside' })).toBeChecked();
  await expect(statusGroup(page, '03').getByRole('radio', { name: 'Draft' })).toBeChecked();
  await expect(tracks.nth(1)).toContainText('“Too busy: the wink is lost.”');
  expect(await readTracks(page)).toEqual(first);

  // The Library lists the album.
  await page
    .getByRole('navigation', { name: 'Breadcrumb' })
    .getByRole('link', { name: 'Library' })
    .click();
  const albums = page.getByRole('list', { name: 'Albums' });
  const card = albums.getByRole('listitem').filter({ hasText: 'Sample wink album' });
  await expect(card).toContainText('From “Sample wink” · 25 tracks');
  await expect(card).toContainText('1 kept · Changed today at');

  // The same master seed and settings make identical drafts in a fresh album.
  await openNewAlbum(page);
  await page.getByRole('textbox', { name: 'Title' }).fill('Second pass');
  await page.getByRole('textbox', { name: 'Master seed' }).fill(MASTER_SEED);
  await page.getByRole('button', { name: 'Generate album' }).click();
  await expect(page.getByRole('heading', { name: 'Second pass', level: 1 })).toBeVisible();
  expect(await readTracks(page)).toEqual(first);
  await expect(page.getByTestId('album-counts')).toHaveText(
    '25 tracks · 0 kept · 0 set aside · 25 draft',
  );

  await page.getByRole('link', { name: 'Library' }).first().click();
  await expect(albums.getByRole('listitem')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('deleting an album keeps its compositions unless asked', async ({ page }) => {
  const errors = watchErrors(page);
  await importSample(page);
  const compositions = page.getByRole('list', { name: 'Compositions' }).getByRole('listitem');

  // A small pure-chance album, deleted from its own screen: its compositions stay.
  await openNewAlbum(page);
  await page.getByRole('textbox', { name: 'Title' }).fill('Short');
  await page.getByRole('spinbutton', { name: 'Tracks' }).fill('3');
  await page.getByRole('radio', { name: 'Pure chance' }).click();
  await expect(page.getByTestId('album-summary')).toContainText('3 tracks · pure chance');
  await page.getByRole('button', { name: 'Generate album' }).click();
  await expect(page.getByRole('heading', { name: 'Short', level: 1 })).toBeVisible();
  await expect(page.getByTestId('album-counts')).toHaveText(
    '3 tracks · 0 kept · 0 set aside · 3 draft',
  );
  await page.getByRole('button', { name: 'More actions for Short' }).click();
  await page.getByRole('menuitem', { name: 'Delete album' }).click();
  let dialog = page.getByRole('dialog', { name: 'Delete “Short”?' });
  await expect(dialog).toContainText('Its 3 compositions stay in your library');
  await expect(
    dialog.getByRole('checkbox', { name: 'Also delete its 3 compositions and their notes' }),
  ).not.toBeChecked();
  await dialog.getByRole('button', { name: 'Delete album' }).click();
  await expect(page.getByRole('heading', { name: 'Library', level: 1 })).toBeVisible();
  await expect(page.getByText('No albums yet.', { exact: false })).toBeVisible();
  await expect(compositions).toHaveCount(3);

  // Another, deleted from the Library with its compositions, because the box is ticked.
  await openNewAlbum(page);
  await page.getByRole('textbox', { name: 'Title' }).fill('Brief');
  await page.getByRole('spinbutton', { name: 'Tracks' }).fill('2');
  await page.getByRole('button', { name: 'Generate album' }).click();
  await expect(page.getByRole('heading', { name: 'Brief', level: 1 })).toBeVisible();
  await page.getByRole('link', { name: 'Library' }).first().click();
  await expect(compositions).toHaveCount(5);
  await page.getByRole('button', { name: 'More actions for Brief', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  dialog = page.getByRole('dialog', { name: 'Delete “Brief”?' });
  await dialog
    .getByRole('checkbox', { name: 'Also delete its 2 compositions and their notes' })
    .check();
  await expect(dialog).toContainText('This can’t be undone.');
  await dialog.getByRole('button', { name: 'Delete album and compositions' }).click();
  await expect(page.getByText('Deleted the album “Brief” and 2 compositions.')).toBeVisible();
  await expect(compositions).toHaveCount(3);
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------------------
// Through the harness page dev/album/ (window.albumLib): album storage in real IndexedDB,
// and the Batch render panel driven by a stand-in renderer.

const FIXTURE_TEXT = readFileSync(FIXTURE_PATH, 'utf8');

interface HarnessAlbum {
  id: string;
  title: string;
  compositionIds: string[];
  renders: Record<string, string>;
  settings: { masterSeed: number; trackCount: number };
}
interface HarnessTrack {
  id: string;
  name: string;
  seed: number;
  status: string;
  chance: {
    albumId?: string;
    index?: number;
    masterSeed?: number;
    openProperties: string[];
    overrides: string[];
  } | null;
}
type Outcome<T> = { ok: true; value: T } | { ok: false; name: string; message: string };

/** The parts of dev/album/main.tsx that these tests use. */
interface AlbumHarness {
  reset(): Promise<void>;
  saveSignatureText(text: string): Promise<{ id: string }>;
  createAlbum(signatureId: string, settings?: Record<string, unknown>): Promise<HarnessAlbum>;
  getAlbumWithTracks(
    id: string,
  ): Promise<{ album: HarnessAlbum; tracks: Array<HarnessTrack | undefined> } | undefined>;
  listAlbums(): Promise<Array<{ album: HarnessAlbum; counts: Record<string, number> }>>;
  setTrackStatus(id: string, status: string): Promise<HarnessTrack>;
  setAlbumRender(
    albumId: string,
    compositionId: string,
    fileName: string,
  ): Promise<Outcome<HarnessAlbum>>;
  albumText(id: string): Promise<string>;
  importAlbumText(
    text: string,
  ): Promise<Outcome<{ status: string; album: HarnessAlbum; missingTracks: number }>>;
  deleteAlbum(id: string, deleteCompositions: boolean): Promise<{ deletedCompositions: number }>;
  compositionCount(): Promise<number>;
  backupAndRestore(): Promise<{
    entries: string[];
    summary: Record<string, { added: number; replaced: number }>;
  }>;
  restoreDamagedAlbum(): Promise<{ outcome: Outcome<unknown>; unchanged: boolean }>;
  show(
    albumId: string,
    options: { frames: number; frameMs: number; fail: string[]; real?: boolean },
  ): void;
  calls(): string[];
  recorded(): Array<{ albumId: string; compositionId: string; fileName: string }>;
  folderFiles(): Promise<string[]>;
  folderFile(name: string): Promise<{ bytes: number; head: string }>;
}

declare global {
  interface Window {
    albumLib: AlbumHarness;
  }
}

async function openHarness(page: Page): Promise<string> {
  await page.goto('./dev/album/');
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  await page.evaluate(() => window.albumLib.reset());
  const meta = await page.evaluate((t) => window.albumLib.saveSignatureText(t), FIXTURE_TEXT);
  return meta.id;
}

test('album storage: drafts, renders, album files, backup and restore', async ({ page }) => {
  const signatureId = await openHarness(page);
  const album = await page.evaluate(
    (id) => window.albumLib.createAlbum(id, { trackCount: 5 }),
    signatureId,
  );
  const loaded = await page.evaluate((id) => window.albumLib.getAlbumWithTracks(id), album.id);
  expect(loaded?.tracks).toHaveLength(5);
  loaded?.tracks.forEach((t, i) => {
    expect(t?.name).toBe(String(i + 1).padStart(2, '0'));
    expect(t?.status).toBe('draft');
    expect(t?.chance).toEqual({
      albumId: album.id,
      index: i + 1,
      masterSeed: 314159,
      openProperties: t?.chance?.openProperties,
      overrides: [],
    });
  });

  // Recording a render: only for the album's own tracks.
  const [c1, c2] = album.compositionIds;
  const rendered = await page.evaluate(
    ([a, c]) => window.albumLib.setAlbumRender(a, c, 'SP_Sample-wink_02_589372.mp4'),
    [album.id, c2],
  );
  expect(rendered.ok && rendered.value.renders).toEqual({ [c2]: 'SP_Sample-wink_02_589372.mp4' });
  const stray = await page.evaluate(
    (a) => window.albumLib.setAlbumRender(a, 'not-a-track', 'x.mp4'),
    album.id,
  );
  expect(stray).toMatchObject({
    ok: false,
    message: "That track isn't part of this album any more.",
  });

  // Album files: the same file again is recognised; a changed one is added beside it.
  const text = await page.evaluate((id) => window.albumLib.albumText(id), album.id);
  const again = await page.evaluate((t) => window.albumLib.importAlbumText(t), text);
  expect(again).toMatchObject({ ok: true, value: { status: 'already-present', missingTracks: 0 } });
  const renamed = text.replace('"title": "Harness album"', '"title": "Harness album, again"');
  const added = await page.evaluate((t) => window.albumLib.importAlbumText(t), renamed);
  expect(added).toMatchObject({ ok: true, value: { status: 'added', missingTracks: 0 } });
  if (added.ok) expect(added.value.album.id).not.toBe(album.id);
  const foreign = await page.evaluate(
    (t) => window.albumLib.importAlbumText(t),
    text.replace(c1, 'from-another-library').replace(album.id, 'album-elsewhere'),
  );
  expect(foreign).toMatchObject({ ok: true, value: { status: 'added', missingTracks: 1 } });
  const notAlbum = await page.evaluate((t) => window.albumLib.importAlbumText(t), FIXTURE_TEXT);
  expect(notAlbum).toMatchObject({ ok: false, message: "This file isn't a Synesthesia album." });

  // A status change shows in the album's counts.
  await page.evaluate((c) => window.albumLib.setTrackStatus(c, 'set-aside'), c1);
  const listed = await page.evaluate(() => window.albumLib.listAlbums());
  const mine = listed.find((s) => s.album.id === album.id);
  expect(mine?.counts).toEqual({ draft: 4, kept: 0, setAside: 1, missing: 0 });

  // Backup and restore bring albums back exactly; a damaged album refuses the restore.
  const beforeBackup = await page.evaluate((id) => window.albumLib.albumText(id), album.id);
  const { entries, summary } = await page.evaluate(() => window.albumLib.backupAndRestore());
  expect(entries.filter((e) => e.startsWith('albums/'))).toHaveLength(3);
  expect(summary.albums).toEqual({ added: 3, replaced: 0 });
  expect(await page.evaluate((id) => window.albumLib.albumText(id), album.id)).toBe(beforeBackup);
  const restored = await page.evaluate((id) => window.albumLib.getAlbumWithTracks(id), album.id);
  expect(restored?.album.renders).toEqual({ [c2]: 'SP_Sample-wink_02_589372.mp4' });
  expect(restored?.tracks[0]?.status).toBe('set-aside');
  const damaged = await page.evaluate(() => window.albumLib.restoreDamagedAlbum());
  expect(damaged.outcome).toMatchObject({
    ok: false,
    message: 'This backup is damaged, so nothing was restored.',
  });
  expect(damaged.unchanged).toBe(true);

  // Deleting keeps the compositions unless asked.
  expect(await page.evaluate(() => window.albumLib.compositionCount())).toBe(5);
  const kept = await page.evaluate((id) => window.albumLib.deleteAlbum(id, false), album.id);
  expect(kept.deletedCompositions).toBe(0);
  expect(await page.evaluate(() => window.albumLib.compositionCount())).toBe(5);
  const other = listed.find((s) => s.album.title === 'Harness album, again');
  if (!other) throw new Error('The imported album is missing');
  const gone = await page.evaluate((id) => window.albumLib.deleteAlbum(id, true), other.album.id);
  expect(gone.deletedCompositions).toBe(5);
  expect(await page.evaluate(() => window.albumLib.compositionCount())).toBe(0);
});

test('batch render with a stand-in renderer: progress, pause, a failure, a summary, cancel', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const signatureId = await openHarness(page);
  const album = await page.evaluate(
    (id) => window.albumLib.createAlbum(id, { trackCount: 5 }),
    signatureId,
  );
  for (const i of [1, 3]) {
    await page.evaluate((c) => window.albumLib.setTrackStatus(c, 'kept'), album.compositionIds[i]);
  }
  await page.evaluate(
    (id) => window.albumLib.show(id, { frames: 12, frameMs: 40, fail: ['03'] }),
    album.id,
  );
  const panel = page.getByRole('region', { name: 'Batch render' });
  await expect(panel).toContainText('2 of 5 tracks chosen');
  await expect(panel).not.toContainText('isn’t part of this version');
  await panel.getByRole('button', { name: 'Select all' }).click();
  const render = panel.getByRole('button', { name: 'Render 5 tracks' });
  await expect(render).toBeDisabled(); // no folder yet
  await panel.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(panel).toContainText('“Album renders”');
  await render.click();

  const running = page.getByRole('region', { name: 'Rendering “Harness album”' });
  await expect(running.getByRole('status')).toContainText(/Track [12] of 5/);
  await running.getByRole('button', { name: 'Pause' }).click();
  await expect(running.getByRole('status')).toHaveText(
    'Paused. Resume to carry on where it stopped.',
  );
  const progress = () =>
    running
      .getByRole('progressbar')
      .evaluateAll((bars) => bars.map((b) => b.getAttribute('aria-valuenow')).join(','));
  const held = await progress();
  await page.waitForTimeout(600);
  expect(await progress()).toBe(held);
  await running.getByRole('button', { name: 'Resume' }).click();

  const finished = page.getByRole('region', { name: 'Batch render finished' });
  await expect(finished).toBeVisible({ timeout: 30_000 });
  await expect(finished.getByRole('status')).toContainText(/^Rendered 4 of 5 tracks in \d+ s\./);
  await expect(finished.getByRole('status')).toContainText(
    'The videos are in the folder “Album renders”.',
  );
  await expect(finished).toContainText('1 track couldn’t be rendered.');
  const rows = finished.getByRole('list', { name: 'Tracks in this batch' }).getByRole('listitem');
  await expect(rows.nth(2)).toContainText('The video encoder stopped. Try the 720p size.');
  await expect(rows.nth(0)).toContainText(/Saved as SP_Sample-wink_01_\d{6}\.mp4/);

  expect(await page.evaluate(() => window.albumLib.calls())).toEqual([
    '01',
    '02',
    '03',
    '04',
    '05',
  ]);
  const files = await page.evaluate(() => window.albumLib.folderFiles());
  expect(files).toHaveLength(4);
  expect(files.some((f) => f.includes('_03_'))).toBe(false);
  const withRenders = await page.evaluate((id) => window.albumLib.getAlbumWithTracks(id), album.id);
  expect(Object.keys(withRenders?.album.renders ?? {})).toHaveLength(4);
  expect(Object.values(withRenders?.album.renders ?? {}).sort()).toEqual(files);

  // Done puts it away; a second batch is cancelled partway.
  await finished.getByRole('button', { name: 'Done' }).click();
  await page.evaluate(
    (id) => window.albumLib.show(id, { frames: 20, frameMs: 40, fail: [] }),
    album.id,
  );
  await expect(panel).toContainText('“Album renders”'); // the folder is kept for the session
  await panel.getByRole('button', { name: 'Select all' }).click();
  await panel.getByRole('button', { name: 'Render 5 tracks' }).click();
  await expect(running.getByRole('status')).toContainText('Track 2 of 5', { timeout: 15_000 });
  await running.getByRole('button', { name: 'Cancel' }).click();
  const cancelled = page.getByRole('region', { name: 'Batch render cancelled' });
  await expect(cancelled).toBeVisible();
  await expect(cancelled).toContainText(
    '4 tracks weren’t rendered because the batch was cancelled.',
  );
  await expect(cancelled.getByRole('status')).toContainText(/^Rendered 1 of 5 tracks/);
  expect(errors).toEqual([]);
});

test('batch render starts with the kept tracks chosen', async ({ page }) => {
  await importSample(page);
  await openNewAlbum(page);
  await page.getByRole('spinbutton', { name: 'Tracks' }).fill('4');
  await page.getByRole('button', { name: 'Generate album' }).click();
  await expect(page.getByRole('heading', { name: 'Sample wink album', level: 1 })).toBeVisible();
  await statusGroup(page, '03').getByRole('radio', { name: 'Kept' }).click();

  await page.getByRole('button', { name: 'Batch render' }).click();
  const panel = page.getByRole('region', { name: 'Batch render' });
  // Kept tracks are chosen to start with; the others are a click away.
  await expect(panel.getByRole('checkbox', { name: 'Render track 03' })).toBeChecked();
  await expect(panel).toContainText('1 of 4 tracks chosen');
  await panel.getByRole('button', { name: 'Select all' }).click();
  await expect(panel).toContainText('4 of 4 tracks chosen');
  await panel.getByRole('button', { name: 'Select none' }).click();
  await panel.getByRole('button', { name: 'Select kept' }).click();
  await expect(panel).toContainText('1 of 4 tracks chosen');
  await panel.getByRole('button', { name: 'Close' }).click();
  await expect(panel).toBeHidden();
});

test('batch render makes real MP4s and composition files, recorded in the album', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors = watchErrors(page);
  const signatureId = await openHarness(page);
  const album = await page.evaluate(
    (id) => window.albumLib.createAlbum(id, { trackCount: 2 }),
    signatureId,
  );
  await page.evaluate(
    (id) => window.albumLib.show(id, { frames: 0, frameMs: 0, fail: [], real: true }),
    album.id,
  );
  const panel = page.getByRole('region', { name: 'Batch render' });
  await panel.getByRole('button', { name: 'Select all' }).click();
  await panel.getByRole('button', { name: 'Choose folder…' }).click();
  await panel.getByRole('button', { name: 'Render 2 tracks' }).click();

  const finished = page.getByRole('region', { name: 'Batch render finished' });
  await expect(finished).toBeVisible({ timeout: 180_000 });
  await expect(finished.getByRole('status')).toContainText(/^Rendered 2 of 2 tracks/);
  const files = await page.evaluate(() => window.albumLib.folderFiles());
  const videos = files.filter((f) => f.endsWith('.mp4'));
  expect(videos).toHaveLength(2);
  expect(files.filter((f) => f.endsWith('.spcomp.json'))).toHaveLength(2);
  for (const name of videos) {
    const file = await page.evaluate((n) => window.albumLib.folderFile(n), name);
    expect(file.bytes).toBeGreaterThan(20_000);
    expect(file.head.slice(8, 16)).toBe('66747970'); // "ftyp": an MP4
  }
  const withRenders = await page.evaluate((id) => window.albumLib.getAlbumWithTracks(id), album.id);
  expect(Object.values(withRenders?.album.renders ?? {}).sort()).toEqual(videos);
  expect(errors).toEqual([]);
});
