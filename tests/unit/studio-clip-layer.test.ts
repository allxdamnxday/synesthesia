import { beforeEach, describe, expect, it } from 'vitest';
import type { PropertyDef } from '../../src/materials/types';
import { createSampler } from '../../src/signature/sampler';
import type { LoopMode, SamplerConfig } from '../../src/signature/types';
import {
  clearVisitClips,
  clipForVisit,
  forgetVisitClip,
  keepClipForVisit,
} from '../../src/state/visitClips';
import {
  clipLayerGeometry,
  clipTimeAt,
  FITTED_RANGE,
  FOLLOW_MAX_NUDGE,
  FOLLOW_TOLERANCE_SEC,
  planClipFollow,
  projectionRange,
  signatureMomentAt,
  type ClipFollowInput,
  type ClipShape,
} from '../../src/studio/clipLayerMath';
import { makeSignature } from './helpers/signatureFactory';

const config = (
  speed: number,
  loops: number,
  loopMode: LoopMode = 'loop',
): Pick<SamplerConfig, 'speed' | 'loops' | 'loopMode'> => ({ speed, loops, loopMode });

describe('the moment of the signature at the playhead', () => {
  // One pass of 2 s.
  const d = 2;

  it('runs forwards through one pass, then rests where the movement ended', () => {
    expect(signatureMomentAt(0, config(1, 1), d)).toEqual({ s: 0, direction: 1 });
    expect(signatureMomentAt(0.5, config(1, 1), d)).toEqual({ s: 0.5, direction: 1 });
    expect(signatureMomentAt(2, config(1, 1), d)).toEqual({ s: 2, direction: 0 });
    expect(signatureMomentAt(4.5, config(1, 1), d)).toEqual({ s: 2, direction: 0 });
  });

  it('rests at the start before the timeline begins, and for an empty signature', () => {
    expect(signatureMomentAt(-1, config(1, 1), d)).toEqual({ s: 0, direction: 0 });
    expect(signatureMomentAt(Number.NaN, config(1, 1), d)).toEqual({ s: 0, direction: 0 });
    expect(signatureMomentAt(1, config(1, 1), 0)).toEqual({ s: 0, direction: 0 });
  });

  it('covers the signature faster or slower with speed', () => {
    expect(signatureMomentAt(0.5, config(2, 1), d)).toEqual({ s: 1, direction: 1 });
    expect(signatureMomentAt(1, config(2, 1), d)).toEqual({ s: 2, direction: 0 });
    expect(signatureMomentAt(4, config(0.25, 1), d)).toEqual({ s: 1, direction: 1 });
  });

  it('starts again on every loop', () => {
    expect(signatureMomentAt(2.5, config(1, 3), d)).toEqual({ s: 0.5, direction: 1 });
    expect(signatureMomentAt(5.5, config(1, 3), d)).toEqual({ s: 1.5, direction: 1 });
    expect(signatureMomentAt(6, config(1, 3), d)).toEqual({ s: 2, direction: 0 });
  });

  it('plays odd passes backwards in back-and-forth, and rests where the last pass ended', () => {
    expect(signatureMomentAt(2.5, config(1, 2, 'pingpong'), d)).toEqual({ s: 1.5, direction: -1 });
    expect(signatureMomentAt(4, config(1, 2, 'pingpong'), d)).toEqual({ s: 0, direction: 0 });
    expect(signatureMomentAt(4.5, config(1, 3, 'pingpong'), d)).toEqual({ s: 0.5, direction: 1 });
    expect(signatureMomentAt(9, config(1, 3, 'pingpong'), d)).toEqual({ s: 2, direction: 0 });
  });

  it('agrees with the sampler about which frame is playing', () => {
    // centroidX climbs by 1 per frame, so the sampler's value is the frame position.
    const frameRate = 10;
    const frameCount = 20;
    const signature = makeSignature({ frameRate, frameCount, features: { centroidX: (f) => f } });
    const lastFrame = (frameCount - 1) / frameRate;
    for (const speed of [0.5, 1, 2]) {
      for (const loops of [1, 2, 3]) {
        for (const loopMode of ['loop', 'pingpong'] as const) {
          const sampler = createSampler(signature, {
            speed,
            loops,
            loopMode,
            tailSec: 1,
            smoothing: 0,
            strength: 1,
          });
          for (let t = 0; t <= sampler.duration; t += 0.0625) {
            const moment = signatureMomentAt(t, sampler.config, sampler.signatureDuration);
            const frame = sampler.sample(t);
            // The sampler holds the last frame for the final 1 / frameRate of a pass.
            expect(frame.features.centroidX / frameRate).toBeCloseTo(
              Math.min(moment.s, lastFrame),
              9,
            );
            expect(moment.direction === 0).toBe(frame.inTail);
          }
        }
      }
    }
  });
});

