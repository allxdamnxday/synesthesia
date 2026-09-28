import { describe, expect, it } from 'vitest';
import { defaultTimeline } from '../../src/engine/composition';
import { createComposition } from '../../src/engine/compositionFactory';
import { WATER_SOUND_META } from '../../src/materials/sound/water/meta';
import { WATER_META } from '../../src/materials/visual/water/WaterMaterial';
import { WallClock } from '../../src/studio/clock';
import { backingSize, fitAspect, pixelRatioFor } from '../../src/studio/layout';
import { peakFrame, peakMomentTime, thumbnailTime } from '../../src/studio/moments';
import { resolvePreviewQuality } from '../../src/studio/quality';
import { CatchUpBudget } from '../../src/studio/stepBudget';
import {
  freshComposition,
  restorableComposition,
  saveAsNewName,
  workingKey,
  workingRecord,
} from '../../src/studio/working';

function fakeTime() {
  let ms = 1000;
  return { now: () => ms, advance: (d: number) => (ms += d) };
}

describe('wall clock', () => {
  it('plays, pauses and seeks in composition seconds', () => {
    const time = fakeTime();
    const clock = new WallClock({ duration: () => 10, nowMs: time.now });
    expect(clock.now()).toBe(0);
    clock.play();
    time.advance(1500);
    expect(clock.now()).toBeCloseTo(1.5);
    clock.pause();
    time.advance(5000);
    expect(clock.now()).toBeCloseTo(1.5);
    clock.seek(4);
    expect(clock.now()).toBe(4);
    clock.play();
    time.advance(250);
    expect(clock.now(time.now())).toBeCloseTo(4.25);
    clock.seek(2);
    time.advance(100);
    expect(clock.now()).toBeCloseTo(2.1);
    expect(clock.playing).toBe(true);
  });

  it('stops at the end without Loop, then plays again from the start', () => {
    const time = fakeTime();
    let ended = 0;
    const clock = new WallClock({ duration: () => 2, nowMs: time.now, onEnded: () => ended++ });
    clock.play();
    time.advance(2500);
    expect(clock.now()).toBe(2);
    expect(clock.playing).toBe(false);
    expect(ended).toBe(1);
    clock.play();
    time.advance(100);
    expect(clock.now()).toBeCloseTo(0.1);
  });

  it('wraps to the start with Loop on, keeping the overshoot', () => {
    const time = fakeTime();
    const clock = new WallClock({ duration: () => 2, nowMs: time.now });
    clock.setLoop(true);
    clock.play();
    time.advance(2300);
    expect(clock.now()).toBeCloseTo(0.3);
    time.advance(500);
    expect(clock.now()).toBeCloseTo(0.8);
    expect(clock.playing).toBe(true);
  });

  it('keeps the playhead inside a shorter timeline', () => {
    let duration = 10;
    const clock = new WallClock({ duration: () => duration, nowMs: fakeTime().now });
    clock.seek(8);
    duration = 5;
    clock.timelineChanged();
    expect(clock.now()).toBe(5);
    clock.seek(99);
    expect(clock.now()).toBe(5);
  });
});

describe('canvas layout', () => {
  it('letterboxes the render aspect in the host', () => {
    expect(fitAspect(1000, 1000, 16 / 9)).toEqual({ left: 0, top: 219, width: 1000, height: 562 });
    expect(fitAspect(1600, 500, 16 / 9)).toEqual({ left: 356, top: 0, width: 888, height: 500 });
    expect(fitAspect(800, 600, 1)).toEqual({ left: 100, top: 0, width: 600, height: 600 });
    expect(fitAspect(0, 0, 16 / 9).width).toBe(1);
  });

  it('caps the pixel ratio by tier so Retina screens stay smooth', () => {
    expect(pixelRatioFor(2, 'draft')).toBe(1);
    expect(pixelRatioFor(2, 'standard')).toBe(1.5);
    expect(pixelRatioFor(2, 'high')).toBe(2);
    expect(pixelRatioFor(1, 'high')).toBe(1);
    expect(backingSize(800, 450, 2, 'standard')).toEqual({ width: 1200, height: 675 });
    expect(backingSize(800, 450, Number.NaN, 'high')).toEqual({ width: 800, height: 450 });
  });
});

describe('catch-up budget', () => {
  it('grows while frames are smooth and halves when they stutter', () => {
    const b = new CatchUpBudget({ min: 8, max: 600, initial: 30 });
    expect(b.steps).toBe(30);
    b.update(16);
    expect(b.steps).toBe(40);
    for (let i = 0; i < 60; i++) b.update(16);
    expect(b.steps).toBe(600);
    b.update(100);
    expect(b.steps).toBe(300);
    for (let i = 0; i < 20; i++) b.update(100);
    expect(b.steps).toBe(8);
    b.update(33);
    expect(b.steps).toBe(8);
    b.reset();
    expect(b.steps).toBe(30);
  });
});

