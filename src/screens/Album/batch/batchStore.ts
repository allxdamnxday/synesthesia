/**
 * The album batch render that is running or has just finished (Zustand). It lives
 * outside the Album screen, so a batch carries on while the person looks at other parts
 * of the app, and it remembers the folder chosen this session. One batch at a time:
 * renders share the graphics card.
 */
import { create } from 'zustand';
import type { Composition } from '../../../engine/composition';
import { errorDetail, findSignatureForComposition, setAlbumRender } from '../../../library';
import type { KineticSignature } from '../../../signature/types';
import {
  BATCH_MESSAGES,
  BatchController,
  renderTracks,
  type BatchRenderOptions,
  type BatchSummary,
  type RenderDestination,
  type RenderOneFn,
} from './renderTracks';

export type BatchTrackStatus = 'waiting' | 'rendering' | 'rendered' | 'failed' | 'skipped';

export interface BatchTrack {
  compositionId: string;
  /** "01" */
  number: string;
  status: BatchTrackStatus;
  /** 0–1 */
  progress: number;
  fileName?: string;
  /** Why it failed, in plain language. */
  message?: string;
}

export type BatchPhase = 'idle' | 'running' | 'finished';

export interface BatchStartRequest {
  albumId: string;
  albumTitle: string;
  tracks: ReadonlyArray<{ number: string; composition: Composition }>;
  options: BatchRenderOptions;
  renderOne: RenderOneFn;
  /** Defaults to the library's lookup (by id, else the same movement under another id). */
  loadSignature?: (composition: Composition) => Promise<KineticSignature | undefined>;
  /** Defaults to recording the file in the album (setAlbumRender). */
  recordRender?: (albumId: string, compositionId: string, fileName: string) => Promise<unknown>;
}

export interface BatchState {
  phase: BatchPhase;
  albumId: string | null;
  albumTitle: string;
  tracks: BatchTrack[];
  /** Index of the track rendering now; -1 when none. */
  current: number;
  /** A pause was asked for; `holding` once the batch has actually stopped. */
  pauseRequested: boolean;
  holding: boolean;
  cancelRequested: boolean;
  /** Estimated time left for the whole batch, once there's enough to go on. */
  etaMs: number | null;
  summary: BatchSummary | null;
  /** Where files go: chosen once per session, kept between batches. */
  destination: RenderDestination | null;
  setDestination: (destination: RenderDestination | null) => void;
  /** Resolves with the summary when the batch ends; null if one is already running. */
  start: (request: BatchStartRequest) => Promise<BatchSummary | null>;
  pause: () => void;
  resume: () => void;
  cancel: () => void;
  /** Put a finished batch away. */
  dismiss: () => void;
}

let controller: BatchController | null = null;

/** Closing or reloading the page would stop the batch, so the browser asks first. */
function keepPageOpen(event: BeforeUnloadEvent): void {
  event.preventDefault();
}

const IDLE = {
  phase: 'idle',
  albumId: null,
  albumTitle: '',
  current: -1,
  pauseRequested: false,
  holding: false,
  cancelRequested: false,
  etaMs: null,
  summary: null,
} as const satisfies Partial<BatchState>;

export const useBatchStore = create<BatchState>()((set, get) => {
  const patchTrack = (index: number, patch: Partial<BatchTrack>) =>
    set((s) => ({ tracks: s.tracks.map((t, i) => (i === index ? { ...t, ...patch } : t)) }));

  /** After the run: anything that never finished was skipped. */
  const settleTracks = () =>
    set((s) => ({
      tracks: s.tracks.map((t) =>
        t.status === 'waiting' || t.status === 'rendering' ? { ...t, status: 'skipped' } : t,
      ),
    }));

  return {
    ...IDLE,
    tracks: [],
    destination: null,

    setDestination: (destination) => set({ destination }),

    async start(request) {
      if (get().phase === 'running') return null;
      const batch = new BatchController();
      controller = batch;
      set({
        ...IDLE,
        phase: 'running',
        albumId: request.albumId,
        albumTitle: request.albumTitle,
        tracks: request.tracks.map((t) => ({
          compositionId: t.composition.id,
          number: t.number,
          status: 'waiting',
          progress: 0,
        })),
      });
      window.addEventListener('beforeunload', keepPageOpen);
      const record = request.recordRender ?? setAlbumRender;
      let summary: BatchSummary;
      try {
        summary = await renderTracks(
          request.tracks.map((t) => t.composition),
          request.options,
          {
            onTrackStart: (i) => {
              set({ current: i });
              patchTrack(i, { status: 'rendering', progress: 0 });
            },
            onTrackProgress: (i, fraction, etaMs) => {
              patchTrack(i, { progress: fraction });
              set({ etaMs });
            },
            onTrackDone: async (i, outcome) => {
              if (outcome.status === 'rendered') {
                patchTrack(i, { status: 'rendered', progress: 1, fileName: outcome.fileName });
                await record(request.albumId, request.tracks[i].composition.id, outcome.fileName);
              } else if (outcome.status === 'failed') {
                patchTrack(i, { status: 'failed', message: outcome.message });
              } else {
                patchTrack(i, { status: 'skipped' });
              }
            },
            onHoldChange: (holding) => set({ holding }),
          },
          {
            renderOne: request.renderOne,
            loadSignature: request.loadSignature ?? findSignatureForComposition,
          },
          batch,
        );
      } catch (err) {
        // renderTracks records every track's failure itself; this is a bug, not a track.
        console.error('Batch render stopped:', errorDetail(err));
        const outcomes = get().tracks.map((t) =>
          t.status === 'rendered' && t.fileName
            ? { status: 'rendered' as const, fileName: t.fileName, ms: 0 }
            : { status: 'failed' as const, message: BATCH_MESSAGES.failed, detail: '' },
        );
        summary = {
          outcomes,
          rendered: outcomes.filter((o) => o.status === 'rendered').length,
          failed: outcomes.filter((o) => o.status === 'failed').length,
          skipped: 0,
          cancelled: false,
          elapsedMs: 0,
        };
      } finally {
        window.removeEventListener('beforeunload', keepPageOpen);
        if (controller === batch) controller = null;
      }
      settleTracks();
      set({
        phase: 'finished',
        summary,
        current: -1,
        holding: false,
        pauseRequested: false,
        etaMs: null,
      });
      return summary;
    },

    pause() {
      if (get().phase !== 'running') return;
      controller?.pause();
      set({ pauseRequested: true });
    },
    resume() {
      controller?.resume();
      set({ pauseRequested: false });
    },
    cancel() {
      if (get().phase !== 'running') return;
      controller?.cancel();
      set({ cancelRequested: true, pauseRequested: false });
    },
    dismiss() {
      if (get().phase === 'running') return;
      set({ ...IDLE, tracks: [] });
    },
  };
});
