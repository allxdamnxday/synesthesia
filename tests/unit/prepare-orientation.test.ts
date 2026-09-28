import { describe, expect, it } from 'vitest';
import {
  ROTATIONS,
  fitRect,
  orientPoint,
  orientRect,
  orientationTransform,
  orientedSize,
  reorientRect,
  unorientPoint,
  unorientRect,
  type ViewOrientation,
} from '../../src/screens/Prepare/orientation';
import { composeOrientation, orientPoint as orientPixel } from '../../src/signature/frameGeometry';
import type { NormRect } from '../../src/ui/rectMath';

const ALL: ViewOrientation[] = ROTATIONS.flatMap((rotate) => [
  { rotate, mirror: false },
  { rotate, mirror: true },
]);

function expectRect(actual: NormRect, expected: NormRect) {
  expect(actual.x).toBeCloseTo(expected.x, 9);
  expect(actual.y).toBeCloseTo(expected.y, 9);
  expect(actual.w).toBeCloseTo(expected.w, 9);
  expect(actual.h).toBeCloseTo(expected.h, 9);
}

describe('focus area under rotate and mirror', () => {
  it('rotates clockwise, then mirrors (top-left corner of the clip as the example)', () => {
    expect(orientPoint(0, 0, { rotate: 90, mirror: false })).toEqual([1, 0]);
    expect(orientPoint(0, 0, { rotate: 180, mirror: false })).toEqual([1, 1]);
    expect(orientPoint(0, 0, { rotate: 270, mirror: false })).toEqual([0, 1]);
    expect(orientPoint(0, 0, { rotate: 0, mirror: true })).toEqual([1, 0]);
    // Mirror applies after the rotation.
    expect(orientPoint(0, 0, { rotate: 90, mirror: true })).toEqual([0, 0]);
  });

  it('matches extraction’s pixel geometry for every orientation', () => {
    const width = 320;
    const height = 180;
    for (const o of ALL) {
      const composed = composeOrientation(
        { rotation: 0, flip: false },
        { rotate: o.rotate, mirror: o.mirror },
      );
      const out = orientedSize(width, height, o.rotate);
      for (const [x, y] of [
        [0, 0],
        [80, 30],
        [320, 180],
        [200, 170],
      ]) {
        const [px, py] = orientPixel(x, y, width, height, composed);
        const [nx, ny] = orientPoint(x / width, y / height, o);
        expect(nx).toBeCloseTo(px / out.width, 12);
        expect(ny).toBeCloseTo(py / out.height, 12);
      }
    }
  });

  it('round-trips points and boxes', () => {
    const box = { x: 0.35, y: 0.3, w: 0.2, h: 0.1 };
    for (const o of ALL) {
      const [x, y] = unorientPoint(...orientPoint(0.2, 0.7, o), o);
      expect(x).toBeCloseTo(0.2, 12);
      expect(y).toBeCloseTo(0.7, 12);
      expectRect(unorientRect(orientRect(box, o), o), box);
    }
  });

  it('carries the box with the picture when rotation or mirror changes', () => {
    const eye = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    const upright: ViewOrientation = { rotate: 0, mirror: false };
    // Turning the picture a quarter clockwise moves a top-left box to the top-right, standing up.
    expectRect(reorientRect(eye, upright, { rotate: 90, mirror: false }), {
      x: 0.7,
      y: 0.1,
      w: 0.1,
      h: 0.3,
    });
    // Mirroring flips it left to right.
    expectRect(reorientRect(eye, upright, { rotate: 0, mirror: true }), {
      x: 0.6,
      y: 0.2,
      w: 0.3,
      h: 0.1,
    });
    // Four quarter turns bring it home; changes compose.
    let box = eye;
    let from = upright;
    for (const rotate of [90, 180, 270, 0] as const) {
      const to = { rotate, mirror: false };
      box = reorientRect(box, from, to);
      from = to;
    }
    expectRect(box, eye);
    for (const a of ALL) {
      for (const b of ALL) {
        expectRect(
          reorientRect(reorientRect(eye, upright, a), a, b),
          reorientRect(eye, upright, b),
        );
      }
    }
  });

  it('builds the CSS transform: rotate first, then mirror', () => {
    expect(orientationTransform({ rotate: 0, mirror: false })).toBe('none');
    expect(orientationTransform({ rotate: 90, mirror: false })).toBe('rotate(90deg)');
    expect(orientationTransform({ rotate: 270, mirror: true })).toBe('scaleX(-1) rotate(270deg)');
    expect(orientedSize(1920, 1080, 90)).toEqual({ width: 1080, height: 1920 });
    expect(orientedSize(1920, 1080, 180)).toEqual({ width: 1920, height: 1080 });
  });

  it('fits a picture inside the stage without cropping', () => {
    const wide = fitRect(1000, 500, 16 / 9);
    expect(wide.height).toBe(500);
    expect(wide.width).toBeCloseTo(888.889, 3);
    expect(wide.x).toBeCloseTo(55.556, 3);
    expect(wide.y).toBe(0);
    const tall = fitRect(1000, 500, 9 / 16);
    expect(tall.height).toBe(500);
    expect(tall.width).toBeCloseTo(281.25, 6);
    expect(tall.x).toBeCloseTo(359.375, 6);
    const flat = fitRect(400, 1000, 2);
    expect(flat).toEqual({ x: 0, y: 400, width: 400, height: 200 });
    expect(fitRect(0, 100, 1)).toEqual({ x: 0, y: 0, width: 0, height: 100 });
  });
});
