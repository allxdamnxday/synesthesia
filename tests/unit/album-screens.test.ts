import { describe, expect, it } from 'vitest';
import type { Album } from '../../src/chance/albumModel';
import { sharedProperty } from '../../src/materials/properties';
import type { MaterialMeta } from '../../src/materials/types';
import type { AlbumMaterials } from '../../src/library/albums';
import {
  albumRecipe,
  countsLine,
  formatElapsed,
  formatRemaining,
  notesPreview,
  propertyList,
  statusLabel,
} from '../../src/screens/Album/format';
import {
  FORM_MESSAGES,
  checkForm,
  defaultAlbumTitle,
  describeOpen,
  describeShape,
  initialForm,
  parseTrackCount,
  planNote,
} from '../../src/screens/Album/newAlbumForm';

function meta(id: string, shared: Parameters<typeof sharedProperty>[0][]): MaterialMeta {
  return {
    id,
    version: 1,
    name: id,
    description: '',
    properties: shared.map((p) => sharedProperty(p, 'visual')),
  };
}

const MATERIALS: AlbumMaterials = {
  visual: [meta('water', ['viscosity', 'brightness']), meta('signature', [])],
  sound: [meta('water', ['viscosity', 'range']), meta('breath', ['dispersion'])],
};

describe('new album form', () => {
  it('starts with every material but the Signature view, 25 tracks, a grid and K = 2', () => {
    const form = initialForm('Sample wink', 4217, MATERIALS);
    expect(form).toEqual({
      title: 'Sample wink album',
      trackText: '25',
      seedText: '004217',
      visualPool: ['water'],
      soundPool: ['water', 'breath'],
      openCount: 2,
      strategy: 'grid',
      chooseValues: false,
    });
    expect(defaultAlbumTitle('  ')).toBe('Untitled album');
  });

  it('reads the number of tracks: whole numbers from 1 to 40', () => {
    expect(parseTrackCount('25')).toBe(25);
    expect(parseTrackCount(' 7 ')).toBe(7);
    expect(parseTrackCount('1')).toBe(1);
    expect(parseTrackCount('40')).toBe(40);
    for (const bad of ['', '0', '41', '2.5', '-3', 'ten', '1e1']) {
      expect(parseTrackCount(bad)).toBeNull();
    }
  });

  it('turns a valid form into album settings, and says what needs fixing otherwise', () => {
    const form = initialForm('Wink', 12, MATERIALS);
    expect(checkForm({ ...form, title: '  Wink   studies ' }, MATERIALS)).toEqual({
      settings: {
        title: 'Wink studies',
        trackCount: 25,
        masterSeed: 12,
        visualPool: ['water'],
        soundPool: ['water', 'breath'],
        openCount: 2,
        strategy: 'grid',
        chooseValues: false,
      },
      errors: {},
    });
    const bad = checkForm(
      { ...form, trackText: '0', seedText: '', visualPool: [], soundPool: ['breath'] },
      MATERIALS,
    );
    expect(bad.settings).toBeNull();
    expect(bad.errors).toEqual({
      tracks: FORM_MESSAGES.tracks,
      seed: FORM_MESSAGES.seed,
      materials: FORM_MESSAGES.materials,
    });
    // A pool naming only materials that aren't installed counts as empty.
    expect(checkForm({ ...form, soundPool: ['gone'] }, MATERIALS).errors.materials).toBe(
      FORM_MESSAGES.materials,
    );
  });

  it('describes the album plainly as the settings change', () => {
    expect(describeShape(25, 'grid', 25)).toBe('25 tracks · every visual and sound pairing once');
    expect(describeShape(10, 'grid', 25)).toBe(
      '10 tracks · 10 of the 25 visual and sound pairings',
    );
    expect(describeShape(30, 'grid', 25)).toBe(
      '30 tracks · every visual and sound pairing, then repeats',
    );
    expect(describeShape(25, 'grid', 1)).toBe(
      '25 tracks · the one visual and sound pairing, each time',
    );
    expect(describeShape(1, 'chance', 25)).toBe('1 track · pure chance');
    expect(describeOpen(1, false)).toBe(
      'Each track opens 1 property for play; the rest stay at their baseline.',
    );
    expect(describeOpen(3, true)).toBe(
      'Each track opens 3 properties for play; the rest stay at their baseline. Chance also chooses where the open ones start.',
    );
  });

  it("shows the plan's note when the grid is filled or truncated", () => {
    const settings = checkForm(initialForm('Wink', 1, MATERIALS), MATERIALS).settings;
    if (!settings) throw new Error('expected valid settings');
    expect(planNote(settings, MATERIALS)).toMatch(/repeat/); // 2 pairs, 25 tracks
    expect(planNote({ ...settings, trackCount: 2 }, MATERIALS)).toBeNull();
    expect(planNote({ ...settings, trackCount: 1 }, MATERIALS)).toMatch(/first 1/);
    expect(planNote({ ...settings, strategy: 'chance' }, MATERIALS)).toBeNull();
    expect(planNote({ ...settings, soundPool: [] }, MATERIALS)).toBeNull();
  });
});

describe('album screen wording', () => {
  const album = {
    settings: {
      title: 'Wink album',
      trackCount: 25,
      masterSeed: 42,
      visualPool: ['water'],
      soundPool: ['water'],
      openCount: 1,
      strategy: 'grid',
      chooseValues: true,
    },
  } as Album;

  it('states the recipe and the counts', () => {
    expect(albumRecipe(album, 'Sample wink')).toEqual([
      'From “Sample wink”',
      'master seed 000042',
      'every pairing once',
      '1 open property per track, values by chance',
    ]);
    const chance = {
      settings: { ...album.settings, strategy: 'chance', openCount: 2, chooseValues: false },
    } as Album;
    expect(albumRecipe(chance, 'Wink')[2]).toBe('pure chance');
    expect(albumRecipe(chance, 'Wink')[3]).toBe('2 open properties per track');
    expect(countsLine({ draft: 20, kept: 3, setAside: 2, missing: 0 })).toBe(
      '25 tracks · 3 kept · 2 set aside · 20 draft',
    );
    expect(countsLine({ draft: 0, kept: 0, setAside: 0, missing: 1 })).toBe(
      '1 track · 0 kept · 0 set aside · 0 draft · 1 missing',
    );
    expect(statusLabel('set-aside')).toBe('Set aside');
    expect(statusLabel('kept')).toBe('Kept');
    expect(propertyList(['viscosity', 'range'])).toBe('Viscosity, Range');
  });

  it('previews the first line of notes', () => {
    expect(notesPreview('')).toBe('');
    expect(notesPreview('\n   \n  The close reads clearly.  \nThe open is lost.')).toBe(
      'The close reads clearly.',
    );
    const long = notesPreview('x'.repeat(300), 20);
    expect(long).toHaveLength(20);
    expect(long.endsWith('…')).toBe(true);
  });

  it('says how long a batch took and how long is left', () => {
    expect(formatElapsed(0)).toBe('0 s');
    expect(formatElapsed(45_400)).toBe('45 s');
    expect(formatElapsed(372_000)).toBe('6 min 12 s');
    expect(formatElapsed(180_000)).toBe('3 min');
    expect(formatElapsed(3_780_000)).toBe('1 h 3 min');
    expect(formatElapsed(7_200_000)).toBe('2 h');
    expect(formatRemaining(20_000)).toBe('less than a minute left');
    expect(formatRemaining(170_000)).toBe('about 3 min left');
    expect(formatRemaining(3_900_000)).toBe('about 1 h 5 min left');
    expect(formatRemaining(7_200_000)).toBe('about 2 h left');
  });
});
