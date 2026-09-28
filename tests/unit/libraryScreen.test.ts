import { describe, expect, it } from 'vitest';
import type { Composition } from '../../src/engine/composition';
import type { SignatureMeta } from '../../src/library';
import { countOf, formatChanged, formatDuration } from '../../src/screens/Library/format';
import { describeImport } from '../../src/screens/Library/importSummary';
import type { ImportOutcome } from '../../src/state/libraryStore';

const meta = (name: string, contentHash = 'a'.repeat(64)) =>
  ({ name, contentHash }) as SignatureMeta;
const comp = (name: string) =>
  ({ name, signature: { id: 's', contentHash: 'b'.repeat(64), name: 'Wink' } }) as Composition;

const signatureAdded = (name: string, reconnected = 0, hash?: string): ImportOutcome => ({
  ok: true,
  fileName: `${name}.sig.json`,
  result: { kind: 'signature', status: 'added', meta: meta(name, hash), reconnected },
});
const compositionAdded = (name: string, missing = false): ImportOutcome => ({
  ok: true,
  fileName: `${name}.spcomp.json`,
  result: {
    kind: 'composition',
    status: 'added',
    composition: comp(name),
    missingSignature: missing ? comp(name).signature : null,
  },
});

describe('library wording', () => {
  it('says when something changed, plainly', () => {
    const now = new Date(2026, 8, 28, 15, 0);
    expect(formatChanged(new Date(2026, 8, 28, 11, 40).toISOString(), now, 'en-US')).toBe(
      'today at 11:40 AM',
    );
    expect(formatChanged(new Date(2026, 8, 27, 23, 0).toISOString(), now, 'en-US')).toBe(
      'yesterday',
    );
    expect(formatChanged(new Date(2026, 7, 2, 9, 0).toISOString(), now, 'en-GB')).toBe(
      '2 Aug 2026',
    );
    expect(formatChanged('not a date', now)).toBe('');
  });

  it('says how long a signature is', () => {
    expect(formatDuration(2.2)).toBe('2.2 seconds');
    expect(formatDuration(1)).toBe('1 second');
    expect(formatDuration(14.4)).toBe('14 seconds');
    expect(formatDuration(65)).toBe('1 min 5 s');
    expect(formatDuration(120)).toBe('2 min');
    expect(countOf(1, 'composition', 'compositions')).toBe('1 composition');
    expect(countOf(0, 'composition', 'compositions')).toBe('0 compositions');
  });
});

describe('import notices', () => {
  it('names a single added item', () => {
    expect(describeImport([signatureAdded('Wink 01')])).toEqual([
      { tone: 'success', text: 'Added the signature “Wink 01”.' },
    ]);
  });

  it('summarizes a batch in one confirmation, with reconnections and repeats', () => {
    const notices = describeImport([
      signatureAdded('Wink 01', 2),
      compositionAdded('Track 01'),
      compositionAdded('Track 02'),
      {
        ok: true,
        fileName: 'old.sig.json',
        result: { kind: 'signature', status: 'already-present', meta: meta('Old'), reconnected: 0 },
      },
    ]);
    expect(notices).toEqual([
      {
        tone: 'success',
        text: 'Added 1 signature and 2 compositions. 2 compositions that were waiting can play again. “Old” is already in your library.',
      },
    ]);
  });

  it('asks for a missing signature unless the same import brought it', () => {
    const alone = describeImport([compositionAdded('Track 01', true)]);
    expect(alone).toHaveLength(2);
    expect(alone[1]).toMatchObject({ tone: 'warning', needs: { name: 'Wink' } });
    expect(alone[1]?.text).toContain('needs the signature “Wink”');

    const together = describeImport([
      compositionAdded('Track 01', true),
      signatureAdded('Wink', 1, 'b'.repeat(64)),
    ]);
    expect(together.map((n) => n.tone)).toEqual(['success']);
  });

  it('reports each file that failed, after the confirmation', () => {
    const notices = describeImport([
      { ok: false, fileName: 'notes.json', message: "This file isn't a Synesthesia signature." },
      signatureAdded('Wink 01'),
    ]);
    expect(notices.map((n) => n.tone)).toEqual(['success', 'error']);
    expect(notices[1]?.text).toBe(
      "“notes.json” wasn't imported. This file isn't a Synesthesia signature.",
    );
  });
});
