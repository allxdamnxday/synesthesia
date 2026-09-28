import { describe, expect, it } from 'vitest';
import {
  createComposition,
  defaultCompositionName,
  materialVersionChanges,
} from '../../src/engine/compositionFactory';
import { validateComposition } from '../../src/engine/compositionSerialize';
import { sharedProperty } from '../../src/materials/properties';
import type { MaterialMeta } from '../../src/materials/types';
import { formatSeed, newSeed, parseSeed } from '../../src/state/seed';

const visual: MaterialMeta = {
  id: 'water',
  version: 1,
  name: 'Water',
  description: 'Dye in water.',
  properties: [sharedProperty('viscosity', 'visual', { default: 0.3 })],
};
const sound: MaterialMeta = {
  id: 'water',
  version: 2,
  name: 'Water',
  description: 'Bright rising tones.',
  properties: [sharedProperty('viscosity', 'sound')],
};

describe('composition factory', () => {
  it('starts from each material baseline and the signature speed, and validates', () => {
    const c = createComposition({
      id: 'c1',
      now: '2026-09-28T12:00:00.000Z',
      name: defaultCompositionName('Wink', 'Water', 'Water'),
      signature: { id: 's1', contentHash: 'a'.repeat(64), name: 'Wink', preferredSpeed: 0.5 },
      seed: 4217,
      visual,
      sound,
      render: { width: 1920, height: 1080, fps: 30 },
    });
    expect(c.visual.properties.viscosity).toBe(0.3);
    expect(c.sound.properties.viscosity).toBe(0.5);
    expect(c.timeline.speed).toBe(0.5);
    expect(c.linked).toBe(true);
    expect(c.name).toBe('Wink · Water and Water');
    expect(() => validateComposition(JSON.parse(JSON.stringify(c)))).not.toThrow();
    expect(materialVersionChanges(c, { visual, sound: { ...sound, version: 3 } })).toEqual({
      visual: false,
      sound: true,
    });
  });
});

describe('seeds', () => {
  it('are six digits', () => {
    for (let i = 0; i < 50; i++) {
      const s = newSeed();
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(1_000_000);
    }
    expect(formatSeed(4217)).toBe('004217');
    expect(parseSeed(' 004217 ')).toBe(4217);
    expect(parseSeed('1234567')).toBeNull();
    expect(parseSeed('12a')).toBeNull();
  });
});
