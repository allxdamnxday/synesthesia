/**
 * The Studio preview runtime (docs/ARCHITECTURE.md "Studio runtime"): one per open
 * composition. It owns the preview canvas and its WebGL2 context, the visual material
 * and its `VisualRunner`, the signature sampler shared with the sound engine, the sound
 * engine (./sound.ts), and the animation-frame loop.
 *
 * Each animation frame it asks the clock where the playhead is (the sound engine once its
 * material has loaded, otherwise the wall clock), steps the simulation up to that time
 * within a per-frame budget (never skipping steps), and draws. When the playhead moves
 * backwards (a loop wrap or a seek) the material is reset and fast-forwarded without
 * drawing, over as many frames as it takes; "Catching up…" shows if that takes more than
 * about half a second.
 *
 * `setComposition()` takes each new version of the working composition and rebuilds only
 * what changed: a different visual material or seed recreates the material and seeks it
 * to the playhead; global controls reconfigure the sampler and re-seek; property edits
 * apply from the next step (and redraw at once while paused). Snapshot recalls and undo
 * go through the same path, so they never restart playback.
 *
 * The same material code, `VisualRunner` and seed helpers drive the offline render: see
 * `renderStill()` for a one-frame example.
 */
import type { Composition, TimelineSettings } from '../engine/composition';
import { visualRng, visualSeed } from '../engine/seeds';
import { snapshotChanges } from '../engine/snapshots';
import { stepsForTime, VisualRunner } from '../engine/visualRunner';
import { getVisualMaterial } from '../materials/registry';
import type { PropertyValues, Quality, VisualMaterial } from '../materials/types';
import { getVisualContext, releaseVisualContext } from '../materials/visual/shared/gl';
import { renderOffscreen } from '../perf/offscreenRender';
import { createSampler } from '../signature/sampler';
import type { KineticSignature, SamplerConfig, SignatureSampler } from '../signature/types';
import { WallClock, type PlaybackClock } from './clock';
import { backingSize, fitAspect } from './layout';
import { StudioSound, type SoundProblem } from './sound';
import {
  CATCHING_UP_HINT_MS,
  CatchUpBudget,
  FAR_BEHIND_STEPS,
  FRAME_STEP_TIME_MS,
  LAG_STEPS,
  PLAY_STEPS_PER_FRAME,
} from './stepBudget';

export type { SoundProblem } from './sound';

export interface RuntimeTransport {
  playing: boolean;
  /** Playhead, seconds of composition time. */
  position: number;
  duration: number;
  /** The wake is fast-forwarding to the playhead (after a seek, or on a slow machine). */
  catchingUp: boolean;
}

export interface RuntimeTimeline {
  duration: number;
  /** When the movement ends and the wake settles. */
  tailStart: number;
  /** Composition times of onsets, across loops. */
  markers: number[];
}

/** Why the picture can't be shown. */
export type PictureProblem = 'no-webgl' | 'material-missing' | 'material-failed' | 'context-lost';

export interface RuntimeEvents {
  transport(state: RuntimeTransport): void;
  timeline(info: RuntimeTimeline): void;
  picture(problem: PictureProblem | null): void;
  sound(problem: SoundProblem | null): void;
}

export interface StudioRuntimeOptions {
  /** Element the canvas is placed in (letterboxed, centred). */
  host: HTMLElement;
  signature: KineticSignature;
  composition: Composition;
  quality: Quality;
  loop: boolean;
  events: RuntimeEvents;
  /** Play sound (default true). Without it the picture runs on the wall clock. */
  sound?: boolean;
}

export interface StillOptions {
  /** Composition time of the still. */
  t: number;
  width: number;
  height: number;
  quality?: Quality;
  type?: 'image/jpeg' | 'image/png' | 'image/webp';
  /** 0–1, for JPEG and WebP. */
  encoderQuality?: number;
}

/** The sampler configuration for a composition's timeline. */
export function samplerConfigOf(timeline: TimelineSettings): SamplerConfig {
  return {
    speed: timeline.speed,
    loops: timeline.loops,
    tailSec: timeline.tailSec,
    loopMode: timeline.loopMode,
    smoothing: timeline.smoothing,
    strength: timeline.signatureStrength,
  };
}

