import { describe, expect, it } from 'vitest';
import {
  describeOnsets,
  describeSeconds,
  formatClipTime,
  formatSpeed,
  nameFromFileName,
} from '../../src/screens/Prepare/format';
import {
  PHASE_WORDS,
  estimateRemainingSec,
  overallFraction,
  progressTimeText,
} from '../../src/screens/Prepare/progress';

describe('time and names', () => {
  it('formats clip time with hundredths', () => {
    expect(formatClipTime(0)).toBe('0:00.00');
    expect(formatClipTime(1.27)).toBe('0:01.27');
    expect(formatClipTime(65)).toBe('1:05.00');
    expect(formatClipTime(59.999)).toBe('1:00.00');
    expect(formatClipTime(-2)).toBe('0:00.00');
    expect(formatClipTime(NaN)).toBe('0:00.00');
  });

  it('names a signature after its clip', () => {
    expect(nameFromFileName('IMG_1234.MOV')).toBe('IMG 1234');
    expect(nameFromFileName('left-eye wink.mp4')).toBe('left-eye wink');
    expect(nameFromFileName('C:\\clips\\wink__01.webm')).toBe('wink 01');
    expect(nameFromFileName('archive.2026.mp4')).toBe('archive.2026');
    expect(nameFromFileName('.mov')).toBe('Untitled signature');
    expect(nameFromFileName(`${'x'.repeat(200)}.mp4`)).toHaveLength(120);
  });

  it('formats speed, seconds and onsets plainly', () => {
    expect(formatSpeed(1)).toBe('1×');
    expect(formatSpeed(0.25)).toBe('0.25×');
    expect(formatSpeed(1.5000001)).toBe('1.5×');
    expect(describeSeconds(1)).toBe('1 second');
    expect(describeSeconds(12.4)).toBe('12 seconds');
    expect(describeSeconds(65)).toBe('1 min 5 s');
    expect(describeSeconds(120)).toBe('2 min');
    expect(describeOnsets(0)).toBe('No moments of sudden movement');
    expect(describeOnsets(1)).toBe('1 moment of sudden movement');
    expect(describeOnsets(3)).toBe('3 moments of sudden movement');
  });
});

describe('extraction progress', () => {
  it('names each phase in plain words', () => {
    expect(PHASE_WORDS).toEqual({
      loading: 'Loading…',
      reading: 'Reading the clip…',
      analyzing: 'Finding the movement…',
      finishing: 'Finishing…',
    });
  });

  it('fills the bar across the phases in order', () => {
    expect(overallFraction(null)).toBe(0);
    expect(overallFraction({ phase: 'loading', done: 0, total: 1 })).toBe(0);
    expect(overallFraction({ phase: 'reading', done: 1, total: 1 })).toBeCloseTo(0.1, 12);
    expect(overallFraction({ phase: 'analyzing', done: 50, total: 100 })).toBeCloseTo(0.525, 12);
    expect(overallFraction({ phase: 'finishing', done: 1, total: 1 })).toBe(1);
    expect(overallFraction({ phase: 'analyzing', done: 5, total: 0 })).toBeCloseTo(0.1, 12);
  });

  it('estimates the time left once a few frames are done', () => {
    expect(estimateRemainingSec({ phase: 'loading', done: 0, total: 1 }, 0)).toBeNull();
    expect(estimateRemainingSec({ phase: 'analyzing', done: 2, total: 100 }, 1)).toBeNull();
    // 20 frames in 2 s → 0.1 s a frame → 80 more frames ≈ 8 s, plus finishing.
    expect(estimateRemainingSec({ phase: 'analyzing', done: 20, total: 100 }, 2)).toBeCloseTo(
      8.5,
      9,
    );
    expect(estimateRemainingSec({ phase: 'finishing', done: 1, total: 1 }, 5)).toBe(0);
  });

  it('says how long it has taken and how long is left', () => {
    expect(progressTimeText(4.2, null)).toBe('4 seconds so far');
    expect(progressTimeText(12, 8.2)).toBe('12 seconds so far, about 9 seconds left');
    expect(progressTimeText(1, 0.8)).toBe('1 second so far, almost done');
  });
});
