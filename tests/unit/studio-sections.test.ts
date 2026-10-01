import { describe, expect, it } from 'vitest';
import {
  countsTowardPrimaryCap,
  hueProperty,
  sharedProperty,
} from '../../src/materials/properties';
import { WATER_SOUND_META } from '../../src/materials/sound/water/meta';
import type { PropertyDef } from '../../src/materials/types';
import { SIGNATURE_VIEW_META } from '../../src/materials/visual/signature-view';
import { WATER_META } from '../../src/materials/visual/water/WaterMaterial';
import {
  capPrimary,
  linkedDef,
  linkedField,
  linkedValues,
  propertySections,
} from '../../src/studio/sections';

const defs = { visual: WATER_META.properties, sound: WATER_SOUND_META.properties };

describe('linked sections', () => {
  it('Linked: one Both group with each shared property once; materials keep their own', () => {
    const s = propertySections(defs, true);
    const ids = s.both?.map((d) => d.id);
    expect(ids).toEqual([
      'viscosity',
      'elasticity',
      'persistence',
      'dispersion',
      'brightness',
      'intensity',
      'rigidity',
      'density',
      'range',
    ]);
    expect(new Set(ids).size).toBe(ids?.length);
    expect(s.visual.map((d) => d.id)).toEqual(['palette', 'surfaceLight', 'hue']);
    // Hue is in view; Palette and Surface light stay under More.
    expect(s.visual.filter((d) => d.primary).map((d) => d.id)).toEqual(['hue']);
    expect(s.sound.map((d) => d.id)).toEqual(['register']);
  });

  it('Unlinked: each material shows all its own properties', () => {
    const s = propertySections(defs, false);
    expect(s.both).toBeNull();
    expect(s.visual.map((d) => d.id)).toEqual(WATER_META.properties.map((d) => d.id));
    // Six primaries, and Hue beside them.
    expect(s.visual.filter((d) => d.primary).map((d) => d.id)).toEqual([
      'viscosity',
      'persistence',
      'dispersion',
      'brightness',
      'intensity',
      'density',
      'hue',
    ]);
    expect(s.sound.map((d) => d.id)).toEqual(WATER_SOUND_META.properties.map((d) => d.id));
  });

  it('never shows more than six primary sliders in a group, and Hue beside them', () => {
    for (const linked of [true, false]) {
      const s = propertySections(defs, linked);
      for (const group of [s.both ?? [], s.visual, s.sound]) {
        expect(
          group.filter((d) => d.primary && countsTowardPrimaryCap(d)).length,
        ).toBeLessThanOrEqual(6);
      }
    }
    const seven: PropertyDef[] = [
      'viscosity',
      'elasticity',
      'persistence',
      'dispersion',
      'brightness',
      'intensity',
      'range',
    ].map((id) => ({ ...sharedProperty(id as 'range', 'visual'), primary: true }));
    const capped = capPrimary(seven);
    expect(capped.filter((d) => d.primary).map((d) => d.id)).toHaveLength(6);
    expect(capped[6]?.primary).toBe(false);
    // Hue stays in view wherever it comes in the list, and takes nobody's place.
    for (const withHue of [
      [hueProperty('Turns the colors.'), ...seven],
      [...seven, hueProperty('Turns the colors.')],
    ]) {
      const shown = capPrimary(withHue).filter((d) => d.primary);
      expect(shown.map((d) => d.id)).toHaveLength(7);
      expect(shown.map((d) => d.id)).toContain('hue');
      expect(shown.map((d) => d.id)).not.toContain('range');
    }
  });

  it('a shared property is primary in Both if either material shows it', () => {
    // Water (visual) promotes Density; A1 keeps it under More.
    expect(linkedDef('density', defs)?.primary).toBe(true);
    // Only the sound uses Elasticity.
    const elasticity = linkedDef('elasticity', defs);
    expect(elasticity?.description.startsWith('Sound:')).toBe(true);
    expect(linkedDef('viscosity', defs)?.description).toContain('Visual:');
    expect(linkedDef('viscosity', defs)?.description).toContain('Sound:');
    expect(linkedDef('nothing', defs)).toBeNull();
  });

  it('with the Signature view, Both holds only the sound material’s shared properties', () => {
    const s = propertySections(
      { visual: SIGNATURE_VIEW_META.properties, sound: WATER_SOUND_META.properties },
      true,
    );
    expect(s.visual.map((d) => d.id)).toEqual(['showReadout']);
    expect(s.both?.length).toBe(9);
  });

  it('Both shows the visual value where the visual uses it, else the sound value', () => {
    const both = propertySections(defs, true).both ?? [];
    const values = linkedValues(both, defs, {
      visual: { viscosity: 0.2 },
      sound: { viscosity: 0.9, elasticity: 0.7 },
    });
    expect(values.viscosity).toBe(0.2);
    expect(values.elasticity).toBe(0.7);
    expect(values.brightness).toBe(0.5);
    expect(linkedField('elasticity', defs)).toBe('sound');
    expect(linkedField('viscosity', defs)).toBe('visual');
  });
});