describe('preview quality', () => {
  it('uses the chosen tier, else the stored benchmark, else asks to measure', () => {
    const bench = {
      tier: 'high' as const,
      fpsByTier: { draft: 60, standard: 60, high: 45 },
      measuredAt: '2026-09-28T00:00:00.000Z',
    };
    expect(resolvePreviewQuality({ previewQuality: 'draft', benchmark: bench })).toBe('draft');
    expect(resolvePreviewQuality({ previewQuality: 'auto', benchmark: bench })).toBe('high');
    expect(resolvePreviewQuality({ previewQuality: 'auto', benchmark: null })).toBeNull();
  });
});

describe('moments', () => {
  const signature = { frameRate: 30, features: { energy: [0, 0.2, 0.9, 0.9, 0.1] } } as never;

  it('finds the strongest movement in the first pass', () => {
    expect(peakFrame([0, 0.2, 0.9, 0.9, 0.1])).toBe(2);
    expect(peakFrame([])).toBe(0);
    expect(peakMomentTime(signature, { speed: 1 })).toBeCloseTo(2 / 30);
    expect(peakMomentTime(signature, { speed: 0.5 })).toBeCloseTo(4 / 30);
  });

  it('takes the thumbnail just after it, inside the timeline', () => {
    expect(thumbnailTime(signature, { speed: 1 }, 10)).toBeCloseTo(2 / 30 + 0.25);
    expect(thumbnailTime(signature, { speed: 1 }, 0.1)).toBe(0.1);
  });
});

describe('working state', () => {
  const sig = { id: 's1', name: 'Wink', contentHash: 'b'.repeat(64), preferredSpeed: 5 };
  const fresh = freshComposition({
    id: 'c9',
    now: '2026-09-28T12:00:00.000Z',
    seed: 42,
    signature: sig,
    visual: WATER_META,
    sound: WATER_SOUND_META,
    render: { width: 1280, height: 720, fps: 30 },
  });

  it('starts new compositions at baseline with a plain name and a safe speed', () => {
    expect(fresh.name).toBe('Wink · Water and Water');
    expect(fresh.timeline).toEqual({ ...defaultTimeline(2) });
    expect(fresh.linked).toBe(true);
    expect(fresh.chance).toBeNull();
    expect(fresh.status).toBe('draft');
    expect(fresh.render).toEqual({ width: 1280, height: 720, fps: 30 });
  });

  it('keys autosaves per composition, or per signature for new work', () => {
    expect(workingKey({ kind: 'composition', compositionId: 'c9' })).toBe('studio:composition:c9');
    expect(workingKey({ kind: 'new', signatureId: 's1' })).toBe('studio:new:s1');
  });

  it('restores only a well-formed record for the same composition or signature', () => {
    const record = workingRecord(fresh, '2026-09-28T12:00:01.000Z');
    expect(restorableComposition(record, { kind: 'new', signatureId: 's1' })).toEqual(fresh);
    expect(restorableComposition(record, { kind: 'new', signatureId: 'other' })).toBeNull();
    expect(restorableComposition(record, { kind: 'composition', compositionId: 'c9' })).toEqual(
      fresh,
    );
    expect(restorableComposition(record, { kind: 'composition', compositionId: 'x' })).toBeNull();
    expect(
      restorableComposition({ ...record, kind: 'other' }, { kind: 'new', signatureId: 's1' }),
    ).toBeNull();
    const broken = { ...record, composition: { ...fresh, seed: -1 } };
    expect(restorableComposition(broken, { kind: 'new', signatureId: 's1' })).toBeNull();
    expect(restorableComposition(undefined, { kind: 'new', signatureId: 's1' })).toBeNull();
  });

  it('names a saved copy like the Library’s Duplicate', () => {
    expect(saveAsNewName('Wink 01')).toBe('Wink 01 copy');
    expect(saveAsNewName('x'.repeat(200))).toHaveLength(120);
  });

  it('a fresh composition passes the library’s checks', () => {
    const c = createComposition({
      id: 'c1',
      now: '2026-09-28T12:00:00.000Z',
      name: 'n',
      signature: { ...sig, preferredSpeed: 1 },
      seed: 1,
      visual: WATER_META,
      sound: WATER_SOUND_META,
      render: { width: 1920, height: 1080, fps: 30 },
    });
    expect(restorableComposition(workingRecord(c, ''), { kind: 'new', signatureId: 's1' })).toEqual(
      c,
    );
  });
});
