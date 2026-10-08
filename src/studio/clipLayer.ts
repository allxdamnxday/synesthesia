/**
 * The Studio's clip layer (SPEC 6.3): the clip a signature was made from, laid over the
 * wake so the two can be seen together. It is a <video> above the preview canvas, cropped,
 * turned and placed where the signature acts (./clipLayerMath.ts), and kept at the moment
 * the playhead is at by the preview runtime, which calls `place()` and `sync()`.
 *
 * It only ever exists on screen, and only while it is asked for: the composition, its
 * thumbnail and its renders are made without it, and the clip itself is held in memory
 * for this visit alone (src/state/visitClips.ts).
 */
import { samplerConfigFor } from '../render/timeline';
import { resolveSamplerConfig } from '../signature/sampler';
import {
  DEFAULT_SAMPLER_CONFIG,
  type KineticSignature,
  type SamplerConfig,
} from '../signature/types';
import type { TimelineSettings } from '../engine/composition';
import { clipLayerGeometry, clipTimeAt, planClipFollow, signatureMomentAt } from './clipLayerMath';
import type { Box } from './layout';
import type { StageOverlay } from './runtime';

export interface ClipLayerView {
  /** 0 (hidden) to 1 (the clip alone). */
  opacity: number;
  timeline: TimelineSettings;
  /** The visual material's Range (`projectionRange`). */
  range: number;
}

export interface ClipLayerOptions extends ClipLayerView {
  /** Element holding the preview canvas; the layer is added above it. */
  host: HTMLElement;
  file: File;
  signature: KineticSignature;
  /** The clip can't be played any more (its file moved or changed). */
  onProblem: () => void;
}

/** A change of speed smaller than this isn't worth telling the <video> about. */
const RATE_STEP = 0.005;

export class ClipLayer implements StageOverlay {
  private readonly root: HTMLDivElement;
  private readonly frame: HTMLDivElement;
  private readonly video: HTMLVideoElement;
  private readonly url: string;
  private readonly signature: KineticSignature;
  private readonly signatureDuration: number;
  private readonly onProblem: () => void;
  private config: SamplerConfig;
  private range: number;
  private size: { width: number; height: number } | null = null;
  private last = { t: 0, playing: false };
  private ready = false;
  private disposed = false;
  private pendingSeek: number | null = null;

  constructor(options: ClipLayerOptions) {
    this.signature = options.signature;
    this.signatureDuration =
      options.signature.frameRate > 0
        ? options.signature.frameCount / options.signature.frameRate
        : 0;
    this.onProblem = options.onProblem;
    this.config = resolveSamplerConfig(DEFAULT_SAMPLER_CONFIG, samplerConfigFor(options.timeline));
    this.range = options.range;

    const root = document.createElement('div');
    root.dataset.testid = 'clip-layer';
    Object.assign(root.style, {
      position: 'absolute',
      overflow: 'hidden',
      pointerEvents: 'none',
      // Nothing to show until the clip's first frame is here.
      visibility: 'hidden',
      opacity: String(options.opacity),
    });
    const frame = document.createElement('div');
    frame.style.position = 'absolute';
    const video = document.createElement('video');
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.disablePictureInPicture = true;
    video.disableRemotePlayback = true;
    video.setAttribute('aria-label', 'The clip');
    Object.assign(video.style, {
      position: 'absolute',
      left: '50%',
      top: '50%',
      objectFit: 'fill',
    });
    frame.append(video);
    root.append(frame);
    this.root = root;
    this.frame = frame;
    this.video = video;

    video.addEventListener('loadeddata', this.onLoaded);
    video.addEventListener('seeked', this.onSeeked);
    video.addEventListener('error', this.onError);
    this.url = URL.createObjectURL(options.file);
    video.src = this.url;
    options.host.append(root);
  }

  /** The opacity, the timeline or the material's Range changed. */
  update(view: ClipLayerView): void {
    if (this.disposed) return;
    this.root.style.opacity = String(view.opacity);
    this.config = resolveSamplerConfig(DEFAULT_SAMPLER_CONFIG, samplerConfigFor(view.timeline));
    if (view.range !== this.range) {
      this.range = view.range;
      this.applyGeometry();
    }
    this.follow();
  }

  place(box: Box): void {
    if (this.disposed) return;
    const style = this.root.style;
    style.left = `${box.left}px`;
    style.top = `${box.top}px`;
    style.width = `${box.width}px`;
    style.height = `${box.height}px`;
    this.size = { width: box.width, height: box.height };
    this.applyGeometry();
  }

  sync(t: number, playing: boolean): void {
    this.last = { t, playing };
    this.follow();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const video = this.video;
    video.removeEventListener('loadeddata', this.onLoaded);
    video.removeEventListener('seeked', this.onSeeked);
    video.removeEventListener('error', this.onError);
    // Let go of the clip's decoder now, not when the element is collected.
    video.pause();
    video.removeAttribute('src');
    video.load();
    this.root.remove();
    URL.revokeObjectURL(this.url);
  }

  private applyGeometry(): void {
    const size = this.size;
    if (!size) return;
    const { source, grid } = this.signature;
    const g = clipLayerGeometry(size.width, size.height, source, grid, this.range);
    const frame = this.frame.style;
    frame.left = `${g.frame.left}px`;
    frame.top = `${g.frame.top}px`;
    frame.width = `${g.frame.width}px`;
    frame.height = `${g.frame.height}px`;
    const video = this.video.style;
    video.width = `${g.video.width}px`;
    video.height = `${g.video.height}px`;
    video.transform = `translate(-50%, -50%)${g.transform === 'none' ? '' : ` ${g.transform}`}`;
  }

  /** Bring the <video> to the moment the playhead is at. */
  private follow(): void {
    if (this.disposed || !this.ready) return;
    const video = this.video;
    const { source, frameRate } = this.signature;
    const moment = signatureMomentAt(this.last.t, this.config, this.signatureDuration);
    const plan = planClipFollow({
      target: clipTimeAt(moment.s, source.trim, frameRate, source.nativeFps),
      currentTime: video.currentTime,
      ended: video.ended,
      playing: this.last.playing,
      direction: moment.direction,
      speed: this.config.speed,
      nativeFps: source.nativeFps,
    });
    if (Math.abs(video.playbackRate - plan.rate) > RATE_STEP) video.playbackRate = plan.rate;
    if (plan.seekTo !== null) this.seek(plan.seekTo);
    else this.pendingSeek = null;
    if (plan.run) {
      if (video.paused) void video.play().catch(() => undefined);
    } else if (!video.paused) {
      video.pause();
    }
  }

  /** One seek at a time: while one is under way, only the latest request is kept. */
  private seek(time: number): void {
    if (this.video.seeking) {
      this.pendingSeek = time;
      return;
    }
    this.pendingSeek = null;
    this.video.currentTime = time;
  }

  private readonly onLoaded = (): void => {
    if (this.disposed) return;
    this.ready = true;
    this.root.style.visibility = 'visible';
    this.follow();
  };

  private readonly onSeeked = (): void => {
    const next = this.pendingSeek;
    if (this.disposed || next === null) return;
    this.pendingSeek = null;
    this.video.currentTime = next;
  };

  private readonly onError = (): void => {
    if (!this.disposed) this.onProblem();
  };
}
