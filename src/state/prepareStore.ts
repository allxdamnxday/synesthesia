/**
 * Prepare screen state (Zustand): the clip's facts, the settings chosen for extraction, and
 * where the person is in the flow (open a clip → shape it → extract → name and save).
 *
 * The clip itself (the File and its object URL) is deliberately NOT here: it lives only in
 * the Prepare screen component and is dropped when the screen closes (SPEC C7). This store
 * holds nothing but numbers, names and the extracted signature body (movement data only),
 * and the screen resets it whenever it opens or closes.
 */
import { create } from 'zustand';
import type { SignatureMeta } from '../library';
import type { ClipInfo, ExtractionProgress, SignatureBody } from '../signature/extractClient';
import {
  DEFAULT_EXTRACTION_OPTIONS,
  type ExtractionOptions,
  type FocusArea,
  type Rotation,
} from '../signature/types';
import { nameFromFileName } from '../screens/Prepare/format';
import { reorientRect, type ViewOrientation } from '../screens/Prepare/orientation';
import { floorFromSensitivity, sensitivityFromFloor } from '../screens/Prepare/sensitivity';
import { clampTrim, defaultTrim, type Trim } from '../screens/Prepare/trim';
import { clampRect, roundRect } from '../ui/rectMath';

export type PrepareStatus = 'empty' | 'opening' | 'ready' | 'extracting' | 'extracted';

/** Choices offered under Advanced. */
export const ANALYSIS_SIZES = [160, 240, 320, 480] as const;
export const GRID_COLUMNS = [16, 24, 32, 48] as const;
export const SMOOTHING_FRAMES = [1, 3, 5, 7, 9] as const;

export const SPEED_RANGE = { min: 0.25, max: 2, step: 0.05, default: 1 } as const;

export interface PrepareSettings {
  trim: Trim;
  /** Becomes the signature's preferredSpeed. */
  speed: number;
  rotate: Rotation;
  mirror: boolean;
  /** Normalized to the displayed (rotated and mirrored) frame; null = the whole frame. */
  focusArea: FocusArea | null;
  sensitivityMode: 'auto' | 'manual';
  /** Manual sensitivity, 0–1 (see sensitivity.ts). */
  sensitivity: number;
  /** Longer side of the analysis frame, pixels. */
  analysisSize: number;
  gridCols: number;
  smoothingFrames: number;
}

export function defaultSettings(clip: Pick<ClipInfo, 'durationSec'> | null): PrepareSettings {
  return {
    trim: defaultTrim(clip?.durationSec ?? 0),
    speed: SPEED_RANGE.default,
    rotate: 0,
    mirror: false,
    focusArea: null,
    sensitivityMode: 'auto',
    sensitivity: sensitivityFromFloor(DEFAULT_EXTRACTION_OPTIONS.manualNoiseFloor),
    analysisSize: DEFAULT_EXTRACTION_OPTIONS.analysisWidth,
    gridCols: DEFAULT_EXTRACTION_OPTIONS.gridCols,
    smoothingFrames: DEFAULT_EXTRACTION_OPTIONS.temporalSmoothingFrames,
  };
}

/** The options `startExtraction` receives for these settings. */
export function extractionOptions(settings: PrepareSettings): ExtractionOptions {
  return {
    trim: { startSec: settings.trim.startSec, endSec: settings.trim.endSec },
    rotate: settings.rotate,
    mirror: settings.mirror,
    focusArea: settings.focusArea ? { ...settings.focusArea } : null,
    analysisWidth: settings.analysisSize,
    gridCols: settings.gridCols,
    noiseFloorMode: settings.sensitivityMode,
    manualNoiseFloor: floorFromSensitivity(settings.sensitivity),
    temporalSmoothingFrames: settings.smoothingFrames,
    farneback: { ...DEFAULT_EXTRACTION_OPTIONS.farneback },
  };
}

function clampSpeed(speed: number): number {
  if (!Number.isFinite(speed)) return SPEED_RANGE.default;
  return Math.min(SPEED_RANGE.max, Math.max(SPEED_RANGE.min, speed));
}

/** A notice about the last thing that went wrong or was stopped. */
export interface PrepareNotice {
  tone: 'info' | 'error';
  message: string;
}

export interface PrepareState {
  status: PrepareStatus;
  clip: ClipInfo | null;
  settings: PrepareSettings;
  progress: ExtractionProgress | null;
  notice: PrepareNotice | null;
  /** The extracted signature (movement data only), until it's saved or discarded. */
  body: SignatureBody | null;
  name: string;
  /** Set once the signature is in the library. */
  saved: SignatureMeta | null;
  /** Show only the wake (on by default after each extraction). */
  hideSource: boolean;

  reset: () => void;
  startOpening: () => void;
  /** A new clip is open: settings start from their defaults for it. */
  clipOpened: (clip: ClipInfo) => void;
  /** The clip couldn't be opened; whatever was open before stays. */
  openFailed: (message: string) => void;
  setNotice: (notice: PrepareNotice | null) => void;

  setTrim: (trim: Trim, moving?: 'start' | 'end' | 'both') => void;
  setSpeed: (speed: number) => void;
  setRotate: (rotate: Rotation) => void;
  setMirror: (mirror: boolean) => void;
  setFocusArea: (area: FocusArea | null) => void;
  setSensitivityMode: (mode: 'auto' | 'manual') => void;
  setSensitivity: (sensitivity: number) => void;
  setAnalysisSize: (size: number) => void;
  setGridCols: (cols: number) => void;
  setSmoothingFrames: (frames: number) => void;