function sameValues(a: PropertyValues, b: PropertyValues): boolean {
  if (a === b) return true;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => Object.is(a[k], b[k]));
}

/** Emit the playhead at most this often while playing (the scrub bar looks smooth). */
const TRANSPORT_EMIT_MS = 40;

export class StudioRuntime {
  private readonly host: HTMLElement;
  private readonly events: RuntimeEvents;
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext | null;
  private readonly sampler: SignatureSampler;
  private readonly wallClock: WallClock;
  private readonly sound: StudioSound | null;
  private clock: PlaybackClock;
  private composition: Composition;
  private quality: Quality;
  private loop: boolean;

  private material: VisualMaterial | null = null;
  private runner: VisualRunner | null = null;
  private visualToken = 0;
  private contextLost = false;

  private raf = 0;
  private disposed = false;
  private lastFrameTs = 0;
  private seeking = false;
  private seekStartedTs = 0;
  private lagSinceTs = 0;
  private catchingUp = false;
  private needsDraw = false;
  /** A property changed since the last reset, so the state isn't what a render would show. */
  private dirtySinceReset = false;
  private readonly budget = new CatchUpBudget();
  private scrubResume = false;

  private lastEmitTs = 0;
  private lastEmitted: RuntimeTransport | null = null;
  private readonly resizeObserver: ResizeObserver | null;

  constructor(options: StudioRuntimeOptions) {
    this.host = options.host;
    this.events = options.events;
    this.composition = options.composition;
    this.quality = options.quality;
    this.loop = options.loop;
    this.sampler = createSampler(options.signature, samplerConfigOf(options.composition.timeline));
    this.wallClock = new WallClock({
      duration: () => this.sampler.duration,
      onEnded: () => this.wake(),
    });
    this.wallClock.setLoop(this.loop);
    this.clock = this.wallClock;

    const canvas = document.createElement('canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'The wake');
    canvas.dataset.testid = 'studio-canvas';
    Object.assign(canvas.style, { position: 'absolute', display: 'block' });
    this.canvas = canvas;
    this.host.append(canvas);
    this.layout();

    this.gl = getVisualContext(canvas);
    if (this.gl) {
      canvas.addEventListener('webglcontextlost', this.onContextLost);
      canvas.addEventListener('webglcontextrestored', this.onContextRestored);
    } else {
      this.events.picture('no-webgl');
    }

    this.sound =
      options.sound === false
        ? null
        : StudioSound.create(this.sampler, {
            ready: (ready) => {
              if (this.sound) this.switchClock(ready ? this.sound.clock : this.wallClock);
            },
            problem: (problem) => this.events.sound(problem),
            playFailed: () => this.switchClock(this.wallClock, true),
          });
    if (this.sound) {
      this.sound.engine.onEnded = () => this.wake();
      this.sound.clock.setLoop(this.loop);
      this.sound.apply(null, this.composition);
    } else if (options.sound !== false) {
      this.events.sound('no-audio');
    }

    this.applyVisualMute();
    this.emitTimeline();
    this.emitTransport(0, true);
    void this.mountVisual();

    this.resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.layout());
    this.resizeObserver?.observe(this.host);
    window.addEventListener('resize', this.onWindowResize);
  }

  // ---------------------------------------------------------------------------------------
  // Transport

  get playing(): boolean {
    return this.clock.playing;
  }

  get position(): number {
    return this.clock.now();
  }

  get duration(): number {
    return this.sampler.duration;
  }

  play(): void {
    if (this.disposed) return;
    this.sound?.resumeFromGesture();
    this.clock.play();
    this.wake();
    this.emitTransport(performance.now(), true);
  }

  pause(): void {
    if (this.disposed) return;
    this.clock.pause();
    this.wake();
    this.emitTransport(performance.now(), true);
  }

  togglePlay(): void {
    if (this.clock.playing) this.pause();
    else this.play();
  }

