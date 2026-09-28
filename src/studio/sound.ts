/**
 * The Studio's sound: one AudioEngine per Studio session, kept in line with the working
 * composition. The engine is the master clock once its material has loaded (see
 * runtime.ts); until then, and whenever there is no playable sound, the picture runs on
 * the wall clock.
 *
 * - The sound material or the seed changed: load a fresh instance (`soundSeed(seed)`);
 *   while playing the engine crossfades it in without restarting.
 * - Properties changed (Linked or not): `setProps` with the sound field's values; the
 *   engine reschedules from ~30 ms ahead, click-free.
 * - Mute: `setMuted`; the clock keeps running.
 * - The timeline changed: the runtime reconfigures the shared sampler, then calls
 *   `timelineChanged()` here.
 */
import { AudioEngine } from '../engine/audio/AudioEngine';
import type { Composition } from '../engine/composition';
import { soundSeed } from '../engine/seeds';
import { getSoundMaterial } from '../materials/registry';
import type { PropertyValues } from '../materials/types';
import type { SignatureSampler } from '../signature/types';
import { AudioEngineClock } from './audioClock';

export type SoundProblem = 'no-audio' | 'material-missing' | 'material-failed' | 'play-failed';

export interface StudioSoundEvents {
  /** The sound became playable (true), or stopped being playable (false). */
  ready(ready: boolean): void;
  problem(problem: SoundProblem | null): void;
  /** The sound couldn't start playing (the picture should carry on without it). */
  playFailed(): void;
}

function sameValues(a: PropertyValues, b: PropertyValues): boolean {
  if (a === b) return true;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => Object.is(a[k], b[k]));
}

export class StudioSound {
  readonly engine: AudioEngine;
  readonly clock: AudioEngineClock;
  private readonly sampler: SignatureSampler;
  private readonly events: StudioSoundEvents;
  private wantedKey: string | null = null;
  private latestProps: PropertyValues = {};
  private isReady = false;
  private token = 0;
  private disposed = false;

  /** A sound engine for this session, or null where Web Audio isn't available. */
  static create(sampler: SignatureSampler, events: StudioSoundEvents): StudioSound | null {
    try {
      return new StudioSound(new AudioEngine(), sampler, events);
    } catch (error) {
      console.warn('Sound is unavailable:', error);
      return null;
    }
  }

  private constructor(engine: AudioEngine, sampler: SignatureSampler, events: StudioSoundEvents) {
    this.engine = engine;
    this.sampler = sampler;
    this.events = events;
    this.clock = new AudioEngineClock(engine, (error) => {
      console.warn('The sound could not start:', error);
      this.events.problem('play-failed');
      this.events.playFailed();
    });
  }

  get ready(): boolean {
    return this.isReady;
  }

  /** Bring the engine in line with the composition (`prev` is what it last saw). */
  apply(prev: Composition | null, next: Composition): void {
    if (this.disposed) return;
    this.latestProps = next.sound.properties;
    const key = `${next.sound.materialId}#${next.seed}`;
    if (key !== this.wantedKey) {
      this.wantedKey = key;
      void this.load(next);
    } else if (this.isReady && prev && !sameValues(prev.sound.properties, next.sound.properties)) {
      this.engine.setProps(next.sound.properties);
    }
    if (!prev || prev.mute.sound !== next.mute.sound) this.engine.setMuted(next.mute.sound);
  }

  /** The shared sampler was reconfigured (speed, loops, tail, smoothing, strength). */
  timelineChanged(): void {
    if (!this.disposed) this.engine.timelineChanged();
  }

  /** Start the AudioContext from inside a click or key press (autoplay policy). */
  resumeFromGesture(): void {
    if (this.disposed || this.engine.context.state === 'running') return;
    this.engine.context.resume().catch(() => undefined);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.token++;
    this.clock.dispose();
    this.engine.onEnded = null;
    this.engine.onLoop = null;
    void this.engine.dispose().catch(() => undefined);
  }

  private async load(composition: Composition): Promise<void> {
    const token = ++this.token;
    const entry = getSoundMaterial(composition.sound.materialId);
    if (!entry) {
      this.setReady(false);
      this.events.problem('material-missing');
      return;
    }
    try {
      await this.engine.load({
        entry,
        sampler: this.sampler,
        props: composition.sound.properties,
        seed: soundSeed(composition.seed),
      });
    } catch (error) {
      if (token !== this.token || this.disposed) return;
      console.warn(`The sound material "${entry.meta.id}" could not start:`, error);
      this.setReady(false);
      this.events.problem('material-failed');
      return;
    }
    if (token !== this.token || this.disposed) return;
    // Values may have changed while the material was being built.
    if (!sameValues(this.latestProps, composition.sound.properties)) {
      this.engine.setProps(this.latestProps);
    }
    this.events.problem(null);
    this.setReady(true);
  }

  private setReady(ready: boolean): void {
    if (this.isReady === ready) return;
    this.isReady = ready;
    this.events.ready(ready);
  }
}
