/**
 * Driving the Prepare clip's <video>.
 *
 * - `useClipPlayer` is the player while shaping the clip: play/pause, scrub and step one
 *   frame at a time. While it plays it loops inside the trim, so the playhead never leaves
 *   the part that will be extracted. The time it reports is the start of the frame showing.
 * - `useClipFollower` keeps the clip in step with the signature preview when the source is
 *   shown beside the wake after extraction.
 *
 * `requestVideoFrameCallback` reports each frame as it is presented, which is what keeps
 * the playhead and the trim loop frame-accurate.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createValueStore, type ValueStore } from '../../state/valueStore';
import type { PlaybackClock } from '../Signature/playbackClock';
import {
  clampPlayhead,
  clipTimeForSignature,
  frameDuration,
  frameStartAt,
  playheadRange,
  seekTimeFor,
  stepFrame,
  type Trim,
} from './trim';

export interface ClipPlayer {
  /** Start of the frame showing, seconds on the clip's timeline. */
  time: ValueStore<number>;
  playing: boolean;
  /** The clip's first frame can be shown. */
  ready: boolean;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  /** Show the frame at t (kept inside the trim). */
  seek: (t: number) => void;
  /** Move by whole frames (kept inside the trim). */
  step: (frames: number) => void;
}

export interface ClipPlayerOptions {
  /** Off while extracting and after extraction: the player leaves the video alone. */
  enabled: boolean;
  /** The current trim, read when needed (it can change between renders). */
  getTrim: () => Trim;
  fps: number;
  speed: number;
}

export function useClipPlayer(
  video: HTMLVideoElement | null,
  { enabled, getTrim, fps, speed }: ClipPlayerOptions,
): ClipPlayer {
  const [time] = useState(() => createValueStore(0));
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const pendingSeek = useRef<number | null>(null);
  const getTrimRef = useRef(getTrim);
  const enabledRef = useRef(enabled);
  useEffect(() => {
    getTrimRef.current = getTrim;
    enabledRef.current = enabled;
  });

  /** Show the frame starting at `frameStart`, coalescing requests while a seek is running. */
  const showFrame = useCallback(
    (frameStart: number) => {
      if (!video) return;
      time.set(frameStart);
      const target = seekTimeFor(frameStart, fps);
      if (video.seeking) {
        pendingSeek.current = target;
        return;
      }
      video.currentTime = target;
    },
    [video, time, fps],
  );

  // Events that matter whatever the mode.
  useEffect(() => {
    if (!video) return;
    const onReady = () => setReady(true);
    const onLoadStart = () => {
      // A new clip is loading: start again from its beginning.
      setReady(false);
      pendingSeek.current = null;
      time.set(0);
    };
    const onSeeked = () => {
      const next = pendingSeek.current;
      if (next === null) return;
      pendingSeek.current = null;
      video.currentTime = next;
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      // The trim reaches the clip's very end: go round again from the trim's start.
      if (!enabledRef.current) return;
      const trim = getTrimRef.current();
      video.currentTime = seekTimeFor(trim.startSec, fps);
      void video.play().catch(() => undefined);
    };
    video.addEventListener('loadstart', onLoadStart);
    video.addEventListener('loadeddata', onReady);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onEnded);
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) setReady(true);
    return () => {
      video.removeEventListener('loadstart', onLoadStart);
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onEnded);
    };
  }, [video, fps, time]);

  useEffect(() => {
    if (!video) return;
    video.defaultPlaybackRate = speed;
    video.playbackRate = speed;
  }, [video, speed]);

  // Follow presented frames while enabled: the playhead, and the loop inside the trim.
  useEffect(() => {
    if (!video || !enabled || !ready) return;
    let handle = 0;
    let active = true;
    const onFrame = (_now: number, meta: VideoFrameCallbackMetadata) => {
      if (!active) return;
      const trim = getTrimRef.current();
      const shown = frameStartAt(meta.mediaTime, fps);
      if (!video.paused) {
        const [, last] = playheadRange(trim, fps);
        if (video.seeking) {
          // Going round: wait for the start of the trim to arrive.
        } else if (shown >= last - 1e-6 || shown < trim.startSec - 1e-6) {
          // The last frame of the trim is showing (or the clip ran past it): loop.
          time.set(trim.startSec);
          video.currentTime = seekTimeFor(trim.startSec, fps);
        } else {
          time.set(shown);
        }
      } else if (!video.seeking && pendingSeek.current === null) {
        time.set(clampPlayhead(shown, trim, fps));
      }
      handle = video.requestVideoFrameCallback(onFrame);
    };
    handle = video.requestVideoFrameCallback(onFrame);
    return () => {
      active = false;
      video.cancelVideoFrameCallback(handle);
    };
  }, [video, enabled, ready, fps, time]);

  // When the player takes over (clip ready, or back from the signature view), start from
  // the frame the video is actually showing, inside the trim.
  useEffect(() => {
    if (!video || !enabled || !ready) return;
    const shown = frameStartAt(video.currentTime, fps);
    const clamped = clampPlayhead(shown, getTrimRef.current(), fps);
    time.set(shown);
    if (Math.abs(clamped - shown) > 1e-6) showFrame(clamped);
  }, [video, enabled, ready, fps, time, showFrame]);

  // Keep the playhead inside the trim when the trim changes.
  const { startSec, endSec } = getTrim();
  useEffect(() => {
    if (!video || !enabled || !ready) return;
    const current = time.get();
    const clamped = clampPlayhead(current, { startSec, endSec }, fps);
    if (Math.abs(clamped - current) > 1e-6) showFrame(clamped);
  }, [video, enabled, ready, fps, time, showFrame, startSec, endSec]);

  // Stop when the player hands over (extraction starts, or the signature view opens).
  useEffect(() => {
    if (!video || !enabled) return;
    return () => {
      video.pause();
    };
  }, [video, enabled]);

  const pause = useCallback(() => {
    if (!video) return;
    video.pause();
    // Settle exactly on a frame, so the time shown is the frame shown (for trimming).
    showFrame(clampPlayhead(frameStartAt(video.currentTime, fps), getTrimRef.current(), fps));
  }, [video, fps, showFrame]);

  const play = useCallback(() => {
    if (!video || !enabledRef.current) return;
    const trim = getTrimRef.current();
    const [, last] = playheadRange(trim, fps);
    const t = time.get();
    if (t >= last - 1e-6 || t < trim.startSec - 1e-6) showFrame(trim.startSec);
    void video.play().catch(() => undefined);
  }, [video, time, fps, showFrame]);

  const toggle = useCallback(() => {
    if (!video) return;
    if (video.paused) play();
    else pause();
  }, [video, play, pause]);

  const seek = useCallback(
    (t: number) => {
      showFrame(clampPlayhead(frameStartAt(t, fps), getTrimRef.current(), fps));
    },
    [showFrame, fps],
  );

  const step = useCallback(
    (frames: number) => {
      if (!video) return;
      if (!video.paused) video.pause();
      showFrame(stepFrame(time.get(), frames, getTrimRef.current(), fps));
    },
    [video, time, fps, showFrame],
  );

  return { time, playing, ready, play, pause, toggle, seek, step };
}

