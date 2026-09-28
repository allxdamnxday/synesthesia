import { describe, expect, it } from 'vitest';
import {
  MAX_FRAME_SEC,
  PlaybackClock,
  type FrameScheduler,
} from '../../src/screens/Signature/playbackClock';

/** A scheduler driven by hand: `frame(ms)` runs the pending callback at that time. */
function manualScheduler() {
  let next = 1;
  const pending = new Map<number, (now: number) => void>();
  const scheduler: FrameScheduler = {
    request(callback) {
      const id = next++;
      pending.set(id, callback);
      return id;
    },
    cancel(id) {
      pending.delete(id);
    },
  };
  return {
    scheduler,
    pending: () => pending.size,
    frame(now: number) {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const cb of callbacks) cb(now);
    },
  };
}

describe('signature playback clock', () => {
  it('advances with the wall clock while playing and attached', () => {
    const s = manualScheduler();
    const clock = new PlaybackClock(2, { playing: true, scheduler: s.scheduler });
    expect(s.pending()).toBe(0); // nothing runs until attached
    clock.attach();
    s.frame(1000); // first frame only sets the reference time
    expect(clock.getTime()).toBe(0);
    s.frame(1016);
    expect(clock.getTime()).toBeCloseTo(0.016, 9);
    s.frame(1516);
    expect(clock.getTime()).toBeCloseTo(0.116, 9); // capped: at most MAX_FRAME_SEC per frame
    expect(MAX_FRAME_SEC).toBe(0.1);
  });

  it('loops back to the start, or stops at the end when not looping', () => {
    const s = manualScheduler();
    const clock = new PlaybackClock(0.15, { playing: true, scheduler: s.scheduler });
    clock.attach();
    s.frame(0);
    s.frame(100);
    s.frame(200); // 0.2 s → wraps to 0.05
    expect(clock.getTime()).toBeCloseTo(0.05, 9);
    clock.setLoop(false);
    s.frame(300); // 0.15 → end
    expect(clock.getTime()).toBe(0.15);
    expect(clock.isPlaying()).toBe(false);
    expect(s.pending()).toBe(0);
    clock.play(); // playing from the end starts over
    expect(clock.getTime()).toBe(0);
    expect(clock.isPlaying()).toBe(true);
  });

  it('pauses, seeks within the timeline, and notifies listeners', () => {
    const s = manualScheduler();
    const clock = new PlaybackClock(3, { scheduler: s.scheduler });
    let calls = 0;
    const unsubscribe = clock.subscribe(() => calls++);
    clock.attach();
    expect(s.pending()).toBe(0); // paused: no frames requested
    clock.seek(5);
    expect(clock.getTime()).toBe(3);
    clock.seek(-1);
    expect(clock.getTime()).toBe(0);
    clock.toggle();
    expect(clock.isPlaying()).toBe(true);
    expect(s.pending()).toBe(1);
    clock.pause();
    expect(s.pending()).toBe(0);
    expect(calls).toBe(4);
    unsubscribe();
    clock.seek(1);
    expect(calls).toBe(4);
  });

  it('keeps its place in the movement when the timeline length changes', () => {
    const clock = new PlaybackClock(4, { scheduler: manualScheduler().scheduler });
    clock.seek(1);
    const epoch = clock.getEpoch();
    clock.setDuration(2); // twice the speed: a quarter of the way through stays a quarter
    expect(clock.getTime()).toBeCloseTo(0.5, 12);
    expect(clock.getDuration()).toBe(2);
    expect(clock.getEpoch()).toBe(epoch + 1);
  });

  it('stops requesting frames when detached, and resumes when attached again', () => {
    const s = manualScheduler();
    const clock = new PlaybackClock(2, { playing: true, scheduler: s.scheduler });
    clock.attach();
    expect(s.pending()).toBe(1);
    clock.detach();
    expect(s.pending()).toBe(0);
    expect(clock.isPlaying()).toBe(true);
    clock.attach();
    expect(s.pending()).toBe(1);
  });
});
