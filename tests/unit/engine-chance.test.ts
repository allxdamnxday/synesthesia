import { describe, expect, it } from 'vitest';
import { planAlbum, trackSeed, type AlbumSettings } from '../../src/chance/album';
import { formatAlbumLog, type Album } from '../../src/chance/albumModel';
import { drawByChance } from '../../src/chance/draw';
import { defaultTimeline, type Composition } from '../../src/engine/composition';
import { UndoHistory } from '../../src/engine/history';
import {
  setLinked,
  type PropertyState,
  setProperty,
  sharedIdsInUse,
  valuesAfterMaterialSwitch,
} from '../../src/engine/propertyModel';
import { applySnapshot, snapshotChanges, takeSnapshot } from '../../src/engine/snapshots';
import { stepsForTime, VisualRunner } from '../../src/engine/visualRunner';
import { sharedProperty } from '../../src/materials/properties';
import type { PropertyDef, VisualMaterial } from '../../src/materials/types';
import { createSyntheticSampler } from '../../src/signature/synthetic';

const VISUAL = ['water', 'honey', 'smoke', 'bubbles', 'filaments'].map((id) => ({
  id,
  sharedIds: ['viscosity', 'persistence', 'dispersion', 'brightness', 'intensity', 'density'],
}));
const SOUND = ['water', 'honey', 'breath', 'resonance', 'pulse'].map((id) => ({
  id,
  sharedIds: ['viscosity', 'elasticity', 'persistence', 'brightness', 'intensity', 'range'],
}));

describe('fixed-step visual runner', () => {
  it('takes exactly 2 steps per frame at 30 fps and 1 at 60 fps', () => {
    for (let i = 0; i < 300; i++) {
      expect(stepsForTime(i / 30)).toBe(2 * i);
      expect(stepsForTime(i / 60)).toBe(i);
    }
  });

  it('drives the material with frames sampled at k·dt and resets on seek', () => {
    const times: number[] = [];
    let resets = 0;
    const material = {
      reset: () => resets++,
      step: (frame: { t: number }) => times.push(frame.t),
      draw: () => undefined,
    } as unknown as VisualMaterial;
    const runner = new VisualRunner(material, createSyntheticSampler('wink'), 7);
    runner.reset();
    expect(runner.advanceTo(0.1, {})).toBe(6);
    expect(times[1]).toBeCloseTo(1 / 60);
    expect(runner.advanceTo(0.1, {})).toBe(0);
    expect(runner.advanceTo(1, {}, 10)).toBe(10);
    expect(runner.seek(0.5)).toBe(30);
    expect(resets).toBe(2);
    expect(runner.simTime).toBe(0);
  });
});

describe('property model', () => {
  const visualDefs: PropertyDef[] = [
    sharedProperty('viscosity', 'visual'),
    sharedProperty('persistence', 'visual'),
    { ...sharedProperty('density', 'visual'), default: 0.7 },
    {
      id: 'palette',
      label: 'Palette',
      description: '',
      kind: 'choice',
      shared: false,
      default: 0,
      choices: ['a', 'b'],
      primary: true,
    },
  ];
  const soundDefs: PropertyDef[] = [
    sharedProperty('viscosity', 'sound'),
    sharedProperty('elasticity', 'sound'),
  ];

  it('linked shared properties move both fields; specific ones never link', () => {
    let s: PropertyState = { linked: true, visual: {}, sound: {} };
    s = setProperty(s, 'visual', 'viscosity', 0.9);
    expect(s.visual.viscosity).toBe(0.9);
    expect(s.sound.viscosity).toBe(0.9);
    s = setProperty(s, 'visual', 'palette', 1);
    expect(s.sound.palette).toBeUndefined();
  });

  it('unlinked edits one field; relinking takes the visual value', () => {
    let s: PropertyState = { linked: false, visual: { viscosity: 0.2 }, sound: { viscosity: 0.8 } };
    s = setProperty(s, 'sound', 'viscosity', 0.6);
    expect(s.visual.viscosity).toBe(0.2);
    s = setLinked(s, true, visualDefs, soundDefs);
    expect(s.sound.viscosity).toBe(0.2);
  });

  it('switching material carries shared values and resets specific ones', () => {
    const next = valuesAfterMaterialSwitch({ viscosity: 0.33, palette: 1 }, visualDefs);
    expect(next.viscosity).toBe(0.33);
    expect(next.palette).toBe(0);
    expect(next.density).toBe(0.7);
    expect(sharedIdsInUse(visualDefs, soundDefs)).toEqual([
      'viscosity',
      'elasticity',
      'persistence',
      'density',
    ]);
  });
});

describe('undo history', () => {
  it('coalesces a gesture into one step and supports redo', () => {
    const h = new UndoHistory(0);
    h.push(1, 'drag');
    h.push(2, 'drag');
    h.push(3, 'drag');
    h.endGesture();
    h.push(10);
    expect(h.undo()).toBe(3);
    expect(h.undo()).toBe(0);
    expect(h.canUndo).toBe(false);
    expect(h.redo()).toBe(3);
    h.push(4);
    expect(h.canRedo).toBe(false);
  });
});

function composition(overrides: Partial<Composition> = {}): Composition {
  return {
    format: 'sp-composition',
    version: 1,
    id: 'c1',
    name: 'Track',
    createdAt: '2026-09-28T00:00:00Z',
    updatedAt: '2026-09-28T00:00:00Z',
    signature: { id: 's', contentHash: 'h', name: 'Wink' },
    seed: 1,
    timeline: defaultTimeline(1),
    linked: true,
    visual: { materialId: 'water', materialVersion: 1, properties: { viscosity: 0.5 } },
    sound: { materialId: 'water', materialVersion: 1, properties: { viscosity: 0.5 } },
    mute: { visual: false, sound: false },
    chance: null,
    render: { width: 1920, height: 1080, fps: 30 },
    status: 'draft',
    notes: '',
    ...overrides,
  };
}