  extractionStarted: () => void;
  extractionProgressed: (progress: ExtractionProgress) => void;
  extractionSucceeded: (body: SignatureBody) => void;
  extractionFailed: (message: string) => void;
  extractionCancelled: () => void;

  setName: (name: string) => void;
  setHideSource: (hide: boolean) => void;
  signatureSaved: (meta: SignatureMeta) => void;
  /** Back to the clip and its settings to extract again. */
  extractAgain: () => void;
}

const INITIAL = {
  status: 'empty' as PrepareStatus,
  clip: null,
  settings: defaultSettings(null),
  progress: null,
  notice: null,
  body: null,
  name: '',
  saved: null,
  hideSource: true,
};

/** Settings can change only while the clip is open and nothing is running. */
const editable = (s: PrepareState) => s.clip !== null && s.status === 'ready';

export const usePrepareStore = create<PrepareState>()((set, get) => {
  const updateSettings = (patch: Partial<PrepareSettings>) => {
    if (!editable(get())) return;
    set((s) => ({ settings: { ...s.settings, ...patch } }));
  };

  const reorient = (next: ViewOrientation) => {
    const s = get();
    if (!editable(s)) return;
    const from: ViewOrientation = { rotate: s.settings.rotate, mirror: s.settings.mirror };
    const area = s.settings.focusArea;
    updateSettings({
      rotate: next.rotate,
      mirror: next.mirror,
      focusArea: area ? roundRect(clampRect(reorientRect(area, from, next))) : null,
    });
  };

  return {
    ...INITIAL,

    reset: () => set({ ...INITIAL, settings: defaultSettings(null) }),

    startOpening: () => {
      if (get().status === 'extracting') return;
      set({ status: 'opening', notice: null });
    },

    clipOpened: (clip) =>
      set({
        status: 'ready',
        clip,
        settings: defaultSettings(clip),
        progress: null,
        notice: null,
        body: null,
        name: nameFromFileName(clip.fileName),
        saved: null,
        hideSource: true,
      }),

    openFailed: (message) =>
      set((s) => ({
        status: s.clip === null ? 'empty' : s.body !== null ? 'extracted' : 'ready',
        notice: { tone: 'error', message },
      })),

    setNotice: (notice) => set({ notice }),

    setTrim: (trim, moving = 'both') => {
      const s = get();
      if (!s.clip) return;
      updateSettings({
        trim: clampTrim(trim, s.clip.durationSec, s.clip.nativeFps, moving),
      });
    },

    setSpeed: (speed) => {
      const s = get();
      // Speed is only how fast the signature plays, so it stays open after extraction
      // (until the signature is saved).
      if (s.clip === null || s.status === 'extracting' || s.saved !== null) return;
      set({ settings: { ...s.settings, speed: clampSpeed(speed) } });
    },

    setRotate: (rotate) => reorient({ rotate, mirror: get().settings.mirror }),
    setMirror: (mirror) => reorient({ rotate: get().settings.rotate, mirror }),

    setFocusArea: (area) => updateSettings({ focusArea: area ? roundRect(clampRect(area)) : null }),

    setSensitivityMode: (mode) => updateSettings({ sensitivityMode: mode }),
    setSensitivity: (sensitivity) =>
      updateSettings({ sensitivity: Math.min(1, Math.max(0, sensitivity)) }),
    setAnalysisSize: (analysisSize) => updateSettings({ analysisSize }),
    setGridCols: (gridCols) => updateSettings({ gridCols }),
    setSmoothingFrames: (smoothingFrames) => updateSettings({ smoothingFrames }),

    extractionStarted: () => {
      if (!editable(get())) return;
      set({
        status: 'extracting',
        progress: { phase: 'loading', done: 0, total: 1 },
        notice: null,
      });
    },

    extractionProgressed: (progress) => {
      if (get().status === 'extracting') set({ progress });
    },

    extractionSucceeded: (body) => {
      const s = get();
      if (s.status !== 'extracting') return;
      set({
        status: 'extracted',
        progress: null,
        body,
        saved: null,
        hideSource: true,
        // If the person later sets Sensitivity by hand, start from what Automatic found.
        settings:
          s.settings.sensitivityMode === 'auto'
            ? { ...s.settings, sensitivity: sensitivityFromFloor(body.extraction.noiseFloor) }
            : s.settings,
      });
    },

    extractionFailed: (message) => {
      if (get().status !== 'extracting') return;
      set({ status: 'ready', progress: null, notice: { tone: 'error', message } });
    },

    extractionCancelled: () => {
      if (get().status !== 'extracting') return;
      set({
        status: 'ready',
        progress: null,
        notice: { tone: 'info', message: 'Extraction stopped. Your settings are kept.' },
      });
    },

    setName: (name) => {
      if (get().saved === null) set({ name });
    },

    setHideSource: (hideSource) => set({ hideSource }),

    signatureSaved: (meta) => {
      if (get().body !== null) set({ saved: meta, name: meta.name });
    },

    extractAgain: () => {
      const s = get();
      if (s.status !== 'extracted') return;
      set({ status: 'ready', body: null, saved: null, progress: null, notice: null });
    },
  };
});
