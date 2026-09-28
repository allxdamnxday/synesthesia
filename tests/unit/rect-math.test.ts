import { describe, expect, it } from 'vitest';
import {
  RECT_HANDLES,
  centeredRect,
  clampRect,
  containsPoint,
  meetsMinimum,
  moveRect,
  rectFromPoints,
  resizeRect,
  roundRect,
  type NormRect,
} from '../../src/ui/rectMath';

const MIN = { w: 0.05, h: 0.05 };

function expectRect(actual: NormRect, expected: NormRect) {
  expect(actual.x).toBeCloseTo(expected.x, 9);
  expect(actual.y).toBeCloseTo(expected.y, 9);
  expect(actual.w).toBeCloseTo(expected.w, 9);
  expect(actual.h).toBeCloseTo(expected.h, 9);
}

function inside(r: NormRect) {
  expect(r.x).toBeGreaterThanOrEqual(0);
  expect(r.y).toBeGreaterThanOrEqual(0);
  expect(r.x + r.w).toBeLessThanOrEqual(1 + 1e-12);
  expect(r.y + r.h).toBeLessThanOrEqual(1 + 1e-12);
}

describe('focus box geometry', () => {
  it('clamps any rect into the frame with a minimum size', () => {
    expectRect(clampRect({ x: -0.2, y: 0.9, w: 0.5, h: 0.5 }), { x: 0, y: 0.5, w: 0.5, h: 0.5 });
    expectRect(clampRect({ x: 0.5, y: 0.5, w: 0.01, h: 2 }, MIN), { x: 0.5, y: 0, w: 0.05, h: 1 });
    expectRect(clampRect({ x: NaN, y: Infinity, w: NaN, h: 0.2 }), { x: 0, y: 0, w: 1, h: 0.2 });
  });

  it('moves without resizing and stops at the edges', () => {
    const r = { x: 0.4, y: 0.4, w: 0.2, h: 0.3 };
    expectRect(moveRect(r, 0.1, -0.1), { x: 0.5, y: 0.3, w: 0.2, h: 0.3 });
    expectRect(moveRect(r, 1, 1), { x: 0.8, y: 0.7, w: 0.2, h: 0.3 });
    expectRect(moveRect(r, -1, -1), { x: 0, y: 0, w: 0.2, h: 0.3 });
  });

  it('resizes from each edge and corner, keeping the opposite side fixed', () => {
    const r = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 };
    expectRect(resizeRect(r, 'e', 0.1, 0.5, MIN), { x: 0.2, y: 0.2, w: 0.5, h: 0.4 });
    expectRect(resizeRect(r, 'w', 0.1, 0.5, MIN), { x: 0.3, y: 0.2, w: 0.3, h: 0.4 });
    expectRect(resizeRect(r, 'n', 0.5, -0.1, MIN), { x: 0.2, y: 0.1, w: 0.4, h: 0.5 });
    expectRect(resizeRect(r, 's', 0.5, 0.1, MIN), { x: 0.2, y: 0.2, w: 0.4, h: 0.5 });
    expectRect(resizeRect(r, 'se', 0.1, 0.1, MIN), { x: 0.2, y: 0.2, w: 0.5, h: 0.5 });
    expectRect(resizeRect(r, 'nw', -0.1, -0.1, MIN), { x: 0.1, y: 0.1, w: 0.5, h: 0.5 });
  });

  it('never turns inside out, shrinks below the minimum, or leaves the frame', () => {
    const r = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 };
    for (const handle of RECT_HANDLES) {
      for (const [dx, dy] of [
        [-2, -2],
        [2, 2],
        [0.39, 0.39],
        [-0.39, -0.39],
      ]) {
        const out = resizeRect(r, handle, dx, dy, MIN);
        expect(meetsMinimum(out, MIN)).toBe(true);
        inside(out);
      }
    }
    expectRect(resizeRect(r, 'e', -1, 0, MIN), { x: 0.2, y: 0.2, w: 0.05, h: 0.4 });
    expectRect(resizeRect(r, 'n', 0, 1, MIN), { x: 0.2, y: 0.55, w: 0.4, h: 0.05 });
  });

  it('draws a box between two points in any direction, clipped to the frame', () => {
    expectRect(rectFromPoints(0.6, 0.7, 0.2, 0.1), { x: 0.2, y: 0.1, w: 0.4, h: 0.6 });
    expectRect(rectFromPoints(-0.5, 0.5, 0.5, 1.5), { x: 0, y: 0.5, w: 0.5, h: 0.5 });
  });

  it('centres, rounds and hit-tests', () => {
    expectRect(centeredRect(0.4, 0.5), { x: 0.3, y: 0.25, w: 0.4, h: 0.5 });
    expect(roundRect({ x: 0.123456, y: 0.1 + 0.2, w: 1 / 3, h: 0.5 })).toEqual({
      x: 0.1235,
      y: 0.3,
      w: 0.3333,
      h: 0.5,
    });
    expect(containsPoint({ x: 0.2, y: 0.2, w: 0.2, h: 0.2 }, 0.3, 0.4)).toBe(true);
    expect(containsPoint({ x: 0.2, y: 0.2, w: 0.2, h: 0.2 }, 0.5, 0.3)).toBe(false);
  });
});
