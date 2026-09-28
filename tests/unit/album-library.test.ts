import { describe, expect, it } from 'vitest';
import { trackSeed, type AlbumSettings } from '../../src/chance/album';
import type { Composition } from '../../src/engine/composition';
import { validateComposition } from '../../src/engine/compositionSerialize';
import {
  ALBUM_MESSAGES,
  albumFileName,
  albumFromBackupEntry,
  albumLogText,
  buildAlbumDrafts,
  countTracks,
  defaultPools,
  installedMaterials,
  materialChoiceInfo,
  materialName,
  normalizeAlbumSettings,
  pairingCount,
  parseAlbum,
  propertyLabel,
  readStoredAlbum,
  serializeAlbum,
  serializeStoredAlbum,
  summarizeAlbum,
  validateAlbum,
  withTrackNotes,
  withTrackStatus,
  type AlbumDraftInput,
  type AlbumMaterials,
} from '../../src/library/albums';
import { LibraryError } from '../../src/library/errors';
import { SHARED_PROPERTY_IDS, sharedProperty } from '../../src/materials/properties';
import type { MaterialMeta, PropertyDef } from '../../src/materials/types';
import { FileFormatError } from '../../src/signature/serialize';

// Five visual and five sound materials with different shared properties and baselines,
// so locks, values and pairings can be checked without the real (still growing) registry.
function meta(id: string, properties: PropertyDef[]): MaterialMeta {
  return { id, version: 1, name: id[0].toUpperCase() + id.slice(1), description: '', properties };
}
const palette: PropertyDef = {
  id: 'palette',
  label: 'Palette',
  description: '',
  kind: 'choice',
  shared: false,
  default: 1,
  choices: ['a', 'b', 'c'],
  primary: false,
};
const VISUAL: MaterialMeta[] = [
  meta('water', [
    sharedProperty('viscosity', 'visual', { default: 0.2 }),
    sharedProperty('persistence', 'visual'),
    sharedProperty('brightness', 'visual'),
    palette,
  ]),
  meta('honey', [
    sharedProperty('viscosity', 'visual', { default: 0.9 }),
    sharedProperty('elasticity', 'visual'),
    sharedProperty('density', 'visual', { default: 0.7 }),
  ]),
  meta('smoke', [sharedProperty('dispersion', 'visual'), sharedProperty('intensity', 'visual')]),
  meta('bubbles', [sharedProperty('range', 'visual'), sharedProperty('rigidity', 'visual')]),
  meta('filaments', [sharedProperty('rigidity', 'visual'), sharedProperty('elasticity', 'visual')]),
  meta('signature', [{ ...palette, id: 'showReadout', default: 0 }]),
];
const SOUND: MaterialMeta[] = [
  meta('water', [sharedProperty('viscosity', 'sound'), sharedProperty('range', 'sound')]),
  meta('honey', [sharedProperty('viscosity', 'sound', { default: 0.8 })]),
  meta('breath', [sharedProperty('dispersion', 'sound'), sharedProperty('brightness', 'sound')]),
  meta('resonance', [sharedProperty('rigidity', 'sound', { default: 0.3 })]),
  meta('pulse', [sharedProperty('density', 'sound'), sharedProperty('persistence', 'sound')]),
];
const MATERIALS: AlbumMaterials = { visual: VISUAL, sound: SOUND };

const SETTINGS: AlbumSettings = {
  title: '  Wink   album ',
  trackCount: 25,
  masterSeed: 314159,
  ...defaultPools(MATERIALS),
  openCount: 2,
  strategy: 'grid',
  chooseValues: false,
};

const HASH = 'a'.repeat(64);

function input(overrides: Partial<AlbumDraftInput> = {}): AlbumDraftInput {
  let n = 0;
  return {
    albumId: 'album-1',
    newId: () => `c${++n}`,
    now: '2026-09-28T12:00:00.000Z',
    signature: { id: 'sig-1', contentHash: HASH, name: 'Wink', preferredSpeed: 0.75 },
    settings: SETTINGS,
    materials: MATERIALS,
    render: { width: 1280, height: 720, fps: 30 },
    ...overrides,
  };
}

/** What shapes each draft's wake, without ids, names of records, or dates. */
function shape(compositions: readonly Composition[]) {
  return compositions.map((c) => ({
    name: c.name,
    seed: c.seed,
    visual: c.visual,
    sound: c.sound,
    timeline: c.timeline,
    open: c.chance?.openProperties,
    index: c.chance?.index,
    masterSeed: c.chance?.masterSeed,
  }));
}

