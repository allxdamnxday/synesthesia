/**
 * The looping signature preview shared by Prepare's Signature view and the Signature screen:
 *
 * - `useSignaturePlayback(signature, speed)` makes the sampler and the playhead clock.
 * - `WakeCanvas` plays a visual material (the V0 "Signature" view by default) on its own
 *   WebGL2 canvas, stepped in fixed 1/60 s steps by VisualRunner to the clock's time.
 * - `SignatureTransport` is the play / loop / scrub bar for the same clock.
 * - `SignatureSparklines` (its own file) draws the features with the same playhead.
 *
 * Only movement data is used here; nothing of the source clip (SPEC C7).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { VisualRunner, stepsForTime } from '../../engine/visualRunner';
import { visualRng, visualSeed } from '../../engine/seeds';
import { baselineValues } from '../../materials/properties';
import { SIGNATURE_VIEW_ID, getVisualMaterial } from '../../materials/registry';
import type { PropertyValues, Quality, VisualMaterial } from '../../materials/types';
import { getVisualContext, releaseVisualContext } from '../../materials/visual/shared/gl';
import type { SignatureBody } from '../../signature/extractClient';
import { createSampler } from '../../signature/sampler';
import type { SamplerConfig, SignatureSampler } from '../../signature/types';
import type { SliderPhase } from '../../ui/Slider';
import { Transport } from '../../ui/Transport';
import { PlaybackClock } from './playbackClock';
import styles from './SignaturePreview.module.css';

/** How a preview plays: one pass, looping, no tail, no extra smoothing, full strength. */
const PREVIEW_CONFIG: Partial<SamplerConfig> = {
  speed: 1,
  loops: 1,
  tailSec: 0,
  loopMode: 'loop',
  smoothing: 0,
  strength: 1,
};

/** The preview's seed; the Signature view has no randomness, but materials require one. */
const PREVIEW_SEED = 0;
/** Most simulation steps per animation frame; more are spread over the next frames. */
const MAX_STEPS_PER_FRAME = 240;
/** Canvas backing resolution cap (device pixels per CSS pixel). */
const MAX_PIXEL_RATIO = 2;

