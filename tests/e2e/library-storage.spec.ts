import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

// Library storage in real IndexedDB, through the harness page dev/library/ (window.lib).
// Each test gets a fresh browser context, so a fresh, empty library.

const FIXTURE = readFileSync(resolve(import.meta.dirname, '../fixtures/sample.sig.json'), 'utf8');
const FIXTURE_ID = '5a3c1e2f-8b7d-4c6a-9e0f-1d2b3c4a5e6f';

interface Meta {
  id: string;
  name: string;
  updatedAt: string;
  contentHash: string;
  thumbnail: string;
}
interface Comp {
  id: string;
  name: string;
  signature: { id: string; contentHash: string; name: string };
}
type Outcome<T> = { ok: true; value: T } | { ok: false; name: string; message: string };
interface SignatureImport {
  kind: 'signature';
  status: 'added' | 'already-present';
  meta: Meta;
  reconnected: number;
}
interface CompositionImport {
  kind: 'composition';
  status: 'added' | 'already-present';
  composition: Comp;
  missingSignature: Comp['signature'] | null;
}
interface Counts {
  added: number;
  replaced: number;
}
interface Summary {
  signatures: Counts;
  compositions: Counts;
  albums: Counts;
}
interface Snapshot {
  signatures: Meta[];
  compositions: Comp[];
  albums: { id: string }[];
}

/** The parts of dev/library/main.ts that these tests use. */
interface Harness {
  reset(): Promise<void>;
  snapshot(): Promise<Snapshot>;
  saveSignatureText(text: string): Promise<Meta>;
  getSignature(
    id: string,
  ): Promise<{ name: string; contentHash: string; frameCount: number } | undefined>;
  listSignatureMeta(): Promise<Meta[]>;
  renameSignature(id: string, name: string): Promise<Meta>;
  duplicateSignature(id: string): Promise<Meta>;
  deleteSignature(id: string): Promise<{ moved: number }>;
  countCompositionsForSignature(id: string): Promise<number>;
  verifyHash(id: string): Promise<boolean>;
  exportSignatureById(id: string): Promise<string>;
  importSignatureText(
    text: string,
    name?: string,
    expectContentHash?: string,
  ): Promise<Outcome<SignatureImport>>;
  importLibraryText(text: string, name?: string): Promise<Outcome<SignatureImport>>;
  forkSignatureText(text: string): Promise<string>;
  saveCompositionFor(signatureId: string, name: string): Promise<Comp>;
  getComposition(id: string): Promise<Comp | undefined>;
  renameComposition(id: string, name: string): Promise<Comp>;
  duplicateComposition(id: string): Promise<Comp>;
  deleteComposition(id: string): Promise<void>;
  compositionText(id: string): Promise<string>;
  importCompositionText(text: string): Promise<Outcome<CompositionImport>>;
  signatureIdForComposition(id: string): Promise<string | null>;
  putAlbum(album: { id: string; [key: string]: unknown }): Promise<void>;
  createBackupKept(): Promise<{ bytes: number; entries: string[] }>;
  restoreKept(): Promise<Outcome<Summary>>;
  restoreTampered(): Promise<Outcome<Summary>>;
  restoreNotABackup(): Promise<Outcome<Summary>>;
  getSettings(): Promise<{ persistence: string; renderFps: number }>;
  setSetting(key: string, value: unknown): Promise<void>;
  storageEstimate(): Promise<{ usage: number; quota: number } | null>;
}

declare global {
  interface Window {
    lib: Harness;
  }
}

function ok<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) throw new Error(`Expected success, got ${outcome.name}: ${outcome.message}`);
  return outcome.value;
}

test.beforeEach(async ({ page }) => {
  await page.goto('./dev/library/');
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  await page.evaluate(() => window.lib.reset());
});