  setLoop(loop: boolean): void {
    this.loop = loop;
    this.wallClock.setLoop(loop);
    this.sound?.clock.setLoop(loop);
  }

  /** Move the playhead. The wake is reset and fast-forwarded to it without drawing. */
  seek(t: number): void {
    if (this.disposed) return;
    const target = Math.min(this.sampler.duration, Math.max(0, Number.isFinite(t) ? t : 0));
    this.clock.seek(target);
    this.seekVisualTo(target);
    this.wake();
    this.emitTransport(performance.now(), true);
  }

  /** Scrub with the playhead: playback holds during the drag and resumes after it. */
  scrub(t: number, phase: 'start' | 'change' | 'end'): void {
    if (phase === 'start') {
      this.scrubResume = this.clock.playing;
      if (this.scrubResume) this.clock.pause();
    }
    this.seek(t);
    if (phase === 'end' && this.scrubResume) {
      this.scrubResume = false;
      this.play();
    }
  }

  // ---------------------------------------------------------------------------------------
  // Composition and settings

  /** Take a new version of the working composition; rebuild only what changed. */
  setComposition(next: Composition): void {
    const prev = this.composition;
    if (this.disposed || prev === next) return;
    this.composition = next;

    // Rebuild only what changed (the same comparison snapshot recall relies on).
    const changes = snapshotChanges(prev, next);
    const timelineChanged = changes.timeline;
    if (timelineChanged) {
      this.sampler.configure(samplerConfigOf(next.timeline));
      this.sound?.timelineChanged();
      this.wallClock.timelineChanged();
      this.emitTimeline();
    }
    this.sound?.apply(prev, next);

    if (changes.visualMaterial || changes.seed) {
      void this.mountVisual();
    } else {
      if (!sameValues(prev.visual.properties, next.visual.properties)) {
        this.dirtySinceReset = true;
        if (!this.clock.playing && this.material) {
          this.material.setProperties?.(next.visual.properties);
          this.needsDraw = true;
        }
      }
      if (timelineChanged) this.reseekVisual();
    }
    if (prev.mute.visual !== next.mute.visual) this.applyVisualMute();
    if (prev.render.width !== next.render.width || prev.render.height !== next.render.height) {
      this.layout();
    }
    this.wake();
    this.emitTransport(performance.now(), true);
  }

  /** Change the preview quality tier (re-creates the material at the new tier). */
  setQuality(quality: Quality): void {
    if (this.disposed || quality === this.quality) return;
    this.quality = quality;
    this.layout();
    void this.mountVisual();
  }

  /**
   * Render a still of the current composition offscreen (its own canvas and context) with
   * fresh material instances, exactly as a render would at time `t`: e.g. the thumbnail.
   * Returns a data URL, or null when the visual material isn't installed.
   */
  async renderStill(options: StillOptions): Promise<string | null> {
    const c = this.composition;
    const entry = getVisualMaterial(c.visual.materialId);
    if (!entry) return null;
    const steps = stepsForTime(options.t);
    let url: string | null = null;
    await renderOffscreen({
      create: entry.create,
      sampler: this.sampler,
      steps,
      props: c.visual.properties,
      seed: visualSeed(c.seed),
      quality: options.quality ?? 'standard',
      width: options.width,
      height: options.height,
      onCapture: (step, canvas) => {
        if (step === steps) {
          url = canvas.toDataURL(options.type ?? 'image/jpeg', options.encoderQuality ?? 0.85);
        }
      },
    });
    return url;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.resizeObserver?.disconnect();
    window.removeEventListener('resize', this.onWindowResize);
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.visualToken++;
    this.disposeVisual();
    if (this.gl) releaseVisualContext(this.gl);
    this.canvas.remove();
    this.wallClock.dispose();
    this.sound?.dispose();
  }

  // ---------------------------------------------------------------------------------------
  // Visual material

