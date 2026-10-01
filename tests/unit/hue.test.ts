import { describe, expect, it } from 'vitest';
import { hsvToRgb, type Rgb } from '../../src/materials/visual/shared/fluid/palette';
import { hueTurns, hueWeights, turnHue } from '../../src/materials/visual/shared/hue';

const RED: Rgb = [1, 0, 0];
const GREEN: Rgb = [0, 1, 0];
const BLUE: Rgb = [0, 0, 1];
// Water's sea-glass (rising) and ultramarine (falling).
const RISING: Rgb = [0.42, 0.95, 0.84];
const FALLING: Rgb = [0.36, 0.26, 1];

function expectColor(actual: Rgb, expected: Rgb): void {
  for (let i = 0; i < 3; i++) expect(actual[i]).toBeCloseTo(expected[i] ?? 0, 9);
}

function distance(a: Rgb, b: Rgb): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

describe('hue', () => {
  it('the middle of the slider is no turn, and its two ends meet half a turn away', () => {
    expect(hueTurns(0.5)).toBe(0);
    expect(hueTurns(0)).toBe(0.5);
    expect(hueTurns(1)).toBe(0.5);
    expect(hueTurns(0.75)).toBe(0.25);
    for (let v = 0; v <= 1; v += 0.01) {
      expect(hueTurns(v)).toBeGreaterThanOrEqual(0);
      expect(hueTurns(v)).toBeLessThan(1);
    }
  });

  it('no turn has exactly the weights that leave a color alone', () => {
    expect(Array.from(hueWeights(0))).toEqual([1, 0, 0]);
    expect(Array.from(hueWeights(1))).toEqual([1, 0, 0]);
    expect(Array.from(hueWeights(Number.NaN))).toEqual([1, 0, 0]);
    expect(turnHue(RISING, 0)).toEqual(RISING);
    const out = new Float32Array(3);
    expect(hueWeights(0.25, out)).toBe(out);
  });

  it('a third of a turn moves red to green, green to blue and blue to red', () => {
    expectColor(turnHue(RED, 1 / 3), GREEN);
    expectColor(turnHue(GREEN, 1 / 3), BLUE);
    expectColor(turnHue(BLUE, 1 / 3), RED);
    expectColor(turnHue(RED, -1 / 3), BLUE);
    // The same way round as the palettes' own hue.
    expectColor(turnHue(hsvToRgb(0, 1, 1), 1 / 3), hsvToRgb(1 / 3, 1, 1));
    const weights = hueWeights(1 / 3);
    expect(weights[0]).toBeCloseTo(0, 6);
    expect(weights[1]).toBeCloseTo(0, 6);
    expect(weights[2]).toBeCloseTo(1, 6);
  });

  it('a sixth of a turn takes red toward yellow, not magenta', () => {
    const [r, g, b] = turnHue(RED, 1 / 6);
    expect(r).toBeCloseTo(g, 9);
    expect(g).toBeGreaterThan(b + 0.5);
  });

  it('keeps greys, the light in a color, and how far apart two colors are', () => {
    for (const turns of [0.1, 0.25, 0.37, 0.5, 0.8]) {
      expectColor(turnHue([0, 0, 0], turns), [0, 0, 0]);
      expectColor(turnHue([0.6, 0.6, 0.6], turns), [0.6, 0.6, 0.6]);
      const [r, g, b] = turnHue(RISING, turns);
      expect(r + g + b).toBeCloseTo(RISING[0] + RISING[1] + RISING[2], 9);
      // A wink's close and open stay as different as the palette made them.
      expect(distance(turnHue(RISING, turns), turnHue(FALLING, turns))).toBeCloseTo(
        distance(RISING, FALLING),
        9,
      );
      const weights = hueWeights(turns);
      expect((weights[0] ?? 0) + (weights[1] ?? 0) + (weights[2] ?? 0)).toBeCloseTo(1, 6);
    }
  });

  it('turns add up, and a whole turn comes back to the start', () => {
    expectColor(turnHue(turnHue(FALLING, 0.2), 0.3), turnHue(FALLING, 0.5));
    expectColor(turnHue(turnHue(FALLING, 0.7), 0.3), FALLING);
    expectColor(turnHue(FALLING, 1.25), turnHue(FALLING, 0.25));
    expectColor(turnHue(FALLING, -0.25), turnHue(FALLING, 0.75));
  });
});