function metaOf(kind: 'visual' | 'sound', id: string): MaterialMeta {
  const found = (kind === 'visual' ? VISUAL : SOUND).find((m) => m.id === id);
  if (!found) throw new Error(`no ${kind} ${id}`);
  return found;
}

describe('album drafts', () => {
  it('makes one draft per track with its seed, chance record and album order', () => {
    const { album, compositions } = buildAlbumDrafts(input());
    expect(compositions).toHaveLength(25);
    compositions.forEach((c, i) => {
      const index = i + 1;
      expect(c.name).toBe(String(index).padStart(2, '0'));
      expect(c.seed).toBe(trackSeed(314159, index));
      expect(c.status).toBe('draft');
      expect(c.notes).toBe('');
      expect(c.linked).toBe(true);
      expect(c.timeline.speed).toBe(0.75);
      expect(c.render).toEqual({ width: 1280, height: 720, fps: 30 });
      expect(c.signature).toEqual({ id: 'sig-1', contentHash: HASH, name: 'Wink' });
      expect(c.chance).toEqual({
        albumId: 'album-1',
        index,
        masterSeed: 314159,
        openProperties: c.chance?.openProperties,
        overrides: [],
      });
      expect(c.chance?.openProperties).toHaveLength(2);
      expect(() => validateComposition(JSON.parse(JSON.stringify(c)))).not.toThrow();
    });
    expect(album.compositionIds).toEqual(compositions.map((c) => c.id));
    expect(album.title).toBe('Wink album');
    expect(album.settings.title).toBe('Wink album');
    expect(album.signature).toEqual({ id: 'sig-1', contentHash: HASH, name: 'Wink' });
    expect(album.renders).toEqual({});
    expect(album.note).toBeNull();
    expect(validateAlbum(JSON.parse(JSON.stringify(album)))).toEqual(album);
  });

  it('keeps every property at its baseline, locked by chance, unless chance opens it', () => {
    const { compositions } = buildAlbumDrafts(input());
    for (const c of compositions) {
      const visual = metaOf('visual', c.visual.materialId);
      const sound = metaOf('sound', c.sound.materialId);
      for (const def of visual.properties) expect(c.visual.properties[def.id]).toBe(def.default);
      for (const def of sound.properties) expect(c.sound.properties[def.id]).toBe(def.default);
      // Open properties come from what these two materials use.
      const used = new Set([
        ...materialChoiceInfo(visual).sharedIds,
        ...materialChoiceInfo(sound).sharedIds,
      ]);
      for (const id of c.chance?.openProperties ?? []) expect(used.has(id)).toBe(true);
    }
  });

  it('with "Also choose values", sets only the open properties, where each material has them', () => {
    const { compositions } = buildAlbumDrafts(
      input({ settings: { ...SETTINGS, chooseValues: true } }),
    );
    let changed = 0;
    for (const c of compositions) {
      const open = new Set(c.chance?.openProperties);
      for (const [field, kind] of [
        [c.visual, 'visual'],
        [c.sound, 'sound'],
      ] as const) {
        for (const def of metaOf(kind, field.materialId).properties) {
          const value = field.properties[def.id];
          if (!open.has(def.id)) expect(value).toBe(def.default);
          else {
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThanOrEqual(1);
            if (value !== def.default) changed++;
          }
        }
        // No property appears that the material doesn't have.
        expect(Object.keys(field.properties).sort()).toEqual(
          metaOf(kind, field.materialId)
            .properties.map((p) => p.id)
            .sort(),
        );
      }
      // Linked: an open property both materials use starts at the same value in both.
      for (const id of open) {
        if (id in c.visual.properties && id in c.sound.properties) {
          expect(c.visual.properties[id]).toBe(c.sound.properties[id]);
        }
      }
    }
    expect(changed).toBeGreaterThan(10);
  });

  it('gives identical drafts for the same master seed and settings, whatever the ids and dates', () => {
    const a = buildAlbumDrafts(input());
    const b = buildAlbumDrafts(
      input({ albumId: 'other', newId: () => crypto.randomUUID(), now: '2027-01-01T00:00:00Z' }),
    );
    expect(shape(b.compositions)).toEqual(shape(a.compositions));
    expect(b.album.settings).toEqual(a.album.settings);
    const other = buildAlbumDrafts(input({ settings: { ...SETTINGS, masterSeed: 314160 } }));
    expect(shape(other.compositions)).not.toEqual(shape(a.compositions));
  });

  it('pins the first tracks for one master seed, so every machine and version agrees', () => {
    const { compositions } = buildAlbumDrafts(input());
    const firstThree = compositions.slice(0, 3).map((c) => ({
      pair: `${c.visual.materialId}/${c.sound.materialId}`,
      seed: c.seed,
      open: c.chance?.openProperties,
    }));
    expect(firstThree).toEqual(GOLDEN_FIRST_TRACKS);
  });

  it('grid pairing uses every eligible pair exactly once, and pure chance draws freely', () => {
    const grid = buildAlbumDrafts(input());
    const pairs = grid.compositions.map((c) => `${c.visual.materialId}/${c.sound.materialId}`);
    expect(new Set(pairs).size).toBe(25);
    expect(pairs.some((p) => p.startsWith('signature/'))).toBe(false);

    const chance = buildAlbumDrafts(
      input({ settings: { ...SETTINGS, strategy: 'chance', trackCount: 40 } }),
    );
    expect(chance.compositions).toHaveLength(40);
    expect(chance.album.note).toBeNull();
    const chancePairs = chance.compositions.map(
      (c) => `${c.visual.materialId}/${c.sound.materialId}`,
    );
    expect(new Set(chancePairs).size).toBeLessThan(40);
  });

  it('says so when the grid is filled or truncated', () => {
    const more = buildAlbumDrafts(input({ settings: { ...SETTINGS, trackCount: 30 } }));
    expect(more.album.note).toMatch(/repeat/);
    const fewer = buildAlbumDrafts(input({ settings: { ...SETTINGS, trackCount: 7 } }));
    expect(fewer.album.note).toMatch(/first 7/);
    expect(fewer.compositions.map((c) => c.name)).toEqual([
      '01',
      '02',
      '03',
      '04',
      '05',
      '06',
      '07',
    ]);
  });

  it('refuses plainly when no visual or no sound material is eligible', () => {
    const noSound = () => buildAlbumDrafts(input({ settings: { ...SETTINGS, soundPool: [] } }));
    expect(noSound).toThrow(LibraryError);
    expect(noSound).toThrow(ALBUM_MESSAGES.noMaterials);
    expect(() =>
      buildAlbumDrafts(input({ settings: { ...SETTINGS, visualPool: ['not-installed'] } })),
    ).toThrow(ALBUM_MESSAGES.noMaterials);
  });

  it('normalizes settings: clamps numbers, cleans the title, keeps installed materials in order', () => {
    const s = normalizeAlbumSettings(
      {
        ...SETTINGS,
        title: '   ',
        trackCount: 99,
        masterSeed: 1234567.8,
        visualPool: ['smoke', 'nope', 'water', 'water'],
        soundPool: ['pulse'],
        openCount: 7,
      },
      MATERIALS,
    );
    expect(s).toEqual({
      title: 'Untitled album',
      trackCount: 40,
      masterSeed: 999999,
      visualPool: ['water', 'smoke'],
      soundPool: ['pulse'],
      openCount: 3,
      strategy: 'grid',
      chooseValues: false,
    });
    expect(
      normalizeAlbumSettings({ ...SETTINGS, trackCount: 0, openCount: 0 }, MATERIALS),
    ).toMatchObject({ trackCount: 1, openCount: 1 });
    expect(pairingCount(s)).toBe(2);
  });

  it('leaves the Signature view out of the default pools', () => {
    expect(defaultPools(MATERIALS)).toEqual({
      visualPool: ['water', 'honey', 'smoke', 'bubbles', 'filaments'],
      soundPool: ['water', 'honey', 'breath', 'resonance', 'pulse'],
    });
    expect(defaultPools(installedMaterials()).visualPool).not.toContain('signature');
    expect(materialChoiceInfo(VISUAL[0])).toEqual({
      id: 'water',
      sharedIds: ['viscosity', 'persistence', 'brightness'],
    });
  });
});

