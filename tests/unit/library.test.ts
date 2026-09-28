import { describe, expect, it } from 'vitest';
import { FileFormatError } from '../../src/signature/serialize';
import { backupFileName, describeRestore } from '../../src/library/backup';
import { LibraryError, MESSAGES, errorDetail, userMessage } from '../../src/library/errors';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../../src/library/settings';
import { signatureMetaOf } from '../../src/library/signatures';
import { formatBytes } from '../../src/library/storage';
import { computeFieldSketch } from '../../src/library/thumbnails';
import { byUpdatedDesc, cleanName, copyName, fileNameFor } from '../../src/library/util';
import { makeSignature } from './helpers/signatureFactory';

describe('names', () => {
  it('cleans names and falls back when empty', () => {
    expect(cleanName('  Wink   01 \n', 'Untitled')).toBe('Wink 01');
    expect(cleanName('   ', 'Untitled')).toBe('Untitled');
    expect(cleanName('x'.repeat(300), 'Untitled')).toHaveLength(120);
  });

  it('names copies and file names plainly', () => {
    expect(copyName('Wink 01')).toBe('Wink 01 copy');
    expect(copyName('x'.repeat(120))).toHaveLength(120);
    expect(fileNameFor('Wink 01: left eye', '.sig.json')).toBe('Wink-01-left-eye.sig.json');
    expect(fileNameFor('???', '.spcomp.json')).toBe('untitled.spcomp.json');
  });

  it('sorts newest first with a stable tie-break', () => {
    const items = [
      { id: 'b', name: 'B', updatedAt: '2026-09-28T10:00:00.000Z' },
      { id: 'a', name: 'A', updatedAt: '2026-09-28T10:00:00.000Z' },
      { id: 'c', name: 'C', updatedAt: '2026-09-28T11:00:00.000Z' },
    ];
    expect(items.sort(byUpdatedDesc).map((i) => i.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('settings', () => {
  it('fill in defaults and ignore malformed values', () => {
    expect(sanitizeSettings({})).toEqual(DEFAULT_SETTINGS);
    const s = sanitizeSettings({
      previewQuality: 'standard',
      renderFps: 24,
      dedicationSplash: 'yes',
      onboardingDone: true,
      persistence: 'granted',
      unknown: 1,
    });
    expect(s.previewQuality).toBe('standard');
    expect(s.renderFps).toBe(DEFAULT_SETTINGS.renderFps);
    expect(s.dedicationSplash).toBe(DEFAULT_SETTINGS.dedicationSplash);
    expect(s.onboardingDone).toBe(true);
    expect(s.persistence).toBe('granted');
    expect('unknown' in s).toBe(false);
  });
});

describe('messages', () => {
  it('turns any error into a plain sentence', () => {
    expect(userMessage(new LibraryError('Plain.', 'detail'))).toBe('Plain.');
    expect(userMessage(new FileFormatError('damaged', 'Damaged.', 'field.data'))).toBe('Damaged.');
    expect(userMessage(new DOMException('full', 'QuotaExceededError'))).toBe(MESSAGES.quota);
    expect(userMessage(new TypeError('x is undefined'))).toBe(MESSAGES.generic);
    expect(errorDetail(new LibraryError('Plain.', 'detail'))).toBe('Plain. (detail)');
  });

  it('describes a restore', () => {
    const none = { added: 0, replaced: 0 };
    expect(describeRestore({ signatures: none, compositions: none, albums: none })).toBe(
      'The backup was empty, so nothing changed.',
    );
    expect(
      describeRestore({
        signatures: { added: 1, replaced: 0 },
        compositions: { added: 2, replaced: 1 },
        albums: { added: 0, replaced: 2 },
      }),
    ).toBe(
      'Backup restored: 1 signature added; 3 compositions (2 added, 1 replaced); 2 albums replaced.',
    );
  });

  it('names backups by local date and formats sizes', () => {
    expect(backupFileName(new Date(2026, 8, 28, 23, 30))).toBe(
      'synesthesia-backup-2026-09-28.spbackup.zip',
    );
    expect(formatBytes(1)).toBe('1 byte');
    expect(formatBytes(999)).toBe('999 bytes');
    expect(formatBytes(1_500)).toBe('1.5 KB');
    expect(formatBytes(12_345_678)).toBe('12 MB');
  });
});

describe('signature list entries', () => {
  it('summarize a signature without its field', () => {
    const sig = makeSignature({ frameRate: 30, frameCount: 66, cols: 4, rows: 3 });
    const meta = signatureMetaOf(sig, '2026-09-28T12:00:00.000Z', 'data:image/png;base64,x');
    expect(meta.durationSec).toBeCloseTo(2.2, 12);
    expect(meta.grid).toEqual({ cols: 4, rows: 3 });
    expect('field' in meta).toBe(false);
  });
});

describe('field sketch', () => {
  const cols = 3;
  const rows = 3;
  const sketchOf = (fn: (f: number, cell: number) => [number, number], frames = 4) => {
    const field = new Float32Array(frames * cols * rows * 2);
    for (let f = 0; f < frames; f++) {
      for (let cell = 0; cell < cols * rows; cell++) {
        const [u, v] = fn(f, cell);
        field[(f * cols * rows + cell) * 2] = u;
        field[(f * cols * rows + cell) * 2 + 1] = v;
      }
    }
    return computeFieldSketch(field, frames, cols, rows);
  };

  it('keeps back-and-forth motion instead of cancelling it', () => {
    // The centre cell moves down, then up by the same amount (a blink).
    const s = sketchOf((f, cell) => (cell === 4 ? [0, f < 2 ? 1 : -1] : [0, 0]));
    expect(s.strength[4]).toBeCloseTo(1, 6);
    expect(Math.abs(Math.abs(s.angle[4]) - Math.PI / 2)).toBeLessThan(1e-6); // vertical axis
    expect(s.strength[0]).toBe(0);
  });

  it('draws horizontal motion as a horizontal axis and scales by speed', () => {
    const s = sketchOf((_f, cell) => (cell < 3 ? [cell + 1, 0] : [0, 0]));
    expect(Math.abs(s.angle[0])).toBeLessThan(1e-6);
    expect(s.strength[2]).toBeCloseTo(1, 6);
    expect(s.strength[0]).toBeLessThan(s.strength[1]);
    expect(s.strength[1]).toBeLessThan(s.strength[2]);
  });

  it('is blank for a still field', () => {
    const s = sketchOf(() => [0, 0]);
    expect(Array.from(s.strength).every((v) => v === 0)).toBe(true);
  });
});