test('save, list, get, rename, duplicate and delete signatures', async ({ page }) => {
  const meta = await page.evaluate((t) => window.lib.saveSignatureText(t), FIXTURE);
  expect(meta.id).toBe(FIXTURE_ID);
  expect(meta.name).toBe('Sample wink');
  expect(meta.thumbnail).toMatch(/^data:image\/png;base64,/);

  const list = await page.evaluate(() => window.lib.listSignatureMeta());
  expect(list.map((m) => m.id)).toEqual([FIXTURE_ID]);
  const sig = await page.evaluate((id) => window.lib.getSignature(id), FIXTURE_ID);
  expect(sig?.frameCount).toBe(66);
  expect(sig?.contentHash).toBe(meta.contentHash);

  const comp = await page.evaluate(
    (id) => window.lib.saveCompositionFor(id, 'Track 01'),
    FIXTURE_ID,
  );
  const uses = await page.evaluate(
    (id) => window.lib.countCompositionsForSignature(id),
    FIXTURE_ID,
  );
  expect(uses).toBe(1);

  // Rename: the signature, its list entry, and the compositions that use it.
  const renamed = await page.evaluate(
    (id) => window.lib.renameSignature(id, '  Left   eye '),
    FIXTURE_ID,
  );
  expect(renamed.name).toBe('Left eye');
  expect(renamed.updatedAt >= meta.updatedAt).toBe(true);
  expect((await page.evaluate((id) => window.lib.getSignature(id), FIXTURE_ID))?.name).toBe(
    'Left eye',
  );
  const compAfterRename = await page.evaluate((id) => window.lib.getComposition(id), comp.id);
  expect(compAfterRename?.signature.name).toBe('Left eye');

  // Duplicate: new id, same movement.
  const copy = await page.evaluate((id) => window.lib.duplicateSignature(id), FIXTURE_ID);
  expect(copy.name).toBe('Left eye copy');
  expect(copy.id).not.toBe(FIXTURE_ID);
  expect(copy.contentHash).toBe(meta.contentHash);
  expect(copy.thumbnail).toBe(renamed.thumbnail);
  expect(await page.evaluate(() => window.lib.listSignatureMeta())).toHaveLength(2);
  expect(await page.evaluate((id) => window.lib.verifyHash(id), copy.id)).toBe(true);

  // Delete the original: its composition moves to the identical copy.
  expect(await page.evaluate((id) => window.lib.deleteSignature(id), FIXTURE_ID)).toEqual({
    moved: 1,
  });
  expect(await page.evaluate((id) => window.lib.getSignature(id), FIXTURE_ID)).toBeUndefined();
  const moved = await page.evaluate((id) => window.lib.getComposition(id), comp.id);
  expect(moved?.signature.id).toBe(copy.id);

  // Delete the copy too: the composition stays, waiting for its signature.
  expect(await page.evaluate((id) => window.lib.deleteSignature(id), copy.id)).toEqual({
    moved: 0,
  });
  expect(await page.evaluate(() => window.lib.listSignatureMeta())).toEqual([]);
  expect(await page.evaluate((id) => window.lib.signatureIdForComposition(id), comp.id)).toBeNull();

  // Importing the signature again reconnects it.
  const back = ok(await page.evaluate((t) => window.lib.importSignatureText(t), FIXTURE));
  expect(back.status).toBe('added');
  expect(back.reconnected).toBe(1);
  expect(await page.evaluate((id) => window.lib.signatureIdForComposition(id), comp.id)).toBe(
    back.meta.id,
  );
});