/** Computed once from the seeded plan; a change here changes every existing album. */
const GOLDEN_FIRST_TRACKS = [
  { pair: 'filaments/breath', seed: 968516, open: ['brightness', 'rigidity'] },
  { pair: 'honey/resonance', seed: 589372, open: ['viscosity', 'elasticity'] },
  { pair: 'water/breath', seed: 796586, open: ['dispersion', 'brightness'] },
];

describe('album file', () => {
  const { album } = buildAlbumDrafts(input());

  it('round-trips through .spalbum.json with keys in format order', () => {
    const withRender = { ...album, renders: { [album.compositionIds[0]]: 'SP_Wink_01_1.mp4' } };
    const text = serializeAlbum(withRender);
    expect(parseAlbum(text)).toEqual(withRender);
    expect(Object.keys(JSON.parse(text) as object)).toEqual([
      'format',
      'version',
      'id',
      'title',
      'createdAt',
      'updatedAt',
      'signature',
      'settings',
      'note',
      'compositionIds',
      'renders',
    ]);
    expect(albumFileName(album)).toBe('Wink-album.spalbum.json');
  });

  it('drops unknown keys and refuses damaged, foreign or newer files plainly', () => {
    const raw = JSON.parse(serializeAlbum(album)) as Record<string, unknown>;
    expect(validateAlbum({ ...raw, extra: 1 })).toEqual(album);

    const damaged = (change: (o: Record<string, unknown>) => void) => {
      const copy = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
      change(copy);
      return () => parseAlbum(JSON.stringify(copy));
    };
    const settings = (o: Record<string, unknown>) => o.settings as Record<string, unknown>;
    for (const change of [
      (o: Record<string, unknown>) => delete o.title,
      (o: Record<string, unknown>) => ((o.signature as Record<string, unknown>).contentHash = 'x'),
      (o: Record<string, unknown>) => (settings(o).masterSeed = 1_000_000),
      (o: Record<string, unknown>) => (settings(o).trackCount = 0),
      (o: Record<string, unknown>) => (settings(o).openCount = 4),
      (o: Record<string, unknown>) => (settings(o).strategy = 'shuffle'),
      (o: Record<string, unknown>) => (o.compositionIds = ['a', 'a']),
      (o: Record<string, unknown>) => (o.renders = { a: 3 }),
      (o: Record<string, unknown>) => (o.note = 5),
    ]) {
      expect(damaged(change)).toThrow(ALBUM_MESSAGES.damaged);
    }
    const kind = (text: string) => {
      try {
        parseAlbum(text);
      } catch (err) {
        return err instanceof FileFormatError ? [err.code, err.message] : ['other', String(err)];
      }
      return ['ok', ''];
    };
    expect(kind(JSON.stringify({ ...raw, format: 'sp-composition' }))).toEqual([
      'wrong-kind',
      ALBUM_MESSAGES.notAlbum,
    ]);
    expect(kind(JSON.stringify({ ...raw, version: 2 }))).toEqual([
      'newer-version',
      ALBUM_MESSAGES.newer,
    ]);
    expect(kind('{ not json')[0]).toBe('not-json');
  });

  it('keeps placeholder records from before albums had a format, and validates the rest', () => {
    const placeholder = { id: 'album-1', format: 'sp-album', name: 'Winks', compositionIds: ['x'] };
    expect(albumFromBackupEntry(placeholder)).toEqual(placeholder);
    expect(readStoredAlbum(placeholder)).toBeUndefined();
    expect(serializeStoredAlbum(placeholder)).toBe(`${JSON.stringify(placeholder, null, 2)}\n`);
    expect(serializeStoredAlbum(album)).toBe(serializeAlbum(album));
    expect(albumFromBackupEntry(JSON.parse(serializeAlbum(album)))).toEqual(album);
    expect(() => albumFromBackupEntry({ ...album, title: 3 })).toThrow(ALBUM_MESSAGES.damaged);
    expect(() => albumFromBackupEntry({ name: 'no id' })).toThrow(ALBUM_MESSAGES.damaged);
    expect(() => albumFromBackupEntry([1, 2])).toThrow(ALBUM_MESSAGES.damaged);
  });
});

