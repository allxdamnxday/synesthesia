import { describe, expect, it } from 'vitest';
import {
  analysisFrameRate,
  analysisSize,
  composeOrientation,
  focusCropPx,
  orientPoint,
  orientedSize,
  rgbaToGray,
  sampleTimestamps,
  type Orientation,
} from '../../src/signature/frameGeometry';
import type { Rotation } from '../../src/signature/types';

const ROTATIONS: Rotation[] = [0, 90, 180, 270];

describe('orientation', () => {
  it('rotating 90° clockwise sends the top-left corner to the top-right', () => {
    expect(orientPoint(0, 0, 640, 360, { rotation: 90, flip: false })).toEqual([360, 0]);
    expect(orientPoint(640, 0, 640, 360, { rotation: 90, flip: false })).toEqual([360, 640]);
    expect(orientedSize(640, 360, 90)).toEqual({ width: 360, height: 640 });
    expect(orientedSize(640, 360, 180)).toEqual({ width: 640, height: 360 });
  });

  it('composing container then user equals applying them one after the other', () => {
    const W = 640;
    const H = 360;
    const points: [number, number][] = [
      [0, 0],
      [W, 0],
      [0, H],
      [100, 50],
      [W, H],
    ];
    for (const containerRotation of ROTATIONS) {
      for (const containerFlip of [false, true]) {
        for (const rotate of ROTATIONS) {
          for (const mirror of [false, true]) {
            const container: Orientation = { rotation: containerRotation, flip: containerFlip };
            const user: Orientation = { rotation: rotate, flip: mirror };
            const composed = composeOrientation(container, { rotate, mirror });
            const mid = orientedSize(W, H, containerRotation);
            for (const [x, y] of points) {
              const [x1, y1] = orientPoint(x, y, W, H, container);
              const stepwise = orientPoint(x1, y1, mid.width, mid.height, user);
              expect(orientPoint(x, y, W, H, composed)).toEqual(stepwise);
            }
          }
        }
      }
    }
  });

  it('a phone clip stored landscape with 90° metadata, rotated back by the user, is landscape', () => {
    const o = composeOrientation({ rotation: 90, flip: false }, { rotate: 270, mirror: false });
    expect(o).toEqual({ rotation: 0, flip: false });
    expect(composeOrientation({ rotation: 0, flip: false }, { rotate: 90, mirror: true })).toEqual({
      rotation: 90,
      flip: true,
    });
  });
});

describe('focus area crop', () => {
  it('whole frame without a focus area', () => {
    expect(focusCropPx(null, 1920, 1080)).toEqual({ left: 0, top: 0, width: 1920, height: 1080 });
  });

  it('rounds to integer pixels of the oriented frame', () => {
    expect(focusCropPx({ x: 0.25, y: 0.5, w: 0.5, h: 0.25 }, 1920, 1080)).toEqual({
      left: 480,
      top: 540,
      width: 960,
      height: 270,
    });
  });

  it('clamps to the frame and keeps at least 8 px', () => {
    expect(focusCropPx({ x: 0.9, y: -0.2, w: 0.5, h: 0.5 }, 1000, 1000)).toEqual({
      left: 900,
      top: 0,
      width: 100,
      height: 300,
    });
    const tiny = focusCropPx({ x: 0.5, y: 0.5, w: 0.0001, h: 0.0001 }, 1000, 1000);
    expect(tiny.width).toBe(8);
    expect(tiny.height).toBe(8);
    const corner = focusCropPx({ x: 1, y: 1, w: 0, h: 0 }, 100, 100);
    expect(corner).toEqual({ left: 92, top: 92, width: 8, height: 8 });
  });
});

describe('analysis size and timing', () => {
  it('makes the longer side analysisWidth and keeps the aspect ratio', () => {
    expect(analysisSize(1920, 1080, 320)).toEqual({ width: 320, height: 180 });
    // Portrait costs the same as landscape.
    expect(analysisSize(1080, 1920, 320)).toEqual({ width: 180, height: 320 });
    expect(analysisSize(1000, 1000, 320)).toEqual({ width: 320, height: 320 });
    expect(analysisSize(200, 150, 320)).toEqual({ width: 320, height: 240 }); // upscales a small box
    expect(analysisSize(150, 200, 320)).toEqual({ width: 240, height: 320 });
  });

  it('clamps extreme shapes', () => {
    expect(analysisSize(1000, 10, 320)).toEqual({ width: 320, height: 16 });
    expect(analysisSize(10, 1000, 320)).toEqual({ width: 16, height: 320 });
    expect(analysisSize(1920, 1080, 5)).toEqual({ width: 32, height: 18 });
    expect(analysisSize(1920, 1080, 99999).width).toBe(1920);
    expect(analysisSize(0, 0, 320)).toEqual({ width: 320, height: 180 });
  });

  it('analysis rate is the native rate capped at 60', () => {
    expect(analysisFrameRate(29.97, 60)).toBe(29.97);
    expect(analysisFrameRate(240, 60)).toBe(60);
  });

  it('samples the middle of every frame interval over the trim', () => {
    const t = sampleTimestamps(0, 3, 30);
    expect(t.length).toBe(90);
    expect(t[0]).toBeCloseTo(0.5 / 30, 12);
    expect(t[89]).toBeCloseTo(89.5 / 30, 12);
    const fps = 30000 / 1001;
    const u = sampleTimestamps(0, 90 / fps, fps);
    expect(u.length).toBe(90);
    // Every sample falls strictly inside its own frame interval.
    u.forEach((time, i) => {
      expect(time).toBeGreaterThan(i / fps);
      expect(time).toBeLessThan((i + 1) / fps);
    });
    expect(sampleTimestamps(1.2, 1.25, 30).length).toBe(1);
    expect(sampleTimestamps(2, 1, 30).length).toBe(0);
  });
});

describe('grayscale', () => {
  it('uses integer BT.601 weights', () => {
    const rgba = Uint8ClampedArray.from([
      255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255,
    ]);
    expect(Array.from(rgbaToGray(rgba, new Uint8Array(4)))).toEqual([255, 0, 77, 149]);
  });
});
