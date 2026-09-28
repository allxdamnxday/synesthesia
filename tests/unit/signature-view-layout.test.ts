import { describe, expect, it } from 'vitest';
import {
  REST_BRIGHTNESS,
  STROKE_MAX_CELLS,
  fieldLayout,
  readoutLayout,
  strokeBrightness,
  strokeLength,
} from '../../src/materials/visual/signature-view/layout';

describe('Signature view layout', () => {
  it('fits the grid to the canvas with square cells', () => {
    const l = fieldLayout(32, 18, 1920, 1080);
    expect(l.width).toBeCloseTo(1920, 6);
    expect(l.height).toBeCloseTo(1080, 6);
    expect(l.cellPx).toBeCloseTo(60, 6);
    expect(l.diagonalPx).toBeCloseTo(Math.hypot(1920, 1080), 6);
    // A square grid on a wide canvas is centred with black either side.
    const square = fieldLayout(32, 32, 1920, 1080);
    expect(square.width).toBeCloseTo(1080, 6);
    expect(square.x).toBeCloseTo(420, 6);
  });

  it('scales strokes with the canvas, so Retina stays crisp and proportions hold', () => {
    const small = fieldLayout(32, 18, 960, 540);
    const retina = fieldLayout(32, 18, 1920, 1080);
    expect(retina.strokePx / small.strokePx).toBeCloseTo(2, 1);
    expect(small.strokePx).toBeGreaterThanOrEqual(1.5);
  });

  it('grows strokes with speed and saturates at a little over a cell', () => {
    const l = fieldLayout(32, 18, 1920, 1080);
    expect(strokeLength(0, l)).toBe(0);
    let previous = 0;
    for (const speed of [0.02, 0.05, 0.1, 0.2, 0.5, 1, 3]) {
      const len = strokeLength(speed, l);
      expect(len).toBeGreaterThan(previous);
      previous = len;
    }
    expect(strokeLength(100, l)).toBeLessThanOrEqual(l.cellPx * STROKE_MAX_CELLS + 1e-9);
  });

  it('keeps a faint dot for still cells and brightens with speed', () => {
    expect(strokeBrightness(0)).toBeCloseTo(REST_BRIGHTNESS, 12);
    expect(strokeBrightness(0.15)).toBeGreaterThan(0.6);
    expect(strokeBrightness(10)).toBeLessThanOrEqual(1);
  });

  it('scales the readout panel with the canvas', () => {
    const a = readoutLayout(1280, 720);
    const b = readoutLayout(2560, 1440);
    expect(b.width / a.width).toBeCloseTo(2, 1);
    expect(a.x).toBeGreaterThan(0);
  });
});
