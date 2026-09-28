import { beforeEach, describe, expect, it } from 'vitest';
import type { SignatureMeta } from '../../src/library';
import type { ClipInfo, SignatureBody } from '../../src/signature/extractClient';
import { DEFAULT_FARNEBACK } from '../../src/signature/types';
import { floorFromSensitivity } from '../../src/screens/Prepare/sensitivity';
import { extractionOptions, usePrepareStore } from '../../src/state/prepareStore';

const clip: ClipInfo = {
  fileName: 'left_eye.mp4',
  durationSec: 2.5,
  nativeFps: 30,
  width: 1280,
  height: 720,
  rotation: 0,
  codec: 'avc',
  canDecode: true,
};

const store = () => usePrepareStore.getState();

function bodyWithFloor(noiseFloor: number): SignatureBody {
  return { extraction: { noiseFloor } } as unknown as SignatureBody;
}

describe('prepare store', () => {
  beforeEach(() => store().reset());

  it('opens a clip with default settings and a name from its file', () => {
    store().startOpening();
    expect(store().status).toBe('opening');
    store().clipOpened(clip);
    const s = store();
    expect(s.status).toBe('ready');
    expect(s.name).toBe('left eye');
    expect(s.settings.trim).toEqual({ startSec: 0, endSec: 2.5 });
    expect(s.settings.sensitivityMode).toBe('auto');
    expect(s.settings.sensitivity).toBeCloseTo(0.5, 12);
    expect(s.hideSource).toBe(true);
  });

  it('turns settings into extraction options', () => {
    store().clipOpened(clip);
    store().setTrim({ startSec: 0.51, endSec: 2 }, 'start');
    store().setSpeed(0.5);
    store().setRotate(90);
    store().setMirror(true);
    store().setFocusArea({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 });
    store().setSensitivityMode('manual');
    store().setSensitivity(0.75);
    store().setAnalysisSize(480);
    store().setGridCols(48);
    store().setSmoothingFrames(5);
    const options = extractionOptions(store().settings);
    expect(options).toEqual({
      trim: { startSec: 0.5, endSec: 2 },
      rotate: 90,
      mirror: true,
      focusArea: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
      analysisWidth: 480,
      gridCols: 48,
      noiseFloorMode: 'manual',
      manualNoiseFloor: floorFromSensitivity(0.75),
      temporalSmoothingFrames: 5,
      farneback: { ...DEFAULT_FARNEBACK },
    });
    expect(store().settings.speed).toBe(0.5);
  });

  it('carries the focus area along when rotating or mirroring', () => {
    store().clipOpened(clip);
    store().setFocusArea({ x: 0.1, y: 0.2, w: 0.3, h: 0.1 });
    store().setRotate(90);
    expect(store().settings.focusArea).toEqual({ x: 0.7, y: 0.1, w: 0.1, h: 0.3 });
    store().setRotate(0);
    expect(store().settings.focusArea).toEqual({ x: 0.1, y: 0.2, w: 0.3, h: 0.1 });
    store().setMirror(true);
    expect(store().settings.focusArea).toEqual({ x: 0.6, y: 0.2, w: 0.3, h: 0.1 });
  });

  it('keeps speed within 0.25–2', () => {
    store().clipOpened(clip);
    store().setSpeed(5);
    expect(store().settings.speed).toBe(2);
    store().setSpeed(0.1);
    expect(store().settings.speed).toBe(0.25);
  });

  it('locks settings while extracting and returns to them after a cancel or failure', () => {
    store().clipOpened(clip);
    store().extractionStarted();
    expect(store().status).toBe('extracting');
    store().setRotate(180);
    expect(store().settings.rotate).toBe(0);
    store().extractionProgressed({ phase: 'analyzing', done: 3, total: 10 });
    expect(store().progress).toEqual({ phase: 'analyzing', done: 3, total: 10 });
    store().extractionCancelled();
    expect(store().status).toBe('ready');
    expect(store().notice?.tone).toBe('info');
    store().extractionStarted();
    store().extractionFailed('It broke. Try again.');
    expect(store().status).toBe('ready');
    expect(store().notice).toEqual({ tone: 'error', message: 'It broke. Try again.' });
    // Late messages from a finished job change nothing.
    store().extractionSucceeded(bodyWithFloor(0.02));
    expect(store().status).toBe('ready');
  });

  it('shows the signature after extraction and starts manual sensitivity from Automatic’s floor', () => {
    store().clipOpened(clip);
    store().extractionStarted();
    store().extractionSucceeded(bodyWithFloor(0.01));
    const s = store();
    expect(s.status).toBe('extracted');
    expect(s.body).not.toBeNull();
    expect(s.hideSource).toBe(true);
    expect(s.settings.sensitivity).toBeCloseTo(0.5, 12);
    // Speed can still change until the signature is saved.
    store().setSpeed(1.5);
    expect(store().settings.speed).toBe(1.5);
    store().signatureSaved({ id: 'sig-1', name: 'Left eye' } as SignatureMeta);
    expect(store().saved?.id).toBe('sig-1');
    expect(store().name).toBe('Left eye');
    store().setSpeed(0.5);
    store().setName('Other');
    expect(store().settings.speed).toBe(1.5);
    expect(store().name).toBe('Left eye');
    store().extractAgain();
    expect(store().status).toBe('ready');
    expect(store().body).toBeNull();
    expect(store().saved).toBeNull();
  });

  it('keeps the open clip when another file fails to open', () => {
    store().clipOpened(clip);
    store().startOpening();
    store().openFailed('That file is not a clip.');
    expect(store().status).toBe('ready');
    expect(store().clip?.fileName).toBe('left_eye.mp4');
    store().reset();
    store().startOpening();
    store().openFailed('That file is not a clip.');
    expect(store().status).toBe('empty');
    expect(store().notice?.message).toBe('That file is not a clip.');
  });
});
