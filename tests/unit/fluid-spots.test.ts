import { describe, expect, it } from 'vitest';
import {
  SPOT_MEAN,
  SPOT_TEXTURE_SIZE,
  generateSpotTexture,
} from '../../src/materials/visual/shared/fluid/spots';

// A smaller texture keeps the tests quick; the maths is the same.
const SIZE = 96;
const CELLS = 8;

describe('dye spot pattern', () => {
  it('is the same for a seed and different across seeds', () => {
    const a = generateSpotTexture(1234, SIZE, CELLS);
    const b = generateSpotTexture(1234, SIZE, CELLS);
    const c = generateSpotTexture(1235, SIZE, CELLS);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('has RG texels (profile, rank) at the default size', () => {
    expect(generateSpotTexture(1).length).toBe(SPOT_TEXTURE_SIZE * SPOT_TEXTURE_SIZE * 2);
  });

  it('holds soft round spots whose average matches SPOT_MEAN', () => {
    for (const seed of [1, 99, 12345]) {
      const t = generateSpotTexture(seed);
      let sum = 0;
      let peak = 0;
      for (let i = 0; i < t.length; i += 2) {
        sum += (t[i] ?? 0) / 255;
        peak = Math.max(peak, t[i] ?? 0);
      }
      expect(peak).toBeGreaterThan(240);
      expect(Math.abs(sum / (t.length / 2) - SPOT_MEAN)).toBeLessThan(0.01);
    }
  });

  it('ranks spots uniformly, so coverage c shows about a fraction c of them', () => {
    const t = generateSpotTexture(5, SIZE, CELLS);
    let below = 0;
    let count = 0;
    for (let i = 0; i < t.length; i += 2) {
      if ((t[i] ?? 0) < 250) continue; // spot centres only
      count++;
      if ((t[i + 1] ?? 0) / 255 < 0.5) below++;
    }
    expect(count).toBeGreaterThan(20);
    expect(below / count).toBeGreaterThan(0.2);
    expect(below / count).toBeLessThan(0.8);
  });

  it('tiles seamlessly (opposite edges continue each other)', () => {
    const t = generateSpotTexture(7, SIZE, CELLS);
    const at = (x: number, y: number) => t[(y * SIZE + x) * 2] ?? 0;
    let worst = 0;
    for (let y = 0; y < SIZE; y++) {
      // Across the wrap, neighbours differ no more than neighbours inside the texture.
      worst = Math.max(worst, Math.abs(at(SIZE - 1, y) - at(0, y)));
    }
    let inside = 0;
    for (let y = 0; y < SIZE; y++) inside = Math.max(inside, Math.abs(at(1, y) - at(0, y)));
    expect(worst).toBeLessThanOrEqual(inside + 2);
  });
});
