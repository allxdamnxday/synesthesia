import { describe, expect, it } from 'vitest';
import type { DrawResult } from '../../src/chance/draw';
import { defaultTimeline, type Composition } from '../../src/engine/composition';
import { createComposition } from '../../src/engine/compositionFactory';
import { sharedProperty } from '../../src/materials/properties';
import { WATER_SOUND_META } from '../../src/materials/sound/water/meta';
import type { MaterialMeta } from '../../src/materials/types';
import { SIGNATURE_VIEW_META } from '../../src/materials/visual/signature-view';
import { WATER_META } from '../../src/materials/visual/water/WaterMaterial';
import {
  applyChanceDraw,
  compositionsDiffer,
  defsOf,
  editLinked,
  editProperty,
  editSeed,
  editTimeline,
  enforceLocks,
  isLocked,
  isSoloed,
  lockedIds,
  switchMaterial,
  toggleMute,
  toggleSolo,
  unlockProperty,
  wakeOf,
  withInstalledVersions,
  withWake,
  type MaterialCatalog,
  type WakeState,
} from '../../src/studio/edits';

/** A second visual material that uses Elasticity (baseline 0.3) and has its own property. */
const HONEY: MaterialMeta = {
  id: 'honey',
  version: 2,
  name: 'Honey',
  description: 'Thick and slow.',
  properties: [
    sharedProperty('viscosity', 'visual', { default: 0.8 }),
    sharedProperty('elasticity', 'visual', { default: 0.3 }),
    sharedProperty('persistence', 'visual'),
    sharedProperty('brightness', 'visual'),
    {
      id: 'glow',
      label: 'Glow',
      description: '',
      kind: 'continuous',
      shared: false,
      default: 0.4,
      primary: false,
    },
  ],
};

const VISUAL: Record<string, MaterialMeta> = {
  water: WATER_META,
  signature: SIGNATURE_VIEW_META,
  honey: HONEY,
};
const SOUND: Record<string, MaterialMeta> = { water: WATER_SOUND_META };
const catalog: MaterialCatalog = {
  visual: (id) => VISUAL[id],
  sound: (id) => SOUND[id],
};

function composition(): Composition {
  return createComposition({
    id: 'c1',
    now: '2026-09-28T12:00:00.000Z',
    name: 'Test',
    signature: { id: 's1', contentHash: 'a'.repeat(64), name: 'Wink', preferredSpeed: 1 },
    seed: 4217,
    visual: WATER_META,
    sound: WATER_SOUND_META,
    render: { width: 1920, height: 1080, fps: 30 },
  });
}

const wake = (): WakeState => wakeOf(composition());

describe('property edits', () => {
  it('linked shared properties move both fields; specific ones only their own', () => {
    const s = wake();
    const defs = defsOf(s, catalog);
    const a = editProperty(s, 'visual', 'viscosity', 0.9, defs);
    expect(a.visual.properties.viscosity).toBe(0.9);
    expect(a.sound.properties.viscosity).toBe(0.9);
    const b = editProperty(a, 'sound', 'register', 2, defs);
    expect(b.sound.properties.register).toBe(2);
    expect(b.visual.properties.register).toBeUndefined();
  });

  it('unlinked shared properties move one field', () => {
    const s = editLinked(wake(), false, defsOf(wake(), catalog));
    const a = editProperty(s, 'visual', 'brightness', 0.1, defsOf(s, catalog));
    expect(a.visual.properties.brightness).toBe(0.1);
    expect(a.sound.properties.brightness).toBe(0.5);
  });

  it('returns the same state when nothing changes, and clamps values', () => {
    const s = wake();
    const defs = defsOf(s, catalog);
    expect(editProperty(s, 'visual', 'viscosity', 0.5, defs)).toBe(s);
    expect(editProperty(s, 'visual', 'viscosity', 7, defs).visual.properties.viscosity).toBe(1);
    expect(editProperty(s, 'visual', 'palette', 9, defs).visual.properties.palette).toBe(2);
  });

  it('linking again gives each shared property one value, the visual one first', () => {
    const s0 = wake();
    const defs = defsOf(s0, catalog);
    let s = editLinked(s0, false, defs);
    s = editProperty(s, 'visual', 'dispersion', 0.2, defs);
    s = editProperty(s, 'sound', 'dispersion', 0.8, defs);
    s = editProperty(s, 'sound', 'elasticity', 0.7, defs);
    s = editLinked(s, true, defs);
    expect(s.visual.properties.dispersion).toBe(0.2);
    expect(s.sound.properties.dispersion).toBe(0.2);
    // Only the sound uses elasticity: its value holds for both.
    expect(s.sound.properties.elasticity).toBe(0.7);
    expect(s.visual.properties.elasticity).toBe(0.7);
  });
});