describe('snapshots', () => {
  it('stores and restores state without sharing references', () => {
    const c = composition();
    const snap = takeSnapshot(c);
    c.visual.properties.viscosity = 0.9;
    const restored = applySnapshot(c, snap);
    expect(restored.visual.properties.viscosity).toBe(0.5);
    const other = { ...snap, sound: { ...snap.sound, materialId: 'honey' } };
    expect(snapshotChanges(snap, other).soundMaterial).toBe(true);
    expect(snapshotChanges(snap, other).visualMaterial).toBe(false);
  });
});

describe('draw by chance', () => {
  it('is deterministic per seed and opens K properties the materials use', () => {
    const opts = {
      seed: 424242,
      visualPool: VISUAL,
      soundPool: SOUND,
      openCount: 2,
      chooseValues: true,
    };
    const a = drawByChance(opts);
    expect(drawByChance(opts)).toEqual(a);
    expect(a.openProperties).toHaveLength(2);
    for (const id of a.openProperties) {
      expect([...VISUAL[0].sharedIds, ...SOUND[0].sharedIds]).toContain(id);
    }
    expect(Object.keys(a.values ?? {})).toEqual(a.openProperties);
    expect(drawByChance({ ...opts, seed: 1 })).not.toEqual(a);
  });
});

describe('album planning', () => {
  const settings: AlbumSettings = {
    title: 'Wink album',
    trackCount: 25,
    masterSeed: 314159,
    visualPool: VISUAL.map((m) => m.id),
    soundPool: SOUND.map((m) => m.id),
    openCount: 2,
    strategy: 'grid',
    chooseValues: false,
  };

  it('grid covers every pair exactly once for 5 × 5 = 25 tracks', () => {
    const plan = planAlbum(settings, { visual: VISUAL, sound: SOUND });
    expect(plan.tracks).toHaveLength(25);
    const pairs = new Set(plan.tracks.map((t) => `${t.visualId}/${t.soundId}`));
    expect(pairs.size).toBe(25);
    expect(plan.note).toBeNull();
    expect(plan.tracks[0].name).toBe('01');
  });

  it('same master seed → identical drafts; seeds follow hash32(masterSeed, index)', () => {
    const a = planAlbum(settings, { visual: VISUAL, sound: SOUND });
    const b = planAlbum(settings, { visual: VISUAL, sound: SOUND });
    expect(a).toEqual(b);
    expect(a.tracks[4].seed).toBe(trackSeed(314159, 5));
    const c = planAlbum({ ...settings, masterSeed: 1 }, { visual: VISUAL, sound: SOUND });
    expect(c.tracks.map((t) => t.visualId + t.soundId)).not.toEqual(
      a.tracks.map((t) => t.visualId + t.soundId),
    );
  });

  it('grid fills or truncates deterministically and says so', () => {
    const more = planAlbum({ ...settings, trackCount: 30 }, { visual: VISUAL, sound: SOUND });
    expect(more.tracks).toHaveLength(30);
    expect(new Set(more.tracks.slice(0, 25).map((t) => t.visualId + t.soundId)).size).toBe(25);
    expect(more.note).toMatch(/repeat/);
    const fewer = planAlbum({ ...settings, trackCount: 10 }, { visual: VISUAL, sound: SOUND });
    expect(fewer.tracks).toHaveLength(10);
    expect(fewer.note).toMatch(/first 10/);
  });

  it('pure chance draws each track independently', () => {
    const plan = planAlbum(
      { ...settings, strategy: 'chance', trackCount: 12 },
      { visual: VISUAL, sound: SOUND },
    );
    expect(plan.tracks).toHaveLength(12);
    expect(plan.tracks.every((t) => t.openProperties.length === 2)).toBe(true);
  });
});

describe('album log', () => {
  it('lists every track, including set-aside ones, with the SPEC fields', () => {
    const album: Album = {
      format: 'sp-album',
      version: 1,
      id: 'a1',
      title: 'Wink album',
      createdAt: '2026-09-28T10:00:00Z',
      updatedAt: '2026-09-28T10:00:00Z',
      signature: { id: 's', contentHash: 'abc123', name: 'Wink' },
      settings: {
        title: 'Wink album',
        trackCount: 2,
        masterSeed: 42,
        visualPool: ['water'],
        soundPool: ['water'],
        openCount: 2,
        strategy: 'chance',
        chooseValues: false,
      },
      note: null,
      compositionIds: ['c1', 'c2'],
      renders: { c1: 'SP_Wink_01_000123.mp4' },
    };
    const log = formatAlbumLog({
      album,
      compositions: [
        composition({ id: 'c1', name: '01', status: 'kept', notes: 'The close reads clearly.' }),
        composition({
          id: 'c2',
          name: '02',
          status: 'set-aside',
          chance: { openProperties: ['viscosity'], overrides: ['brightness'] },
        }),
      ],
      materialName: (_kind, id) => (id === 'water' ? 'Water' : id),
      generatedAt: '2026-09-28T12:00:00Z',
    });
    expect(log).toContain('# Wink album');
    expect(log).toContain('abc123');
    expect(log).toContain('000042');
    expect(log).toContain('Set aside');
    expect(log).toContain('SP_Wink_01_000123.mp4');
    expect(log).toContain('The close reads clearly.');
    expect(log).toContain('| Overrides | brightness |');
  });
});