export interface SignaturePlayback {
  sampler: SignatureSampler;
  clock: PlaybackClock;
  /** Length of one loop at the current speed, seconds. */
  duration: number;
  /** When the onsets happen at the current speed, seconds. */
  onsetTimes: readonly number[];
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

const noSubscription = () => () => undefined;
const zero = () => 0;

/**
 * Sampler and playhead for a signature preview (null while there is no signature).
 * Playback starts on its own unless the person prefers reduced motion (or `autoplay` is
 * false). Changing `speed` keeps the playhead at the same place in the movement; a new
 * signature starts a fresh playhead.
 */
export function useSignaturePlayback(
  signature: SignatureBody,
  speed: number,
  options?: { autoplay?: boolean },
): SignaturePlayback;
export function useSignaturePlayback(
  signature: SignatureBody | null,
  speed: number,
  options?: { autoplay?: boolean },
): SignaturePlayback | null;
export function useSignaturePlayback(
  signature: SignatureBody | null,
  speed: number,
  options: { autoplay?: boolean } = {},
): SignaturePlayback | null {
  const autoplay = options.autoplay ?? true;
  const core = useMemo(() => {
    if (!signature) return null;
    // The sampler reads only movement data; id, name and date don't matter here.
    const sampler = createSampler(
      { ...signature, id: '', name: '', createdAt: '' },
      PREVIEW_CONFIG,
    );
    const clock = new PlaybackClock(sampler.duration, {
      playing: autoplay && !prefersReducedMotion(),
      loop: true,
    });
    return { sampler, clock };
  }, [signature, autoplay]);

  // Before paint, so the first frame already plays at the right speed.
  useLayoutEffect(() => {
    if (!core || core.sampler.config.speed === speed) return;
    core.sampler.configure({ speed });
    core.clock.setDuration(core.sampler.duration);
  }, [core, speed]);

  useEffect(() => {
    if (!core) return;
    core.clock.attach();
    return () => core.clock.detach();
  }, [core]);

  const duration = useSyncExternalStore(
    core ? core.clock.subscribe : noSubscription,
    core ? core.clock.getDuration : zero,
  );
  const onsetTimes = useMemo(
    () => (core && duration > 0 ? core.sampler.onsetsBetween(0, duration) : []),
    [core, duration],
  );
  return core ? { sampler: core.sampler, clock: core.clock, duration, onsetTimes } : null;
}

type CanvasStatus = 'starting' | 'ready' | 'unavailable' | 'no-webgl' | 'failed' | 'lost';

const STATUS_MESSAGES: Partial<Record<CanvasStatus, string>> = {
  unavailable: "The Signature view isn't part of this version of the instrument.",
  'no-webgl':
    "This browser can't draw the wake because its graphics acceleration (WebGL2) is off. The Diagnostics page can show why.",
  failed:
    "The wake couldn't be drawn. Reload the page; if it keeps happening, the Diagnostics page can help.",
  lost: 'The graphics paused for a moment. The wake comes back on its own; if it doesn’t, reload the page.',
};

export interface WakeCanvasProps {
  playback: SignaturePlayback;
  /** Visual material to play; the diagnostic Signature view by default. */
  materialId?: string;
  /** Property values; the material's baseline by default. */
  materialProps?: PropertyValues;
  quality?: Quality;
  /** Describes the wake for screen readers. */
  label: string;
  className?: string;
}

/**
 * A visual material driven by the playback clock. The canvas is created in code for each
 * mount and its WebGL context is released on unmount (`releaseVisualContext`), so React's
 * StrictMode double mount and repeated visits never leak contexts. The surround is black.
 */
export function WakeCanvas({
  playback,
  materialId = SIGNATURE_VIEW_ID,
  materialProps,
  quality = 'standard',
  label,
  className,
}: WakeCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<CanvasStatus>('starting');
  const propsRef = useRef<PropertyValues | undefined>(materialProps);
  const applyPropsRef = useRef<(() => void) | null>(null);
  const { clock, sampler } = playback;

  useEffect(() => {
    propsRef.current = materialProps;
    applyPropsRef.current?.();
  }, [materialProps]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const entry = getVisualMaterial(materialId);
    if (!entry) {
      setStatus('unavailable');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.className = styles.canvas;
    canvas.dataset.wakeCanvas = materialId;
    canvas.setAttribute('aria-hidden', 'true');
    host.prepend(canvas);
    const gl = getVisualContext(canvas);
    if (!gl) {
      canvas.remove();
      setStatus('no-webgl');
      return;
    }
    setStatus('starting');

    const baseline = baselineValues(entry.meta.properties);
    const props = (): PropertyValues => ({ ...baseline, ...propsRef.current });
    let currentProps = props();
    let disposed = false;
    let generation = 0;
    let material: VisualMaterial | null = null;
    let runner: VisualRunner | null = null;
    let epoch = clock.getEpoch();
    let catchUp = 0;
    const seed = visualSeed(PREVIEW_SEED);

    const size = (): boolean => {
      const rect = host.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
      const width = Math.max(1, Math.round(rect.width * ratio));
      const height = Math.max(1, Math.round(rect.height * ratio));
      if (canvas.width === width && canvas.height === height) return false;
      canvas.width = width;
      canvas.height = height;
      return true;
    };

    /** Step to the clock's time (fixed steps; reset first if time went back) and draw. */
    const render = () => {
      if (disposed || !runner || gl.isContextLost()) return;
      const t = clock.getTime();
      const nextEpoch = clock.getEpoch();
      if (nextEpoch !== epoch || stepsForTime(t) < runner.steps) {
        epoch = nextEpoch;
        runner.reset();
      }
      runner.advanceTo(t, currentProps, MAX_STEPS_PER_FRAME);
      runner.draw();
      if (runner.stepsTo(t) > 0 && catchUp === 0) {
        catchUp = requestAnimationFrame(() => {
          catchUp = 0;
          render();
        });
      }
    };

    const start = () => {
      const mine = ++generation;
      const next = entry.create();
      size();
      next
        .init({
          gl,
          width: canvas.width,
          height: canvas.height,
          quality,
          seed,
          rng: visualRng(PREVIEW_SEED),
        })
        .then(() => {
          if (disposed || mine !== generation) {
            next.dispose();
            return;
          }
          material = next;
          runner = new VisualRunner(next, sampler, seed);
          runner.reset();
          epoch = clock.getEpoch();
          setStatus('ready');
          render();
        })
        .catch((error: unknown) => {
          next.dispose();
          if (disposed || mine !== generation) return;
          console.error('The wake could not be drawn:', error);
          setStatus('failed');
        });
    };

    const stop = () => {
      generation++;
      runner = null;
      material?.dispose();
      material = null;
      if (catchUp !== 0) cancelAnimationFrame(catchUp);
      catchUp = 0;
    };

    const observer = new ResizeObserver(() => {
      if (disposed) return;
      if (size()) material?.resize(canvas.width, canvas.height);
      // A resized canvas is blank until it is drawn again.
      render();
    });
    observer.observe(host);

    const onLost = (event: Event) => {
      event.preventDefault(); // ask the browser to restore the context
      stop();
      setStatus('lost');
    };
    const onRestored = () => {
      setStatus('starting');
      start();
    };
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);

    const unsubscribe = clock.subscribe(render);
    applyPropsRef.current = () => {
      currentProps = props();
      material?.setProperties?.(currentProps);
      runner?.draw();
    };
    start();

    return () => {
      disposed = true;
      applyPropsRef.current = null;
      unsubscribe();
      observer.disconnect();
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      stop();
      releaseVisualContext(gl);
      canvas.remove();
    };
  }, [clock, sampler, materialId, quality]);

  const message = STATUS_MESSAGES[status];
  return (
    <div
      ref={hostRef}
      className={[styles.wake, className].filter(Boolean).join(' ')}
      role="img"
      aria-label={label}
      data-status={status}
    >
      {message ? <p className={styles.message}>{message}</p> : null}
    </div>
  );
}

/** Play / pause, loop and scrub for a signature preview, with its onsets marked. */
export function SignatureTransport({ playback }: { playback: SignaturePlayback }) {
  const { clock } = playback;
  const position = useSyncExternalStore(clock.subscribe, clock.getTime);
  const playing = useSyncExternalStore(clock.subscribe, clock.isPlaying);
  const loop = useSyncExternalStore(clock.subscribe, clock.isLooping);
  const resume = useRef(false);

  const onSeek = (t: number, phase: SliderPhase) => {
    if (phase === 'start') {
      resume.current = clock.isPlaying();
      clock.pause();
    }
    clock.seek(t);
    if (phase === 'end' && resume.current) {
      resume.current = false;
      clock.play();
    }
  };

  return (
    <Transport
      playing={playing}
      onPlayPause={() => clock.toggle()}
      loop={loop}
      onLoopChange={(on) => clock.setLoop(on)}
      position={position}
      duration={playback.duration}
      onSeek={onSeek}
      markers={playback.onsetTimes}
    />
  );
}
