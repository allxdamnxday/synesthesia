import { describe, expect, it } from 'vitest';
import { isDoubleTap, touchIntent } from '../../src/ui/touchMath';

describe('touch intent', () => {
  it('stays undecided within the slop', () => {
    expect(touchIntent(0, 0, 6)).toBe('undecided');
    expect(touchIntent(6, -6, 6)).toBe('undecided');
    expect(touchIntent(-4, 5, 6)).toBe('undecided');
  });

  it('sideways past the slop is a drag, either way', () => {
    expect(touchIntent(7, 0, 6)).toBe('drag');
    expect(touchIntent(-12, 3, 6)).toBe('drag');
    expect(touchIntent(20, 19, 6)).toBe('drag');
  });

  it('up or down past the slop is the page scrolling, and wins a tie', () => {
    expect(touchIntent(0, 7, 6)).toBe('scroll');
    expect(touchIntent(3, -12, 6)).toBe('scroll');
    expect(touchIntent(10, 10, 6)).toBe('scroll');
  });
});

describe('double tap', () => {
  const first = { time: 1000, x: 100, y: 50 };

  it('needs a first tap', () => {
    expect(isDoubleTap(null, first)).toBe(false);
  });

  it('is two taps close in time and place', () => {
    expect(isDoubleTap(first, { time: 1250, x: 110, y: 58 })).toBe(true);
  });

  it('is not two taps too far apart in time or place', () => {
    expect(isDoubleTap(first, { time: 1400, x: 100, y: 50 })).toBe(false);
    expect(isDoubleTap(first, { time: 1100, x: 140, y: 50 })).toBe(false);
    expect(isDoubleTap(first, { time: 900, x: 100, y: 50 })).toBe(false);
  });

  it('takes its own limits', () => {
    expect(isDoubleTap(first, { time: 1500, x: 100, y: 50 }, 600, 10)).toBe(true);
    expect(isDoubleTap(first, { time: 1100, x: 115, y: 50 }, 600, 10)).toBe(false);
  });
});