describe('the clip time for a moment of the signature', () => {
  const trim = { startSec: 1, endSec: 3 };

  it('is the trim start, plus the moment, plus the frame the movement arrives in', () => {
    expect(clipTimeAt(0, trim, 30, 30)).toBeCloseTo(1 + 1 / 30 + 1e-3, 9);
    expect(clipTimeAt(0.5, trim, 30, 30)).toBeCloseTo(1.5 + 1 / 30 + 1e-3, 9);
  });

  it('stays on the last frame of the trim at the end of the movement', () => {
    expect(clipTimeAt(2, trim, 30, 30)).toBeCloseTo(3 - 1 / 30 + 1e-3, 9);
    expect(clipTimeAt(5, trim, 30, 60)).toBeCloseTo(3 - 1 / 60 + 1e-3, 9);
  });
});

describe('keeping the clip in step', () => {
  const base: ClipFollowInput = {
    target: 2,
    currentTime: 2,
    ended: false,
    playing: true,
    direction: 1,
    speed: 1,
    nativeFps: 30,
  };

  it('lets the clip run at the composition’s speed while it is in step', () => {
    expect(planClipFollow(base)).toEqual({ run: true, rate: 1, seekTo: null });
    expect(planClipFollow({ ...base, speed: 0.5, currentTime: 2.01 })).toEqual({
      run: true,
      rate: 0.5,
      seekTo: null,
    });
  });

  it('eases it faster when behind and slower when ahead, within a limit', () => {
    const behind = planClipFollow({ ...base, currentTime: 1.96 });
    expect(behind.seekTo).toBeNull();
    expect(behind.rate).toBeCloseTo(1.06, 9);
    const ahead = planClipFollow({ ...base, currentTime: 2.04, speed: 2 });
    expect(ahead.rate).toBeCloseTo(2 * 0.94, 9);
    const far = planClipFollow({ ...base, currentTime: 2 - FOLLOW_TOLERANCE_SEC + 0.01 });
    expect(far.rate).toBeCloseTo(1 + FOLLOW_MAX_NUDGE, 9);
  });

  it('moves it outright when it is far out (a loop coming round, a seek)', () => {
    expect(planClipFollow({ ...base, target: 0.5 })).toEqual({ run: true, rate: 1, seekTo: 0.5 });
  });

  it('holds the exact frame when paused or at rest', () => {
    expect(planClipFollow({ ...base, playing: false })).toEqual({
      run: false,
      rate: 1,
      seekTo: null,
    });
    expect(planClipFollow({ ...base, playing: false, currentTime: 2.03 })).toEqual({
      run: false,
      rate: 1,
      seekTo: 2,
    });
    expect(planClipFollow({ ...base, direction: 0, currentTime: 1.9 }).seekTo).toBe(2);
  });

  it('steps frame by frame on a backwards pass, where a clip cannot run', () => {
    expect(planClipFollow({ ...base, direction: -1, currentTime: 2.05 })).toEqual({
      run: false,
      rate: 1,
      seekTo: 2,
    });
  });

  it('leaves a clip that reached the end of its file on its last frame', () => {
    expect(planClipFollow({ ...base, ended: true, currentTime: 2.02 })).toEqual({
      run: false,
      rate: 1,
      seekTo: null,
    });
    // The loop came round: it goes back and runs again.
    expect(planClipFollow({ ...base, ended: true, target: 0.1 })).toEqual({
      run: true,
      rate: 1,
      seekTo: 0.1,
    });
  });
});