describe('material switch', () => {
  it('carries shared values over and starts specific ones at baseline', () => {
    const s0 = wake();
    let s = editProperty(s0, 'visual', 'viscosity', 0.1, defsOf(s0, catalog));
    s = editProperty(s, 'visual', 'palette', 2, defsOf(s, catalog));
    s = switchMaterial(s, 'visual', HONEY, catalog);
    expect(s.visual.materialId).toBe('honey');
    expect(s.visual.materialVersion).toBe(2);
    expect(s.visual.properties.viscosity).toBe(0.1);
    expect(s.visual.properties.glow).toBe(0.4);
    expect(s.visual.properties.palette).toBeUndefined();
  });

  it('in Linked mode takes a shared value from the other field when this one never had it', () => {
    const s0 = wake();
    const s = editProperty(s0, 'sound', 'elasticity', 0.9, defsOf(s0, catalog));
    const honey = switchMaterial(s, 'visual', HONEY, catalog);
    expect(honey.visual.properties.elasticity).toBe(0.9);
    expect(honey.sound.properties.elasticity).toBe(0.9);
  });

  it('switching away and back keeps shared values the other material does not use', () => {
    const s0 = wake();
    let s = editProperty(s0, 'visual', 'density', 0.95, defsOf(s0, catalog));
    s = editLinked(s, false, defsOf(s, catalog));
    s = switchMaterial(s, 'visual', SIGNATURE_VIEW_META, catalog);
    s = switchMaterial(s, 'visual', WATER_META, catalog);
    expect(s.visual.properties.density).toBe(0.95);
  });

  it('is a no-op for the same material', () => {
    const s = wake();
    expect(switchMaterial(s, 'visual', WATER_META, catalog)).toBe(s);
  });
});

describe('movement, seed and mute', () => {
  it('clamps the global controls and keeps loops whole', () => {
    const s = wake();
    const t = editTimeline(s, { speed: 5, loops: 2.6, tailSec: -1, signatureStrength: 3.5 });
    expect(t.timeline).toMatchObject({ speed: 2, loops: 3, tailSec: 0, signatureStrength: 3 });
    expect(editTimeline(s, { loops: 1 })).toBe(s);
    expect(editTimeline(s, { loopMode: 'pingpong' }).timeline.loopMode).toBe('pingpong');
    expect(s.timeline).toEqual(defaultTimeline(1));
  });

  it('keeps seeds as whole numbers 0–999999', () => {
    const s = wake();
    expect(editSeed(s, 1234567).seed).toBe(999999);
    expect(editSeed(s, -3).seed).toBe(0);
    expect(editSeed(s, 12.9).seed).toBe(12);
    expect(editSeed(s, 4217)).toBe(s);
  });

  it('solo mutes the other field; soloing again brings both back', () => {
    const s = wake();
    const solo = toggleSolo(s, 'visual');
    expect(solo.mute).toEqual({ visual: false, sound: true });
    expect(isSoloed(solo.mute, 'visual')).toBe(true);
    expect(toggleSolo(solo, 'visual').mute).toEqual({ visual: false, sound: false });
    expect(toggleSolo(solo, 'sound').mute).toEqual({ visual: true, sound: false });
    expect(toggleMute(s, 'sound').mute).toEqual({ visual: false, sound: true });
  });
});