export interface ClipFollowerOptions {
  enabled: boolean;
  clock: PlaybackClock | null;
  trim: Trim;
  /** The signature's frame rate. */
  analysisFps: number;
  /** The clip's own frame rate. */
  nativeFps: number;
  speed: number;
}

/** Drift (seconds) tolerated while playing before the clip is put back in step. */
const FOLLOW_TOLERANCE_SEC = 0.15;

/**
 * Keep the clip showing the moment the signature preview is at (composition time × speed
 * is signature time; see clipTimeForSignature). While playing the clip runs at the same
 * speed and is re-seeked only when it drifts; while paused it shows the exact frame.
 */
export function useClipFollower(
  video: HTMLVideoElement | null,
  { enabled, clock, trim, analysisFps, nativeFps, speed }: ClipFollowerOptions,
): void {
  const { startSec, endSec } = trim;
  useEffect(() => {
    if (!video || !enabled || !clock) return;
    const range = { startSec, endSec };
    const halfFrame = 0.5 * frameDuration(nativeFps);
    const sync = () => {
      const signatureTime = clock.getTime() * speed;
      const target =
        clampPlayhead(clipTimeForSignature(signatureTime, range, analysisFps), range, nativeFps) +
        1e-3;
      if (video.playbackRate !== speed) video.playbackRate = speed;
      if (clock.isPlaying()) {
        if (Math.abs(video.currentTime - target) > FOLLOW_TOLERANCE_SEC) video.currentTime = target;
        if (video.paused) void video.play().catch(() => undefined);
      } else {
        if (!video.paused) video.pause();
        if (Math.abs(video.currentTime - target) > halfFrame) video.currentTime = target;
      }
    };
    sync();
    const unsubscribe = clock.subscribe(sync);
    return () => {
      unsubscribe();
      video.pause();
    };
  }, [video, enabled, clock, startSec, endSec, analysisFps, nativeFps, speed]);
}
