import { describe, expect, it } from 'vitest';
import {
  MAX_NAME_NUMBER,
  MP4_EXTENSION,
  SIDECAR_EXTENSION,
  firstFreeNumber,
  numberedStem,
  renderFileStem,
  seedLabel,
} from '../../src/render/naming';
import {
  RENDER_SAMPLE_RATE,
  audioFeedTarget,
  audioSampleCount,
  frameDuration,
  frameTime,
  maxAudioPackets,
  maxVideoPackets,
  renderFrameCount,
} from '../../src/render/timing';
import { stepsForTime } from '../../src/engine/visualRunner';
import { timelineDuration, defaultTimeline } from '../../src/engine/composition';
import { samplerConfigFor } from '../../src/render/timeline';

describe('render file names', () => {
  it('builds SP_{signature}_{composition}_{seed} with a six-digit seed', () => {
    expect(renderFileStem('Sample wink', 'Sample wink · Water and Water', 4217)).toBe(
      'SP_Sample-wink_Sample-wink-Water-and-Water_004217',
    );
    expect(`${renderFileStem('Wink', 'Track 07', 0)}${MP4_EXTENSION}`).toBe(
      'SP_Wink_Track-07_000000.mp4',
    );
  });

  it('sanitizes names: accents, punctuation, slashes and empty names', () => {
    expect(renderFileStem('Clignement d’œil', 'Élan / “vite”?', 999999)).toBe(
      'SP_Clignement-dil_Elan-vite_999999',
    );
    expect(renderFileStem('', '***', 12)).toBe('SP_untitled_untitled_000012');
    const stem = renderFileStem('a'.repeat(200), 'b'.repeat(200), 1);
    expect(stem).toBe(`SP_${'a'.repeat(60)}_${'b'.repeat(60)}_000001`);
    expect(stem).not.toMatch(/[\\/:*?"<>|]/);
  });

  it('writes seeds as six digits', () => {
    expect(seedLabel(7)).toBe('000007');
    expect(seedLabel(123456)).toBe('123456');
    expect(seedLabel(1_000_007)).toBe('000007');
    expect(seedLabel(-5)).toBe('000000');
    expect(seedLabel(Number.NaN)).toBe('000000');
    expect(seedLabel(42.9)).toBe('000042');
  });

  it('numbers taken names " (2)", " (3)" … and ignores case', () => {
    expect(numberedStem('SP_a', 1)).toBe('SP_a');
    expect(numberedStem('SP_a', 2)).toBe('SP_a (2)');
    const taken = new Set(['sp_a.mp4', 'sp_a (2).mp4', 'other.mp4']);
    expect(firstFreeNumber('SP_A', [MP4_EXTENSION], taken)).toBe(3);
    expect(firstFreeNumber('SP_b', [MP4_EXTENSION], taken)).toBe(1);
  });

  it('keeps the MP4 and its sidecar paired: both names must be free', () => {
    const taken = new Set(['sp_a.spcomp.json', 'sp_a (2).mp4']);
    expect(firstFreeNumber('SP_a', [MP4_EXTENSION], taken)).toBe(1);
    expect(firstFreeNumber('SP_a', [MP4_EXTENSION, SIDECAR_EXTENSION], taken)).toBe(3);
    expect(SIDECAR_EXTENSION).toBe('.spcomp.json');
  });

  it('gives up rather than overwrite when every number is taken', () => {
    const taken = new Set<string>();
    for (let n = 1; n <= MAX_NAME_NUMBER; n++) taken.add(`${numberedStem('x', n)}.mp4`);
    expect(() => firstFreeNumber('x', ['.mp4'], taken)).toThrow(/taken/);
  });
});

describe('frame and sample arithmetic', () => {
  it('counts ceil(duration × fps) frames, ignoring float noise', () => {
    expect(renderFrameCount(2, 30)).toBe(60);
    expect(renderFrameCount(5.2, 30)).toBe(156);
    // 0.1 × 3 is 0.30000000000000004 in floating point: still 9 frames, not 10.
    expect(0.1 * 3 * 30).toBeGreaterThan(9);
    expect(renderFrameCount(0.1 * 3, 30)).toBe(9);
    expect(renderFrameCount(2.2 / 1.1, 30)).toBe(60);
    expect(renderFrameCount(5.21, 30)).toBe(157);
    expect(renderFrameCount(1 / 30, 30)).toBe(1);
    expect(renderFrameCount(0, 30)).toBe(1);
    expect(renderFrameCount(Number.NaN, 30)).toBe(1);
    expect(renderFrameCount(10, 60)).toBe(600);
    expect(() => renderFrameCount(1, 0)).toThrow();
  });

  it('matches the timeline of a composition (signature / speed × loops + tail)', () => {
    const timeline = { ...defaultTimeline(1), loops: 4, tailSec: 1.2 };
    expect(renderFrameCount(timelineDuration(2.2, timeline), 30)).toBe(300);
    const config = samplerConfigFor({ ...timeline, signatureStrength: 1.5 });
    expect(config).toEqual({
      speed: 1,
      loops: 4,
      tailSec: 1.2,
      loopMode: 'loop',
      smoothing: 0.2,
      strength: 1.5,
    });
  });

  it('gives frame i the timestamp i / fps and a duration of 1 / fps', () => {
    expect(frameTime(0, 30)).toBe(0);
    expect(frameTime(45, 30)).toBe(1.5);
    expect(frameDuration(30)).toBeCloseTo(1 / 30, 12);
    expect(frameDuration(60)).toBeCloseTo(1 / 60, 12);
  });

  it('steps the simulation exactly 2 steps per frame at 30 fps and 1 at 60 fps', () => {
    for (let i = 0; i < 600; i++) {
      expect(stepsForTime(frameTime(i, 30))).toBe(2 * i);
      expect(stepsForTime(frameTime(i, 60))).toBe(i);
    }
  });

  it('covers the frames with exactly frames × rate / fps samples', () => {
    expect(audioSampleCount(60, 30)).toBe(96_000);
    expect(audioSampleCount(157, 30)).toBe(251_200);
    expect(audioSampleCount(157, 60)).toBe(125_600);
    expect(audioSampleCount(1, 30, 44_100)).toBe(1470);
    expect(RENDER_SAMPLE_RATE).toBe(48_000);
  });

  it('reserves enough packets for any codec', () => {
    expect(maxVideoPackets(300)).toBeGreaterThanOrEqual(300);
    // AAC needs ceil(n / 1024) (+ a few for priming); Opus ceil(n / 960).
    for (const samples of [1, 48_000, 480_000, 4_800_000]) {
      const bound = maxAudioPackets(samples);
      expect(bound).toBeGreaterThan(Math.ceil(samples / 960) + 4);
      expect(bound).toBeGreaterThan(Math.ceil(samples / 1024) + 4);
    }
  });

  it('feeds sound about a second ahead of the frames, in whole seconds', () => {
    const total = audioSampleCount(300, 30);
    expect(audioFeedTarget(0, 30, total)).toBe(48_000);
    expect(audioFeedTarget(1, 30, total)).toBe(96_000);
    expect(audioFeedTarget(30, 30, total)).toBe(96_000);
    expect(audioFeedTarget(31, 30, total)).toBe(144_000);
    expect(audioFeedTarget(299, 30, total)).toBe(total);
    expect(audioFeedTarget(0, 30, 1000)).toBe(1000);
    for (let i = 1; i < 300; i++) {
      expect(audioFeedTarget(i, 30, total)).toBeGreaterThanOrEqual(
        audioFeedTarget(i - 1, 30, total),
      );
      // Always at least the frame's own time is covered.
      expect(audioFeedTarget(i, 30, total)).toBeGreaterThanOrEqual(
        Math.min(total, ((i + 1) / 30) * 48_000),
      );
    }
  });
});