describe('draw by chance', () => {
  const draw: DrawResult = {
    visualId: 'honey',
    soundId: 'water',
    openProperties: ['viscosity', 'persistence'],
    values: null,
  };

  it('sets the materials, locks every other shared property at baseline, and records it', () => {
    const s0 = wake();
    let s = editProperty(s0, 'visual', 'brightness', 0.9, defsOf(s0, catalog));
    s = editProperty(s, 'visual', 'viscosity', 0.1, defsOf(s, catalog));
    s = applyChanceDraw(s, draw, catalog);
    expect(s.visual.materialId).toBe('honey');
    expect(s.chance).toEqual({ openProperties: ['viscosity', 'persistence'], overrides: [] });
    // Open: kept. Locked: each material's own baseline.
    expect(s.visual.properties.viscosity).toBe(0.1);
    expect(s.visual.properties.brightness).toBe(0.5);
    expect(s.visual.properties.elasticity).toBe(0.3);
    expect(s.sound.properties.brightness).toBe(0.5);
    expect(s.sound.properties.rigidity).toBe(0);
    expect(isLocked(s.chance, 'brightness')).toBe(true);
    expect(isLocked(s.chance, 'viscosity')).toBe(false);
    // Material-specific properties are never locked.
    expect(isLocked(s.chance, 'glow')).toBe(false);
    expect([...lockedIds(s.chance)]).not.toContain('persistence');
  });

  it('also chooses values when asked, in both fields', () => {
    const s = applyChanceDraw(
      wake(),
      { ...draw, values: { viscosity: 0.12, persistence: 0.87 } },
      catalog,
    );
    expect(s.visual.properties.viscosity).toBe(0.12);
    expect(s.sound.properties.persistence).toBe(0.87);
  });

  it('locked properties ignore edits until unlocked, and unlocking is recorded', () => {
    const s = applyChanceDraw(wake(), draw, catalog);
    const defs = defsOf(s, catalog);
    expect(editProperty(s, 'visual', 'brightness', 0.9, defs)).toBe(s);
    const unlocked = unlockProperty(s, 'brightness');
    expect(unlocked.chance?.overrides).toEqual(['brightness']);
    expect(unlockProperty(unlocked, 'brightness')).toBe(unlocked);
    expect(unlockProperty(unlocked, 'viscosity')).toBe(unlocked);
    const moved = editProperty(unlocked, 'visual', 'brightness', 0.9, defs);
    expect(moved.visual.properties.brightness).toBe(0.9);
  });

  it('keeps album bookkeeping on the record', () => {
    const s: WakeState = {
      ...wake(),
      chance: {
        albumId: 'a1',
        index: 3,
        masterSeed: 77,
        openProperties: ['range'],
        overrides: ['density'],
      },
    };
    const next = applyChanceDraw(s, draw, catalog);
    expect(next.chance).toEqual({
      albumId: 'a1',
      index: 3,
      masterSeed: 77,
      openProperties: ['viscosity', 'persistence'],
      overrides: [],
    });
  });

  it('a later material switch puts locked properties at the new baseline', () => {
    let s = applyChanceDraw(wake(), draw, catalog);
    s = switchMaterial(s, 'visual', WATER_META, catalog);
    expect(s.visual.properties.brightness).toBe(0.5);
    expect(enforceLocks(s, defsOf(s, catalog))).toBe(s);
  });
});

describe('compositions', () => {
  it('replaces the wake and compares only what a person edits', () => {
    const c = composition();
    const s = editSeed(wakeOf(c), 99);
    const next = withWake(c, s);
    expect(next.seed).toBe(99);
    expect(next.name).toBe('Test');
    expect(compositionsDiffer(c, next)).toBe(true);
    expect(compositionsDiffer(c, { ...c, updatedAt: 'later', thumbnail: 'data:x' })).toBe(false);
    expect(compositionsDiffer(c, { ...c, notes: 'hello' })).toBe(true);
    // Key order doesn't matter.
    const reordered = JSON.parse(JSON.stringify({ ...c, name: c.name })) as Composition;
    expect(compositionsDiffer(c, reordered)).toBe(false);
  });

  it('records the installed material versions', () => {
    const c = { ...composition(), visual: { ...composition().visual, materialVersion: 0 } };
    expect(withInstalledVersions(c, catalog).visual.materialVersion).toBe(WATER_META.version);
  });
});