describe('where the clip sits over the wake', () => {
  const landscape: ClipShape = {
    width: 320,
    height: 180,
    rotate: 0,
    mirror: false,
    focusArea: null,
  };
  const grid = { cols: 32, rows: 18 };

  it('covers a canvas of its own shape exactly', () => {
    expect(clipLayerGeometry(1600, 900, landscape, grid, 0.5)).toEqual({
      frame: { left: 0, top: 0, width: 1600, height: 900 },
      video: { width: 1600, height: 900 },
      transform: 'none',
    });
  });

  it('is fitted inside a canvas of another shape, never stretched', () => {
    const g = clipLayerGeometry(900, 900, landscape, grid, 0.5);
    expect(g.frame.left).toBeCloseTo(0, 9);
    expect(g.frame.width).toBeCloseTo(900, 9);
    expect(g.frame.height).toBeCloseTo(506.25, 9);
    expect(g.frame.top).toBeCloseTo((900 - 506.25) / 2, 9);
  });

  it('grows and shrinks about the centre with the material’s Range', () => {
    const wide = clipLayerGeometry(1600, 900, landscape, grid, 1);
    expect(wide.frame.width).toBeCloseTo(4000, 6);
    expect(wide.frame.height).toBeCloseTo(2250, 6);
    expect(wide.frame.left).toBeCloseTo(-1200, 6);
    expect(wide.frame.top).toBeCloseTo(-675, 6);
    const small = clipLayerGeometry(1600, 900, landscape, grid, 0);
    expect(small.frame.width).toBeCloseTo(640, 6);
    expect(small.frame.left).toBeCloseTo(480, 6);
    expect(small.frame.top).toBeCloseTo(270, 6);
  });

  it('puts the focus area, not the whole clip, on the movement’s rectangle', () => {
    // A box 60% wide and 50% tall: 192 × 90 pixels of the clip, read as a 32 × 15 field.
    const focusArea = { x: 0.2, y: 0.25, w: 0.6, h: 0.5 };
    const g = clipLayerGeometry(
      1600,
      900,
      { ...landscape, focusArea },
      { cols: 32, rows: 15 },
      0.5,
    );
    // The field is wider than the canvas: full width, 750 tall, 75 from the top.
    expect(g.frame.width).toBeCloseTo(1600 / 0.6, 6);
    expect(g.frame.height).toBeCloseTo(750 / 0.5, 6);
    // The box's own corners land on the field's corners.
    expect(g.frame.left + focusArea.x * g.frame.width).toBeCloseTo(0, 6);
    expect(g.frame.top + focusArea.y * g.frame.height).toBeCloseTo(75, 6);
    expect(g.frame.left + (focusArea.x + focusArea.w) * g.frame.width).toBeCloseTo(1600, 6);
    expect(g.frame.top + (focusArea.y + focusArea.h) * g.frame.height).toBeCloseTo(825, 6);
  });

  it('turns and mirrors the clip as extraction did', () => {
    const turned = clipLayerGeometry(
      900,
      900,
      { ...landscape, rotate: 90 },
      { cols: 18, rows: 32 },
      0.5,
    );
    // A quarter turn makes the clip portrait; the video's own box is the frame turned back.
    expect(turned.frame.width).toBeCloseTo(506.25, 9);
    expect(turned.frame.height).toBeCloseTo(900, 9);
    expect(turned.video.width).toBeCloseTo(900, 9);
    expect(turned.video.height).toBeCloseTo(506.25, 9);
    expect(turned.transform).toBe('rotate(90deg)');
    expect(clipLayerGeometry(1600, 900, { ...landscape, mirror: true }, grid, 0.5).transform).toBe(
      'scaleX(-1)',
    );
    expect(
      clipLayerGeometry(1600, 900, { ...landscape, rotate: 180, mirror: true }, grid, 0.5)
        .transform,
    ).toBe('scaleX(-1) rotate(180deg)');
  });

  it('survives a clip or a layer without a size', () => {
    const g = clipLayerGeometry(0, 0, { ...landscape, width: 0, height: 0 }, grid, 0.5);
    expect(Object.values(g.frame).every(Number.isFinite)).toBe(true);
    expect(Object.values(g.video).every(Number.isFinite)).toBe(true);
  });
});

describe('the Range the movement is projected with', () => {
  const range: PropertyDef = {
    id: 'range',
    label: 'Range',
    description: '',
    kind: 'continuous',
    shared: true,
    default: 0.5,
    primary: false,
  };

  it('is the visual material’s Range, or its baseline', () => {
    expect(projectionRange({ range: 0.8 }, { properties: [range] })).toBe(0.8);
    expect(projectionRange({}, { properties: [{ ...range, default: 0.3 }] })).toBe(0.3);
    expect(projectionRange({ range: 4 }, { properties: [range] })).toBe(1);
  });

  it('is the fitted size for a material without one, or one that is missing', () => {
    expect(projectionRange({ range: 0.9 }, { properties: [] })).toBe(FITTED_RANGE);
    expect(projectionRange({ range: 0.9 }, undefined)).toBe(FITTED_RANGE);
  });
});

describe('the clips of this visit', () => {
  beforeEach(clearVisitClips);

  it('are kept by signature, and only until they are let go', () => {
    const file = new File(['clip'], 'wink.mp4', { type: 'video/mp4' });
    expect(clipForVisit('abc')).toBeNull();
    keepClipForVisit('abc', file);
    expect(clipForVisit('abc')).toBe(file);
    expect(clipForVisit('other')).toBeNull();
    forgetVisitClip('abc');
    expect(clipForVisit('abc')).toBeNull();
  });
});