  private async mountVisual(): Promise<void> {
    const token = ++this.visualToken;
    this.disposeVisual();
    const gl = this.gl;
    if (!gl || this.contextLost || this.disposed) return;
    const c = this.composition;
    const entry = getVisualMaterial(c.visual.materialId);
    if (!entry) {
      this.events.picture('material-missing');
      return;
    }
    const seed = visualSeed(c.seed);
    const material = entry.create();
    try {
      await material.init({
        gl,
        width: this.canvas.width,
        height: this.canvas.height,
        quality: this.quality,
        seed,
        rng: visualRng(c.seed),
      });
    } catch (error) {
      material.dispose();
      if (token === this.visualToken && !this.disposed) {
        console.warn(`The visual material "${entry.meta.id}" could not start:`, error);
        this.events.picture('material-failed');
      }
      return;
    }
    if (token !== this.visualToken || this.disposed || this.contextLost) {
      material.dispose();
      return;
    }
    this.material = material;
    const runner = new VisualRunner(material, this.sampler, seed);
    runner.reset();
    this.runner = runner;
    this.dirtySinceReset = false;
    material.setProperties?.(this.composition.visual.properties);
    this.events.picture(null);
    this.seekVisualTo(this.clock.now());
    this.wake();
  }

  private disposeVisual(): void {
    this.material?.dispose();
    this.material = null;
    this.runner = null;
    this.seeking = false;
    this.catchingUp = false;
  }

  /** Bring the wake to composition time t: reset and fast-forward unless it can go on. */
  private seekVisualTo(t: number): void {
    const runner = this.runner;
    if (!runner) return;
    // Going forward from an untouched state gives exactly what a reset would.
    if (this.dirtySinceReset || stepsForTime(t) < runner.steps) {
      runner.seek(t);
      this.dirtySinceReset = false;
    }
    if (runner.stepsTo(t) > 0) this.startCatchUp(performance.now());
    else this.needsDraw = true;
  }

  /** Something that alters the past changed (speed, loops, smoothing…): replay to the playhead. */
  private reseekVisual(): void {
    const runner = this.runner;
    if (!runner) return;
    runner.seek(this.clock.now());
    this.dirtySinceReset = false;
    this.startCatchUp(performance.now());
  }

  private startCatchUp(ts: number): void {
    if (!this.seeking) this.seekStartedTs = ts;
    this.seeking = true;
    this.lagSinceTs = 0;
  }

  private applyVisualMute(): void {
    const muted = this.composition.mute.visual;
    this.canvas.style.visibility = muted ? 'hidden' : 'visible';
    if (!muted) this.needsDraw = true;
    this.wake();
  }

  // ---------------------------------------------------------------------------------------
  // Frame loop

  private wake(): void {
    if (this.disposed || this.raf) return;
    this.raf = requestAnimationFrame(this.frame);
  }

  private readonly frame = (ts: number): void => {
    this.raf = 0;
    if (this.disposed) return;
    const interval = this.lastFrameTs > 0 ? ts - this.lastFrameTs : 16.7;
    this.lastFrameTs = ts;
    const t = this.clock.now(ts);
    this.advance(t, ts, interval);
    this.emitTransport(ts, false, t);
    if (this.clock.playing || this.seeking || (this.needsDraw && this.runner !== null)) {
      this.raf = requestAnimationFrame(this.frame);
    } else {
      this.lastFrameTs = 0;
    }
  };

  private advance(t: number, ts: number, interval: number): void {
    const runner = this.runner;
    if (!runner || !this.material || this.contextLost) return;
    const target = stepsForTime(t);
    if (runner.steps > target) {
      // The playhead went back (a loop wrap or a seek elsewhere): replay from the start.
      runner.seek(t);
      this.dirtySinceReset = false;
      this.startCatchUp(ts);
    } else if (!this.seeking && target - runner.steps > FAR_BEHIND_STEPS) {
      // Far behind (the tab was hidden): catch up without drawing, like a seek.
      this.startCatchUp(ts);
    }
    this.budget.update(interval);
    const limit = this.seeking ? this.budget.steps : PLAY_STEPS_PER_FRAME;
    const props = this.composition.visual.properties;
    const deadline = performance.now() + FRAME_STEP_TIME_MS;
    let taken = 0;
    while (taken < limit) {
      const chunk = Math.min(4, limit - taken);
      const n = runner.advanceTo(t, props, chunk);
      taken += n;
      if (n < chunk || performance.now() > deadline) break;
    }
    const behind = runner.stepsTo(t);
    if (this.seeking) {
      if (behind === 0) {
        this.seeking = false;
        this.catchingUp = false;
        this.needsDraw = true;
      } else if (ts - this.seekStartedTs > CATCHING_UP_HINT_MS) {
        this.catchingUp = true;
      }
    } else {
      if (taken > 0) this.needsDraw = true;
      if (behind > LAG_STEPS) {
        if (this.lagSinceTs === 0) this.lagSinceTs = ts;
        this.catchingUp = ts - this.lagSinceTs > CATCHING_UP_HINT_MS;
      } else {
        this.lagSinceTs = 0;
        this.catchingUp = false;
      }
    }
    if (this.needsDraw && !this.seeking) {
      if (!this.composition.mute.visual) runner.draw();
      this.needsDraw = false;
    }
  }

