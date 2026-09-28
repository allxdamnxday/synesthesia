import { describe, expect, it } from 'vitest';
import {
  MIN_TRIM_FRAMES,
  clampPlayhead,
  clampTrim,
  clipTimeForSignature,
  defaultTrim,
  frameIndexAt,
  frameStartAt,
  playheadRange,
  safeFps,
  seekTimeFor,
  snapToFrame,
  stepFrame,
  trimLength,
  trimTooLong,
} from '../../src/screens/Prepare/trim';

const FPS = 30;

describe('trim', () => {
  it('starts with the whole clip, or its first minute', () => {
    expect(defaultTrim(2.5)).toEqual({ startSec: 0, endSec: 2.5 });
    expect(defaultTrim(130)).toEqual({ startSec: 0, endSec: 60 });
    expect(defaultTrim(NaN)).toEqual({ startSec: 0, endSec: 0 });
  });

  it('snaps handles to frame boundaries inside the clip', () => {
    expect(snapToFrame(0.51, FPS)).toBeCloseTo(0.5, 12);
    expect(clampTrim({ startSec: 0.51, endSec: 2.01 }, 2.5, FPS)).toEqual({
      startSec: 0.5,
      endSec: 2,
    });
    expect(clampTrim({ startSec: -3, endSec: 9 }, 2.5, FPS)).toEqual({ startSec: 0, endSec: 2.5 });
  });

  it('keeps a few frames between the handles; the moving handle gives way', () => {
    const min = MIN_TRIM_FRAMES / FPS;
    const draggingStart = clampTrim({ startSec: 1.9, endSec: 2 }, 2.5, FPS, 'start');
    expect(draggingStart.endSec).toBe(2);
    expect(draggingStart.startSec).toBeCloseTo(2 - min, 9);
    // Dragging the start past the end still leaves the end alone.
    expect(clampTrim({ startSec: 2.4, endSec: 2 }, 2.5, FPS, 'start').endSec).toBe(2);
    const draggingEnd = clampTrim({ startSec: 1, endSec: 0.5 }, 2.5, FPS, 'end');
    expect(draggingEnd.startSec).toBe(1);
    expect(draggingEnd.endSec).toBeCloseTo(1 + min, 9);
    // Near the clip's ends the other handle moves only as much as it must.
    const atEnd = clampTrim({ startSec: 2.5, endSec: 2.5 }, 2.5, FPS, 'end');
    expect(atEnd.endSec).toBe(2.5);
    expect(atEnd.startSec).toBeCloseTo(2.5 - min, 9);
    const atStart = clampTrim({ startSec: 0, endSec: 0 }, 2.5, FPS, 'start');
    expect(atStart).toEqual({ startSec: 0, endSec: min });
    // A clip shorter than the minimum keeps all of itself.
    expect(clampTrim({ startSec: 0, endSec: 0.05 }, 0.05, FPS)).toEqual({
      startSec: 0,
      endSec: 0.05,
    });
  });

  it('knows when a trim is too long to extract', () => {
    expect(trimLength({ startSec: 1, endSec: 3.5 })).toBe(2.5);
    expect(trimTooLong({ startSec: 0, endSec: 60 })).toBe(false);
    expect(trimTooLong({ startSec: 0, endSec: 60.5 })).toBe(true);
    expect(trimTooLong({ startSec: 10, endSec: 70 })).toBe(false);
  });
});

describe('playhead', () => {
  const trim = { startSec: 0.5, endSec: 2 };

  it('stays between the first and last frames of the trim', () => {
    const [lo, hi] = playheadRange(trim, FPS);
    expect(lo).toBe(0.5);
    expect(hi).toBeCloseTo(2 - 1 / FPS, 12);
    expect(clampPlayhead(0.1, trim, FPS)).toBe(0.5);
    expect(clampPlayhead(2, trim, FPS)).toBeCloseTo(2 - 1 / FPS, 12);
    expect(clampPlayhead(1.2, trim, FPS)).toBe(1.2);
    expect(clampPlayhead(NaN, trim, FPS)).toBe(0.5);
  });

  it('steps one frame at a time at the clip’s own rate', () => {
    expect(frameIndexAt(1, FPS)).toBe(30);
    // A time just inside frame 30 (float noise) still counts as frame 30.
    expect(frameIndexAt(30 / FPS - 1e-9, FPS)).toBe(30);
    // Chrome reports frame times rounded to the microsecond: 0.033333 is frame 1, not 0.
    expect(frameIndexAt(0.033333, FPS)).toBe(1);
    expect(frameIndexAt(0.333333, FPS)).toBe(10);
    expect(frameIndexAt(0.066667, FPS)).toBe(2);
    for (const fps of [23.976, 25, 29.97, 30, 59.94, 60, 120, 240]) {
      for (let k = 0; k < 2000; k += 7) {
        const reported = Math.round((k / fps) * 1e6) / 1e6;
        expect(frameIndexAt(reported, fps)).toBe(k);
        // …and the middle of a frame is always that frame.
        expect(frameIndexAt((k + 0.5) / fps, fps)).toBe(k);
      }
    }
    expect(frameStartAt(1.02, FPS)).toBeCloseTo(1, 12);
    expect(stepFrame(1, 1, trim, FPS)).toBeCloseTo(31 / FPS, 12);
    expect(stepFrame(1, -1, trim, FPS)).toBeCloseTo(29 / FPS, 12);
    expect(stepFrame(0.5, -1, trim, FPS)).toBe(0.5);
    expect(stepFrame(2 - 1 / FPS, 1, trim, FPS)).toBeCloseTo(2 - 1 / FPS, 12);
    expect(stepFrame(1, 1, trim, 25)).toBeCloseTo(26 / 25, 12);
  });

  it('seeks to the middle of a frame', () => {
    expect(seekTimeFor(1, FPS)).toBeCloseTo(1 + 0.5 / FPS, 12);
    expect(safeFps(0)).toBe(30);
    expect(safeFps(59.94)).toBe(59.94);
  });

  it('places the signature back in the clip', () => {
    // Field frame 0 is the movement between the first two analysis frames.
    expect(clipTimeForSignature(0, trim, FPS)).toBeCloseTo(0.5 + 1 / FPS, 12);
    expect(clipTimeForSignature(1, trim, FPS)).toBeCloseTo(1.5 + 1 / FPS, 12);
  });
});