describe('working the album', () => {
  const { album, compositions } = buildAlbumDrafts(
    input({ settings: { ...SETTINGS, trackCount: 4 } }),
  );

  it('moves a track between draft, kept and set aside, keeping everything else', () => {
    const [first] = compositions;
    const kept = withTrackStatus(first, 'kept', '2026-09-28T13:00:00.000Z');
    expect(kept).toEqual({ ...first, status: 'kept', updatedAt: '2026-09-28T13:00:00.000Z' });
    const aside = withTrackStatus(kept, 'set-aside', '2026-09-28T13:01:00.000Z');
    expect(aside.status).toBe('set-aside');
    expect(withTrackStatus(aside, 'draft', '2026-09-28T13:02:00.000Z').status).toBe('draft');
    expect(() => withTrackStatus(first, 'deleted' as never, 'now')).toThrow(LibraryError);
    const noted = withTrackNotes(aside, 'The close reads; the open is lost.', 'later');
    expect(noted.notes).toBe('The close reads; the open is lost.');
    expect(noted.status).toBe('set-aside');
    expect(withTrackNotes(first, 'x'.repeat(300_000), 'later').notes).toHaveLength(200_000);
  });

  it('counts statuses (missing tracks too) and finds the latest change and a still', () => {
    const tracks: Array<Composition | undefined> = [
      withTrackStatus(compositions[0], 'kept', '2026-09-28T14:00:00.000Z'),
      { ...withTrackStatus(compositions[1], 'set-aside', '2026-09-28T15:00:00.000Z') },
      { ...compositions[2], thumbnail: 'data:image/png;base64,AAAA' },
      undefined,
    ];
    expect(countTracks(tracks)).toEqual({ draft: 1, kept: 1, setAside: 1, missing: 1 });
    const summary = summarizeAlbum(album, tracks);
    expect(summary.lastChanged).toBe('2026-09-28T15:00:00.000Z');
    expect(summary.thumbnail).toBe('data:image/png;base64,AAAA');
    const keptStill = { ...tracks[0], thumbnail: 'data:image/png;base64,BBBB' } as Composition;
    expect(summarizeAlbum(album, [tracks[2], keptStill]).thumbnail).toBe(
      'data:image/png;base64,BBBB',
    );
    expect(summarizeAlbum(album, []).thumbnail).toBeUndefined();
  });
});

