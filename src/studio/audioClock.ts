/**
 * The sound engine as the Studio's master clock (docs/ARCHITECTURE.md "Time"). The engine
 * wraps at the end of the timeline with Loop on and stops (calling `onEnded`) with it off,
 * so this adapter only forwards. `play()` is asynchronous inside the engine (it resumes the
 * AudioContext); until it has started, `playing` already reads true and `now()` holds the
 * paused position, so the picture waits for the sound instead of running ahead of it.
 */
import type { AudioEngine } from '../engine/audio/AudioEngine';
import type { PlaybackClock } from './clock';

export class AudioEngineClock implements PlaybackClock {
  private starting = false;
  private token = 0;
  private readonly engine: AudioEngine;
  private readonly onPlayFailed: (error: unknown) => void;

  constructor(engine: AudioEngine, onPlayFailed: (error: unknown) => void) {
    this.engine = engine;
    this.onPlayFailed = onPlayFailed;
  }

  get playing(): boolean {
    return this.starting || this.engine.playing;
  }

  now(atMs?: number): number {
    return atMs === undefined ? this.engine.compositionTime() : this.engine.compositionTimeAt(atMs);
  }

  play(): void {
    if (this.engine.playing || this.starting) return;
    const token = ++this.token;
    this.starting = true;
    this.engine
      .play()
      .catch((error: unknown) => {
        if (token === this.token) this.onPlayFailed(error);
      })
      .finally(() => {
        if (token === this.token) this.starting = false;
      });
  }

  pause(): void {
    this.token++;
    this.starting = false;
    this.engine.pause();
  }

  seek(t: number): void {
    this.engine.seek(t);
  }

  setLoop(loop: boolean): void {
    this.engine.setLoop(loop);
  }

  timelineChanged(): void {
    this.engine.timelineChanged();
  }

  dispose(): void {
    this.token++;
    this.starting = false;
  }
}