test('compositions: save, rename, duplicate, delete, export and import', async ({ page }) => {
  await page.evaluate((t) => window.lib.saveSignatureText(t), FIXTURE);
  const comp = await page.evaluate(
    (id) => window.lib.saveCompositionFor(id, 'Track 01'),
    FIXTURE_ID,
  );
  const renamed = await page.evaluate(
    (id) => window.lib.renameComposition(id, 'Blink, slowly'),
    comp.id,
  );
  expect(renamed.name).toBe('Blink, slowly');
  const copy = await page.evaluate((id) => window.lib.duplicateComposition(id), comp.id);
  expect(copy.name).toBe('Blink, slowly copy');
  expect(copy.signature.id).toBe(FIXTURE_ID);

  // Export → import: an identical file is recognised; a changed one is added as new.
  const text = await page.evaluate((id) => window.lib.compositionText(id), comp.id);
  const same = ok(await page.evaluate((t) => window.lib.importCompositionText(t), text));
  expect(same.status).toBe('already-present');
  const edited = text.replace('"Blink, slowly"', '"Blink, quickly"');
  const added = ok(await page.evaluate((t) => window.lib.importCompositionText(t), edited));
  expect(added.status).toBe('added');
  expect(added.composition.id).not.toBe(comp.id);
  expect(added.missingSignature).toBeNull();

  // A composition whose signature isn't here is kept, and says which signature it needs.
  const orphanText = text
    .replace(comp.id, 'orphan-composition')
    .replace(new RegExp(FIXTURE_ID, 'g'), 'missing-signature')
    .replace(/"contentHash": "[0-9a-f]{64}"/, `"contentHash": "${'b'.repeat(64)}"`);
  const orphan = ok(await page.evaluate((t) => window.lib.importCompositionText(t), orphanText));
  expect(orphan.status).toBe('added');
  expect(orphan.missingSignature).toEqual({
    id: 'missing-signature',
    contentHash: 'b'.repeat(64),
    name: 'Sample wink',
  });
  // Offering the wrong signature for it is refused.
  const wrong = await page.evaluate(
    ([t, hash]) => window.lib.importSignatureText(t, 'wink.sig.json', hash),
    [FIXTURE, 'b'.repeat(64)] as const,
  );
  expect(wrong.ok).toBe(false);
  if (!wrong.ok) expect(wrong.message).toMatch(/different signature/);

  await page.evaluate((id) => window.lib.deleteComposition(id), copy.id);
  expect(await page.evaluate((id) => window.lib.getComposition(id), copy.id)).toBeUndefined();
});