describe('album log', () => {
  it('lists every track, set-aside and missing ones included, with names and the master seed', () => {
    // The real registry names materials and properties.
    const real = installedMaterials();
    const { album, compositions } = buildAlbumDrafts(
      input({
        materials: real,
        settings: { ...SETTINGS, ...defaultPools(real), trackCount: 3, masterSeed: 42 },
      }),
    );
    const tracks: Array<Composition | undefined> = [
      { ...withTrackStatus(compositions[0], 'kept', 'x'), notes: 'The close reads clearly.' },
      {
        ...withTrackStatus(compositions[1], 'set-aside', 'x'),
        notes: 'Too busy: the wink is lost.',
      },
      undefined,
    ];
    const rendered = { ...album, renders: { [compositions[0].id]: 'SP_Wink_01_000123.mp4' } };
    const log = albumLogText(rendered, tracks, '2026-09-28T16:00:00.000Z');
    expect(log).toContain('# Wink album');
    expect(log).toContain(`\`${HASH}\``);
    expect(log).toContain('- **Master seed:** 000042');
    expect(log).toContain('- **Pairing:** Grid');
    expect(log).toContain('Kept 1 · Set aside 1 · Draft 0.');
    expect(log).toContain('## 01. 01');
    expect(log).toContain('## 02. 02');
    expect(log).toContain('| Status | Set aside |');
    expect(log).toContain('Too busy: the wink is lost.');
    // Whatever materials the plan chose, the log names them with their display names.
    const first = compositions[0];
    expect(log).toContain(
      `| Visual material | ${materialName('visual', first.visual.materialId)} |`,
    );
    expect(log).toContain(`| Sound material | ${materialName('sound', first.sound.materialId)} |`);
    expect(log).toContain('SP_Wink_01_000123.mp4');
    expect(log).toContain('| Render | Not rendered |');
    expect(log).toContain(`## 03. (missing composition \`${compositions[2].id}\`)`);
    const open = tracks[0]?.chance?.openProperties.map(propertyLabel).join(', ');
    expect(log).toContain(`| Open properties | ${open} |`);
  });

  it('names materials and properties from the registry, falling back to ids', () => {
    expect(materialName('visual', 'water')).toBe('Water');
    expect(materialName('sound', 'water')).toBe('Water');
    expect(materialName('sound', 'theremin')).toBe('theremin');
    for (const id of SHARED_PROPERTY_IDS) expect(propertyLabel(id)).toMatch(/^[A-Z][a-z]+$/);
    expect(propertyLabel('surfaceLight')).toBe('Surface light');
    expect(propertyLabel('mystery')).toBe('mystery');
  });
});