  private emitTransport(ts: number, force: boolean, position: number = this.clock.now()): void {
    const state: RuntimeTransport = {
      playing: this.clock.playing,
      position,
      duration: this.sampler.duration,
      catchingUp: this.catchingUp,
    };
    const last = this.lastEmitted;
    const changed =
      !last ||
      last.playing !== state.playing ||
      last.catchingUp !== state.catchingUp ||
      last.duration !== state.duration;
    const moved = !last || Math.abs(last.position - state.position) > 1e-4;
    if (!force && !changed && (!moved || ts - this.lastEmitTs < TRANSPORT_EMIT_MS)) return;
    this.lastEmitted = state;
    this.lastEmitTs = ts;
    this.events.transport(state);
  }

  private emitTimeline(): void {
    const duration = this.sampler.duration;
    this.events.timeline({
      duration,
      tailStart: Math.max(0, duration - this.composition.timeline.tailSec),
      markers: this.sampler.onsetsBetween(0, duration),
    });
  }

  /** Change which clock is the master, carrying the playhead (and playing) across. */
  private switchClock(next: PlaybackClock, play?: boolean): void {
    if (this.disposed) return;
    const prev = this.clock;
    const t = prev.now();
    const playing = play ?? prev.playing;
    if (next !== prev) {
      prev.pause();
      next.setLoop(this.loop);
      next.seek(t);
      this.clock = next;
    }
    if (playing) next.play();
    this.wake();
    this.emitTransport(performance.now(), true);
  }

  // ---------------------------------------------------------------------------------------
  // Canvas size and context

  private layout(): void {
    if (this.disposed) return;
    const rect = this.host.getBoundingClientRect();
    // A hidden host has no size; keep the canvas as it is until it shows again.
    if (rect.width < 2 || rect.height < 2) return;
    const { width, height } = this.composition.render;
    const box = fitAspect(rect.width, rect.height, width / height);
    const style = this.canvas.style;
    style.left = `${box.left}px`;
    style.top = `${box.top}px`;
    style.width = `${box.width}px`;
    style.height = `${box.height}px`;
    const backing = backingSize(box.width, box.height, window.devicePixelRatio, this.quality);
    if (this.canvas.width === backing.width && this.canvas.height === backing.height) return;
    this.canvas.width = backing.width;
    this.canvas.height = backing.height;
    this.material?.resize(backing.width, backing.height);
    // Resizing cleared the canvas: draw again before the browser paints.
    if (this.runner && !this.seeking && !this.contextLost && !this.composition.mute.visual) {
      this.runner.draw();
    } else {
      this.needsDraw = true;
    }
    this.wake();
  }

  private readonly onWindowResize = (): void => this.layout();

  private readonly onContextLost = (event: Event): void => {
    if (this.disposed) return;
    // Ask the browser to restore it; materials are rebuilt then.
    event.preventDefault();
    this.contextLost = true;
    this.visualToken++;
    this.disposeVisual();
    this.events.picture('context-lost');
  };

  private readonly onContextRestored = (): void => {
    if (this.disposed) return;
    this.contextLost = false;
    void this.mountVisual();
  };
}