test('signature export and import keep the content hash; a tampered file is refused', async ({
  page,
}) => {
  const meta = await page.evaluate((t) => window.lib.saveSignatureText(t), FIXTURE);
  await page.evaluate((id) => window.lib.renameSignature(id, 'Exported wink'), meta.id);

  const downloadPromise = page.waitForEvent('download');
  const fileName = await page.evaluate((id) => window.lib.exportSignatureById(id), meta.id);
  const download = await downloadPromise;
  expect(fileName).toBe('Exported-wink.sig.json');
  expect(download.suggestedFilename()).toBe('Exported-wink.sig.json');
  const exported = readFileSync(await download.path(), 'utf8');

  await page.evaluate(() => window.lib.reset());
  const imported = ok(await page.evaluate((t) => window.lib.importLibraryText(t), exported));
  expect(imported.kind).toBe('signature');
  expect(imported.status).toBe('added');
  expect(imported.meta.id).toBe(meta.id);
  expect(imported.meta.name).toBe('Exported wink');
  expect(imported.meta.contentHash).toBe(meta.contentHash);
  expect(await page.evaluate((id) => window.lib.verifyHash(id), meta.id)).toBe(true);

  // The same file again: already here, nothing added.
  const again = ok(await page.evaluate((t) => window.lib.importSignatureText(t), exported));
  expect(again.status).toBe('already-present');
  expect(await page.evaluate(() => window.lib.listSignatureMeta())).toHaveLength(1);

  // A different signature claiming the same id gets a new id instead of overwriting.
  const fork = await page.evaluate((t) => window.lib.forkSignatureText(t), exported);
  const forked = ok(await page.evaluate((t) => window.lib.importSignatureText(t), fork));
  expect(forked.status).toBe('added');
  expect(forked.meta.id).not.toBe(meta.id);
  expect(forked.meta.contentHash).not.toBe(meta.contentHash);

  // Movement data changed after export: refused, library unchanged.
  const tampered = exported.replace(/"energy": \[(\d)/, '"energy": [1$1');
  expect(tampered).not.toBe(exported);
  const refused = await page.evaluate((t) => window.lib.importSignatureText(t), tampered);
  expect(refused.ok).toBe(false);
  if (!refused.ok) expect(refused.message).toMatch(/changed or damaged/);
  expect(await page.evaluate(() => window.lib.listSignatureMeta())).toHaveLength(2);

  // Not a signature at all.
  const junk = await page.evaluate(() => window.lib.importLibraryText('{"format":"other"}'));
  expect(junk.ok).toBe(false);
  if (!junk.ok) expect(junk.message).toMatch(/isn't a Synesthesia signature or composition/);
});

test('backup, clear and restore bring everything back', async ({ page }) => {
  const a = await page.evaluate((t) => window.lib.saveSignatureText(t), FIXTURE);
  const b = await page.evaluate((id) => window.lib.duplicateSignature(id), a.id);
  await page.evaluate((id) => window.lib.renameSignature(id, 'Second wink'), b.id);
  const c1 = await page.evaluate((id) => window.lib.saveCompositionFor(id, 'One'), a.id);
  const c2 = await page.evaluate((id) => window.lib.saveCompositionFor(id, 'Two'), a.id);
  await page.evaluate((id) => window.lib.saveCompositionFor(id, 'Three'), b.id);
  await page.evaluate(
    (ids) =>
      window.lib.putAlbum({
        id: 'album-1',
        format: 'sp-album',
        name: 'Winks',
        compositionIds: ids,
      }),
    [c1.id, c2.id],
  );
  const before = await page.evaluate(() => window.lib.snapshot());

  const backup = await page.evaluate(() => window.lib.createBackupKept());
  expect(backup.bytes).toBeGreaterThan(1000);
  expect(backup.entries).toContain('manifest.json');
  expect(backup.entries.filter((e) => e.startsWith('signatures/'))).toHaveLength(2);
  expect(backup.entries.filter((e) => e.startsWith('compositions/'))).toHaveLength(3);
  expect(backup.entries).toContain('albums/album-1.spalbum.json');

  await page.evaluate(() => window.lib.reset());
  expect(await page.evaluate(() => window.lib.snapshot())).toEqual({
    signatures: [],
    compositions: [],
    albums: [],
  });

  const summary = ok(await page.evaluate(() => window.lib.restoreKept()));
  expect(summary).toEqual({
    signatures: { added: 2, replaced: 0 },
    compositions: { added: 3, replaced: 0 },
    albums: { added: 1, replaced: 0 },
  });
  const after = await page.evaluate(() => window.lib.snapshot());
  const comparable = (s: Snapshot) => ({
    ...s,
    signatures: s.signatures.map((m) => ({ ...m, thumbnail: m.thumbnail.startsWith('data:') })),
  });
  expect(comparable(after)).toEqual(comparable(before));
  for (const m of after.signatures) {
    expect(await page.evaluate((id) => window.lib.verifyHash(id), m.id)).toBe(true);
  }

  // Restoring again replaces by id and adds nothing.
  const again = ok(await page.evaluate(() => window.lib.restoreKept()));
  expect(again).toEqual({
    signatures: { added: 0, replaced: 2 },
    compositions: { added: 0, replaced: 3 },
    albums: { added: 0, replaced: 1 },
  });

  // Damaged backups are refused and change nothing.
  await page.evaluate((id) => window.lib.deleteComposition(id), c1.id);
  const tampered = await page.evaluate(() => window.lib.restoreTampered());
  expect(tampered.ok).toBe(false);
  if (!tampered.ok)
    expect(tampered.message).toBe('This backup is damaged, so nothing was restored.');
  const notZip = await page.evaluate(() => window.lib.restoreNotABackup());
  expect(notZip.ok).toBe(false);
  if (!notZip.ok) expect(notZip.message).toBe("This file isn't a Synesthesia backup.");
  expect((await page.evaluate(() => window.lib.snapshot())).compositions).toHaveLength(2);
});

test('settings persist and the first save asks to keep the library', async ({ page }) => {
  expect((await page.evaluate(() => window.lib.getSettings())).persistence).toBe('not-asked');
  await page.evaluate(() => window.lib.setSetting('renderFps', 60));
  expect((await page.evaluate(() => window.lib.getSettings())).renderFps).toBe(60);
  await page.evaluate((t) => window.lib.saveSignatureText(t), FIXTURE);
  await expect
    .poll(async () => (await page.evaluate(() => window.lib.getSettings())).persistence)
    .not.toBe('not-asked');
  const estimate = await page.evaluate(() => window.lib.storageEstimate());
  expect(estimate === null || estimate.usage >= 0).toBe(true);
});
