import { describe, expect, it } from 'vitest';
import {
  MAX_PRIMARY_PROPERTIES,
  MAX_SPECIFIC_PROPERTIES,
  countsTowardPrimaryCap,
  isSharedPropertyId,
} from '../../src/materials/properties';
import {
  DEFAULT_VISUAL_ID,
  SIGNATURE_VIEW_ID,
  getVisualMaterial,
  listVisualMaterials,
} from '../../src/materials/registry';
import {
  luminance,
  paletteColorAt,
  hsvToRgb,
  buildPalette,
  PALETTE_SIZE,
} from '../../src/materials/visual/shared/fluid/palette';
import { WATER_PALETTE_BYTES } from '../../src/materials/visual/water/palettes';

describe('visual material registry', () => {
  it('registers Water (the default) and the Signature view', () => {
    expect(getVisualMaterial(DEFAULT_VISUAL_ID)?.meta.name).toBe('Water');
    expect(getVisualMaterial(SIGNATURE_VIEW_ID)?.meta.name).toBe('Signature');
    const ids = listVisualMaterials().map((m) => m.meta.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('create() returns fresh instances that match their metadata', () => {
    for (const entry of listVisualMaterials()) {
      const a = entry.create();
      const b = entry.create();
      expect(a).not.toBe(b);
      expect(a.id).toBe(entry.meta.id);
      expect(a.version).toBe(entry.meta.version);
      expect(a.properties).toEqual(entry.meta.properties);
    }
  });

  for (const entry of listVisualMaterials()) {
    const { meta } = entry;
    it(`${meta.name} follows the property rules (SPEC 9.1, 9.2)`, () => {
      expect(meta.version).toBeGreaterThanOrEqual(1);
      expect(meta.description).toMatch(/^[A-Z].*\.$/);
      const ids = meta.properties.map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
      // Six primaries at most; Hue is shown beside them.
      expect(
        meta.properties.filter((p) => p.primary && countsTowardPrimaryCap(p)).length,
      ).toBeLessThanOrEqual(MAX_PRIMARY_PROPERTIES);
      expect(meta.properties.filter((p) => !p.shared).length).toBeLessThanOrEqual(
        MAX_SPECIFIC_PROPERTIES,
      );
      for (const p of meta.properties) {
        expect(p.shared).toBe(isSharedPropertyId(p.id));
        // Sentence case label, one plain sentence of description.
        expect(p.label).toMatch(/^[A-Z][a-z ]*$/);
        expect(p.description).toMatch(/^[A-Z].*\.$/);
        if (p.kind === 'choice') {
          expect(p.choices?.length ?? 0).toBeGreaterThanOrEqual(2);
          expect(Number.isInteger(p.default)).toBe(true);
          expect(p.default).toBeGreaterThanOrEqual(0);
          expect(p.default).toBeLessThan(p.choices?.length ?? 0);
        } else {
          expect(p.default).toBeGreaterThanOrEqual(0);
          expect(p.default).toBeLessThanOrEqual(1);
        }
      }
    });
  }

  it('Water hides elasticity and rigidity and keeps range under More', () => {
    const water = getVisualMaterial('water')?.meta;
    const ids = water?.properties.map((p) => p.id) ?? [];
    expect(ids).not.toContain('elasticity');
    expect(ids).not.toContain('rigidity');
    const primary = water?.properties.filter((p) => p.primary).map((p) => p.id);
    expect(primary).toEqual([
      'viscosity',
      'persistence',
      'dispersion',
      'brightness',
      'intensity',
      'density',
    ]);
    expect(water?.properties.find((p) => p.id === 'palette')?.choices).toEqual([
      'Deep water',
      'Ink',
      'Prism',
    ]);
  });

  it('the Signature view has only its readout choice', () => {
    const view = getVisualMaterial(SIGNATURE_VIEW_ID)?.meta;
    expect(view?.properties.map((p) => p.id)).toEqual(['showReadout']);
    expect(view?.properties[0]?.choices).toEqual(['Off', 'On']);
  });
});

describe('direction palettes', () => {
  it('interpolates cyclically between stops', () => {
    const stops = [
      { turn: 0, color: [1, 0, 0] as const },
      { turn: 0.5, color: [0, 0, 1] as const },
    ];
    expect(paletteColorAt(stops, 0)).toEqual([1, 0, 0]);
    expect(paletteColorAt(stops, 0.5)).toEqual([0, 0, 1]);
    expect(paletteColorAt(stops, 1)).toEqual([1, 0, 0]);
    const mid = paletteColorAt(stops, 0.75);
    expect(mid[0]).toBeCloseTo(0.5, 6);
    expect(mid[2]).toBeCloseTo(0.5, 6);
  });

  it('builds opaque palette textures', () => {
    const bytes = buildPalette((turn) => hsvToRgb(turn, 1, 1));
    expect(bytes.length).toBe(PALETTE_SIZE * 4);
    for (let i = 3; i < bytes.length; i += 4) expect(bytes[i]).toBe(255);
  });

  it("gives a wink's close (down) and open (up) clearly different colors in every Water palette", () => {
    const colorAt = (bytes: Uint8Array, turn: number) => {
      const i = Math.floor(turn * PALETTE_SIZE) * 4;
      return [(bytes[i] ?? 0) / 255, (bytes[i + 1] ?? 0) / 255, (bytes[i + 2] ?? 0) / 255] as const;
    };
    for (const bytes of WATER_PALETTE_BYTES) {
      const up = colorAt(bytes, 0.25);
      const down = colorAt(bytes, 0.75);
      const distance = Math.hypot(up[0] - down[0], up[1] - down[1], up[2] - down[2]);
      expect(distance).toBeGreaterThan(0.3);
      // Neither direction disappears into the black surround.
      expect(luminance(up)).toBeGreaterThan(0.15);
      expect(luminance(down)).toBeGreaterThan(0.15);
    }
  });
});
