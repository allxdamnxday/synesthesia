/**
 * Sound materials harness: audition registered sound materials with synthetic signatures,
 * live through the preview engine and offline through the render path, and expose
 * `window.spSound` for the Playwright tests (tests/e2e/sound.spec.ts).
 */
import { AudioEngine, type SchedulerStats } from '../../src/engine/audio/AudioEngine';
import { renderSoundOffline } from '../../src/engine/audio/offline';
import { baselineValues } from '../../src/materials/properties';
import { getSoundMaterial, listSoundMaterials } from '../../src/materials/registry';
import { createOnePoleSmoother } from '../../src/materials/sound/shared/worklets';
import type { PropertyDef, PropertyValues, SoundMaterialEntry } from '../../src/materials/types';
import { createSyntheticSampler, type SyntheticKind } from '../../src/signature/synthetic';
import type { LoopMode, SignatureSampler } from '../../src/signature/types';
import {
  beforeLimiter,
  correlation,
  encodeWav,
  envelopes,
  hashChannels,
  overallRms,
  peak,
  pitchTrack,
  spectralCentroid,
} from './analysis';
import { excerptSampler } from './excerpt';
import recorderUrl from './recorder.worklet.js?url&no-inline';

// ------------------------------------------------------------------------------------------
// Rendering helpers shared by the UI and the test API

export interface RenderOptions {
  materialId: string;
  kind: SyntheticKind;
  /** Seconds to render. */
  seconds: number;
  props?: Record<string, number>;
  seed?: number;
  loops?: number;
  /** Tail after the movement, seconds (default 3, the SPEC default). */
  tailSec?: number;
  speed?: number;
  strength?: number;
  loopMode?: LoopMode;
  /** Play only [start, end) of the movement (puts loop boundaries mid-movement). */
  excerpt?: [number, number];
  /** Peak-normalize to −1 dBFS (default true, as exports). */
  normalize?: boolean;
  /** Offline scheduling window in seconds (0 = one call). */
  windowSec?: number;
  /**
   * Master gain before the output limiter, for renders and the preview probe alike (default:
   * the engine's). Debugging: well below the default, the limiter never engages.
   */
  masterGain?: number;
}

export interface RenderStats {
  peak: number;
  rms: number;
  hopSec: number;
  rmsEnvelope: number[];
  jumpEnvelope: number[];
  /** Second-difference peaks per hop: spikes mark clicks. */
  clickEnvelope: number[];
  pitchTrack?: number[];
  /** Spectral centroid in Hz per hop (0 when near-silent). */
  centroid?: number[];
  hash: string;
  duration: number;
}

function entryFor(id: string): SoundMaterialEntry {
  const entry = getSoundMaterial(id);
  if (!entry) throw new Error(`No sound material "${id}".`);
  return entry;
}

function makeSampler(opts: Omit<RenderOptions, 'materialId' | 'seconds'>): SignatureSampler {
  const base = createSyntheticSampler(opts.kind);
  const sampler = opts.excerpt ? excerptSampler(base, opts.excerpt[0], opts.excerpt[1]) : base;
  sampler.configure({
    loops: opts.loops ?? 1,
    tailSec: opts.tailSec ?? 3,
    speed: opts.speed ?? 1,
    strength: opts.strength ?? 1,
    loopMode: opts.loopMode ?? 'loop',
  });
  return sampler;
}

function propsFor(
  entry: SoundMaterialEntry,
  overrides: Record<string, number> = {},
): PropertyValues {
  return { ...baselineValues(entry.meta.properties), ...overrides };
}

function channelsOf(buffer: AudioBuffer): Float32Array[] {
  const out: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) out.push(buffer.getChannelData(c));
  return out;
}

async function render(opts: RenderOptions): Promise<AudioBuffer> {
  const entry = entryFor(opts.materialId);
  return renderSoundOffline({
    entry,
    sampler: makeSampler(opts),
    props: propsFor(entry, opts.props),
    seed: opts.seed ?? 1,
    duration: opts.seconds,
    normalize: opts.normalize ?? true,
    windowSec: opts.windowSec,
    masterGain: opts.masterGain,
  });
}

async function statsOf(buffer: AudioBuffer, withPitch: boolean): Promise<RenderStats> {
  const channels = channelsOf(buffer);
  const env = envelopes(channels, buffer.sampleRate, 0.01);
  return {
    peak: peak(channels),
    rms: overallRms(channels),
    hopSec: env.hopSec,
    rmsEnvelope: env.rms,
    jumpEnvelope: env.jump,
    clickEnvelope: env.click,
    pitchTrack: withPitch ? pitchTrack(channels, buffer.sampleRate, { hopSec: 0.01 }) : undefined,
    centroid: withPitch ? spectralCentroid(channels, buffer.sampleRate, 0.01) : undefined,
    hash: await hashChannels(channels),
    duration: buffer.duration,
  };
}

// ------------------------------------------------------------------------------------------
// Test API

async function renderHash(opts: RenderOptions): Promise<string> {
  return hashChannels(channelsOf(await render(opts)));
}

async function renderStats(opts: RenderOptions & { pitch?: boolean }): Promise<RenderStats> {
  return statsOf(await render(opts), opts.pitch ?? true);
}

/** The render's samples (base64, little-endian float32 per channel), for analysis elsewhere. */
async function renderRaw(
  opts: RenderOptions,
): Promise<{ sampleRate: number; left: string; right: string }> {
  const buffer = await render(opts);
  const [left, right] = channelsOf(buffer);
  return {
    sampleRate: buffer.sampleRate,
    left: float32ToBase64(left ?? new Float32Array(0)),
    right: float32ToBase64(right ?? left ?? new Float32Array(0)),
  };
}

async function renderCompare(
  a: RenderOptions,
  b: RenderOptions,
): Promise<{
  hashA: string;
  hashB: string;
  rmsA: number;
  rmsB: number;
  diffRms: number;
  maxDiff: number;
  /** Seconds of the first differing sample (−1 if identical). */
  firstDiffSec: number;
}> {
  const [ba, bb] = await Promise.all([render(a), render(b)]);
  const ca = channelsOf(ba);
  const cb = channelsOf(bb);
  let acc = 0;
  let n = 0;
  let maxDiff = 0;
  let firstDiff = -1;
  for (let c = 0; c < Math.min(ca.length, cb.length); c++) {
    const x = ca[c] ?? new Float32Array(0);
    const y = cb[c] ?? new Float32Array(0);
    const len = Math.min(x.length, y.length);
    for (let i = 0; i < len; i++) {
      const d = (x[i] ?? 0) - (y[i] ?? 0);
      if (d !== 0 && (firstDiff < 0 || i < firstDiff)) firstDiff = i;
      maxDiff = Math.max(maxDiff, Math.abs(d));
      acc += d * d;
    }
    n += len;
  }
  return {
    hashA: await hashChannels(ca),
    hashB: await hashChannels(cb),
    rmsA: overallRms(ca),
    rmsB: overallRms(cb),
    diffRms: n > 0 ? Math.sqrt(acc / n) : 0,
    maxDiff,
    firstDiffSec: firstDiff < 0 ? -1 : firstDiff / ba.sampleRate,
  };
}

interface WorkletResult {
  ok: boolean;
  maxError?: number;
  value?: number;
  state?: string;
  error?: string;
}

/** The example one-pole worklet loads and runs in both context types. */
async function workletCheck(): Promise<{ offline: WorkletResult; realtime: WorkletResult }> {
  const tau = 0.001;
  const sr = 48000;
  let offline: WorkletResult;
  try {
    const ctx = new OfflineAudioContext(1, 2400, sr);
    const node = await createOnePoleSmoother(ctx, tau);
    const src = ctx.createConstantSource();
    src.offset.value = 1;
    src.connect(node);
    node.connect(ctx.destination);
    src.start(0);
    const out = (await ctx.startRendering()).getChannelData(0);
    const a = 1 - Math.exp(-1 / (tau * sr));
    let maxError = 0;
    for (let n = 0; n < out.length; n++) {
      const expected = 1 - Math.pow(1 - a, n + 1);
      maxError = Math.max(maxError, Math.abs((out[n] ?? 0) - expected));
    }
    offline = { ok: maxError < 1e-4, maxError, value: out[out.length - 1] };
  } catch (err) {
    offline = { ok: false, error: String(err) };
  }

  let realtime: WorkletResult;
  const ctx = new AudioContext({ sampleRate: sr });
  try {
    await ctx.resume();
    const node = await createOnePoleSmoother(ctx, tau);
    const ran = new Promise<boolean>((resolve) => {
      node.port.onmessage = () => resolve(true);
      setTimeout(() => resolve(false), 4000);
    });
    const src = ctx.createConstantSource();
    src.offset.value = 1;
    const analyser = ctx.createAnalyser();
    src.connect(node);
    node.connect(analyser);
    analyser.connect(ctx.destination);
    src.start();
    const didRun = await ran;
    await new Promise((resolve) => setTimeout(resolve, 150));
    const data = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(data);
    const value = data[data.length - 1] ?? 0;
    realtime = { ok: didRun && Math.abs(value - 1) < 1e-3, value, state: ctx.state };
  } catch (err) {
    realtime = { ok: false, error: String(err), state: ctx.state };
  } finally {
    await ctx.close();
  }
  return { offline, realtime };
}

export interface ProbeOptions extends RenderOptions {
  /** Wall seconds after start to change properties. */
  editAt?: number;
  editProps?: Record<string, number>;
  /** Wall seconds after start to seek, and the composition time to seek to. */
  seekAt?: number;
  seekTo?: number;
  /**
   * Drag a property slider: set `prop` from `from` to `to` in `steps` steps (default 10) over
   * `seconds`. Without `steps` it moves one step per ~50 ms poll; with `steps` it has its own
   * timer, like a slider's input events.
   */
  drag?: {
    prop: string;
    from: number;
    to: number;
    startAt: number;
    seconds: number;
    steps?: number;
  };
  /** Wall seconds after start to pause, and milliseconds until playing on from there. */
  pauseAt?: number;
  resumeAfterMs?: number;
  /**
   * Block the main thread (a busy page) `at` wall seconds after start for `ms` milliseconds.
   * Longer than the scheduler's slack, the scheduled sound runs out and playback resyncs.
   */
  stall?: { at: number; ms: number };
  /** Return the raw left-channel samples of this many seconds around each action (debugging). */
  samplesAroundActions?: number;
  /** Return the raw samples (both channels) of this many seconds around the largest click. */
  samplesAroundMaxClick?: number;
  /**
   * Return the whole recording (from composition time 0 on) and the material's scheduling
   * calls, to locate a click relative to the engine's jumps (debugging).
   */
  raw?: boolean;
  /** Transport loop on. */
  loop?: boolean;
  /** Stop after this many wall seconds (default: when playback ends). */
  playSeconds?: number;
}

export interface ProbeResult {
  hopSec: number;
  previewRms: number[];
  offlineRms: number[];
  /** RMS-envelope correlation, preview vs offline, before any edit or seek. */
  correlation: number;
  /** Preview level relative to offline, dB, before any edit or seek. */
  levelDiffDb: number;
  /** Largest sample-to-sample jump anywhere in the preview recording. */
  maxJump: number;
  /** Where it happened: seconds after the (composition time 0) start of playback. */
  maxJumpAtSec: number;
  /** Envelopes of the whole preview recording, from the start of playback. */
  recording: { rms: number[]; jump: number[]; click: number[] };
  /** Largest sample-to-sample jump in the offline render. */
  offlineMaxJump: number;
  /** Composition seconds per wall second while playing. */
  clockRate: number;
  ended: boolean;
  wraps: number;
  /** Composition times sampled every ~50 ms from compositionTimeAt(). */
  times: number[];
  contextState: string;
  /**
   * Click check around each live action (edit, seek): the preview's largest second
   * difference just after the action, and the largest in offline renders of the settings
   * before and after it at the same composition times. A click makes the first far larger.
   * The same for the largest sample-to-sample jump (a snap).
   */
  actions: {
    kind: ActionKind;
    recSec: number;
    /** Composition times before and after the action. */
    compFrom: number;
    compTo: number;
    /** With `samplesAroundActions`: raw left-channel samples centred on the action. */
    samples?: number[];
    /** Peak level 40–12 ms before the action (before any dip). */
    levelBefore: number;
    /**
     * Longest stretch, in milliseconds, within 12 ms before to 30 ms after the action where
     * every 1 ms window peaks below 3% of `levelBefore`: a jump there is not heard.
     */
    quietMs: number;
    previewClick: number;
    referenceClick: number;
    previewJump: number;
    referenceJump: number;
    /**
     * The click check made on the signal going into the output limiter (see
     * `beforeLimiter` in analysis.ts), for the preview and the references alike. It differs
     * from the pair above only where the output went past the limiter's knee (0.8).
     */
    previewClickBeforeLimiter: number;
    referenceClickBeforeLimiter: number;
  }[];
  /** How the engine's scheduler kept up (see AudioEngine.schedulerStats). */
  scheduler: SchedulerStats;
  /** Milliseconds each setProps call took (edits and drag steps), in order. */
  setPropsMs: number[];
  /** Largest gap between the probe's ~50 ms polls: how long the main thread was busy. */
  maxPollGapMs: number;
  /** With `samplesAroundMaxClick`: where the largest click is and the samples around it. */
  maxClick?: { recSec: number; value: number; left: number[]; right: number[] };
  /**
   * Where the audio thread ran late and caught up by rendering several quanta back to back
   * (seconds into the recording, quanta in the burst): a sign of the main thread holding up
   * the audio thread. Harmless to the recording.
   */
  bursts: { recSec: number; quanta: number }[];
  /** Render quanta that never reached the recorder (seconds into the recording, frames). */
  skips: { recSec: number; frames: number }[];
  /** With `raw`: the recording from composition time 0 on (base64, little-endian float32). */
  raw?: { sampleRate: number; left: string; right: string };
  /**
   * With `raw`: the material's scheduling calls in order, in seconds into the recording. A
   * seek or resync shows as a cancel at the jump followed by a window starting there.
   */
  trace?: { kind: 'schedule' | 'cancel'; recSec: number; t0?: number; t1?: number }[];
}

/** Base64 of a Float32Array's bytes (little-endian on every platform Chrome runs on). */
function float32ToBase64(data: Float32Array): string {
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/**
 * The entry, with its material's `schedule` and `cancelFrom` calls logged in context time
 * (the calls themselves are unchanged).
 */
function tracedEntry(
  entry: SoundMaterialEntry,
  log: { kind: 'schedule' | 'cancel'; ctx: number; t0?: number; t1?: number }[],
): SoundMaterialEntry {
  return {
    ...entry,
    create: () => {
      const material = entry.create();
      const schedule = material.schedule.bind(material);
      const cancelFrom = material.cancelFrom.bind(material);
      material.schedule = (win) => {
        log.push({ kind: 'schedule', ctx: win.ctxTimeAtT0, t0: win.t0, t1: win.t1 });
        schedule(win);
      };
      material.cancelFrom = (ctxTime) => {
        log.push({ kind: 'cancel', ctx: ctxTime });
        cancelFrom(ctxTime);
      };
      return material;
    },
  };
}

type ActionKind = 'edit' | 'seek' | 'pause' | 'play' | 'drag' | 'stall';

/**
 * Play through the preview engine in real time, record its output, and compare it with the
 * offline render of the same composition.
 */
async function previewProbe(opts: ProbeOptions): Promise<ProbeResult> {
  const entry = entryFor(opts.materialId);
  const ctx = new AudioContext({ sampleRate: 48000 });
  await ctx.resume();
  await ctx.audioWorklet.addModule(recorderUrl);
  const recorder = new AudioWorkletNode(ctx, 'sp-recorder', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: 'explicit',
  });
  recorder.connect(ctx.destination);
  const batches: { frame: number; left: Float32Array; right: Float32Array }[] = [];
  const bursts: { frame: number; quanta: number }[] = [];
  const skips: { frame: number; to: number }[] = [];
  let onFlushed: (() => void) | null = null;
  recorder.port.onmessage = (
    event: MessageEvent<{
      type: string;
      frame?: number;
      quanta?: number;
      to?: number;
      left?: Float32Array;
      right?: Float32Array;
    }>,
  ) => {
    const msg = event.data;
    if (msg.type === 'batch' && msg.left && msg.right && msg.frame !== undefined) {
      batches.push({ frame: msg.frame, left: msg.left, right: msg.right });
    } else if (msg.type === 'burst' && msg.frame !== undefined && msg.quanta !== undefined) {
      bursts.push({ frame: msg.frame, quanta: msg.quanta });
    } else if (msg.type === 'skip' && msg.frame !== undefined && msg.to !== undefined) {
      skips.push({ frame: msg.frame, to: msg.to });
    } else if (msg.type === 'flushed') onFlushed?.();
  };

  const engine = new AudioEngine({
    context: ctx,
    destination: recorder,
    masterGain: opts.masterGain,
  });
  const sampler = makeSampler(opts);
  const props = propsFor(entry, opts.props);
  const callLog: { kind: 'schedule' | 'cancel'; ctx: number; t0?: number; t1?: number }[] = [];
  const played = opts.raw ? tracedEntry(entry, callLog) : entry;
  await engine.load({ entry: played, sampler, props, seed: opts.seed ?? 1 });
  let ended = false;
  let wraps = 0;
  engine.onEnded = () => {
    ended = true;
  };
  engine.onLoop = () => {
    wraps++;
  };
  engine.setLoop(opts.loop ?? false);
  engine.resetSchedulerStats();
  await engine.play(0);
  const probeCtx = ctx.currentTime + 0.05;
  const offset = probeCtx - engine.timeAtContextTime(probeCtx);

  const startWall = performance.now();
  const times: number[] = [];
  const wallTimes: number[] = [];
  let edited = false;
  let sought = false;
  let paused = false;
  let stalled = false;
  let dragStep = -1;
  let dragTimer: ReturnType<typeof setInterval> | null = null;
  let currentProps = props;
  let stallInfo: { startCtx: number; comp: number } | null = null;
  let lastPoll = startWall;
  let maxPollGapMs = 0;
  const setPropsMs: number[] = [];
  const actions: {
    kind: ActionKind;
    ctx: number;
    compFrom: number;
    /** Composition span heard before the action (default compFrom − 0.05 … + 0.2). */
    fromSpan?: [number, number];
    compTo: number;
    before: PropertyValues;
    after: PropertyValues;
  }[] = [];
  const soon = (): number => ctx.currentTime + 0.03;
  const limit = (opts.playSeconds ?? sampler.duration + 1) * 1000;
  // The main thread's cost of a property change, including work it leaves for right after
  // (microtasks and queued tasks): time until a message posted now comes back.
  const channel = new MessageChannel();
  const pendingTimings: (() => void)[] = [];
  channel.port1.onmessage = () => pendingTimings.shift()?.();
  const setPropsTimed = (next: PropertyValues): void => {
    const t0 = performance.now();
    engine.setProps(next);
    pendingTimings.push(() => setPropsMs.push(performance.now() - t0));
    channel.port2.postMessage(null);
  };
  const dragTo = (kind: ActionKind, next: PropertyValues): void => {
    const at = soon();
    const comp = engine.timeAtContextTime(at);
    actions.push({
      kind,
      ctx: at,
      compFrom: comp,
      compTo: comp,
      before: currentProps,
      after: next,
    });
    currentProps = next;
    setPropsTimed(next);
  };
  await new Promise<void>((resolve) => {
    const poll = setInterval(() => {
      const now = performance.now();
      maxPollGapMs = Math.max(maxPollGapMs, now - lastPoll);
      lastPoll = now;
      const elapsed = (now - startWall) / 1000;
      times.push(engine.compositionTimeAt(now));
      wallTimes.push(now);
      if (!edited && opts.editAt !== undefined && elapsed >= opts.editAt) {
        edited = true;
        dragTo('edit', { ...props, ...opts.editProps });
      }
      const drag = opts.drag;
      if (drag && elapsed >= drag.startAt && drag.steps === undefined && dragStep < 10) {
        // One slider step per poll (~50 ms), like a hand dragging a slider.
        const step = Math.min(10, Math.floor(((elapsed - drag.startAt) / drag.seconds) * 10));
        if (step > dragStep) {
          dragStep = step;
          const value = drag.from + ((drag.to - drag.from) * step) / 10;
          dragTo('drag', { ...currentProps, [drag.prop]: value });
        }
      }
      if (drag?.steps !== undefined && elapsed >= drag.startAt && dragTimer === null) {
        // Many small steps on their own timer, like a slider's input events.
        const steps = Math.max(1, Math.round(drag.steps));
        const stepOnce = (): void => {
          dragStep++;
          const value = drag.from + ((drag.to - drag.from) * Math.min(dragStep, steps)) / steps;
          dragTo('drag', { ...currentProps, [drag.prop]: value });
          if (dragStep >= steps && dragTimer !== null) clearInterval(dragTimer);
        };
        dragTimer = setInterval(stepOnce, (drag.seconds * 1000) / steps);
        stepOnce();
      }
      if (!stalled && opts.stall && elapsed >= opts.stall.at) {
        stalled = true;
        const startCtx = ctx.currentTime;
        const comp = engine.timeAtContextTime(startCtx);
        // Where the scheduled sound runs out (the map clamps to the end of the schedule).
        const frozenAt = engine.timeAtContextTime(Number.MAX_VALUE);
        const until = performance.now() + opts.stall.ms;
        while (performance.now() < until) {
          // Busy: nothing else on the main thread runs, the scheduler included.
        }
        // Checked like a seek at the resync (placed once the engine reports it): from the
        // sound as it froze where the schedule ran out to where playback would have been had
        // nothing stalled. Nothing after the freeze point was heard, so the reference for
        // that side stops just after it.
        stallInfo = { startCtx, comp };
        actions.push({
          kind: 'stall',
          ctx: ctx.currentTime,
          compFrom: frozenAt,
          fromSpan: [frozenAt - 0.05, frozenAt + 0.02],
          compTo: comp + (ctx.currentTime - startCtx),
          before: currentProps,
          after: currentProps,
        });
      }
      if (!paused && opts.pauseAt !== undefined && elapsed >= opts.pauseAt) {
        paused = true;
        const at = soon();
        const comp = engine.timeAtContextTime(at);
        engine.pause();
        const where = engine.compositionTime();
        const common = { compFrom: comp, compTo: comp, before: currentProps, after: currentProps };
        actions.push({ kind: 'pause', ctx: at, ...common });
        setTimeout(() => {
          actions.push({ kind: 'play', ctx: soon(), ...common, compFrom: where, compTo: where });
          void engine.play();
        }, opts.resumeAfterMs ?? 0);
      }
      if (!sought && opts.seekAt !== undefined && elapsed >= opts.seekAt) {
        sought = true;
        const at = soon();
        const target = opts.seekTo ?? 0;
        actions.push({
          kind: 'seek',
          ctx: at,
          compFrom: engine.timeAtContextTime(at),
          compTo: target,
          before: currentProps,
          after: currentProps,
        });
        engine.seek(target);
      }
      if (ended || now - startWall > limit) {
        clearInterval(poll);
        if (dragTimer !== null) clearInterval(dragTimer);
        resolve();
      }
    }, 50);
  });
  const scheduler = engine.schedulerStats;
  const stallAction = actions.find((a) => a.kind === 'stall');
  // Assigned inside the poll callback; TypeScript can't see that.
  const stalledAt = stallInfo as { startCtx: number; comp: number } | null;
  if (stallAction && stalledAt && Number.isFinite(scheduler.lastResyncAt)) {
    stallAction.ctx = scheduler.lastResyncAt;
    stallAction.compTo = stalledAt.comp + (scheduler.lastResyncAt - stalledAt.startCtx);
  }
  engine.pause();
  await new Promise((resolve) => setTimeout(resolve, 100));
  await new Promise<void>((resolve) => {
    onFlushed = resolve;
    recorder.port.postMessage('flush');
    setTimeout(resolve, 1000);
  });
  const contextState = ctx.state;
  await engine.dispose();
  await ctx.close();

  // Assemble the recording and align it to composition time.
  batches.sort((a, b) => a.frame - b.frame);
  const first = batches[0]?.frame ?? 0;
  const last = batches.reduce((m, b) => Math.max(m, b.frame + b.left.length), first);
  const left = new Float32Array(last - first);
  const right = new Float32Array(last - first);
  for (const b of batches) {
    left.set(b.left, b.frame - first);
    right.set(b.right, b.frame - first);
  }
  const sr = 48000;
  const startFrame = Math.round(offset * sr) - first;
  const compareSec =
    Math.min(
      opts.seconds,
      opts.editAt ?? Number.POSITIVE_INFINITY,
      opts.seekAt ?? Number.POSITIVE_INFINITY,
      opts.stall?.at ?? Number.POSITIVE_INFINITY,
    ) - 0.05;
  const n = Math.max(0, Math.floor(compareSec * sr));
  const pl = left.slice(Math.max(0, startFrame), Math.max(0, startFrame) + n);
  const pr = right.slice(Math.max(0, startFrame), Math.max(0, startFrame) + n);
  const previewEnv = envelopes([pl, pr], sr, 0.01);
  const fromStart = Math.max(0, startFrame);
  const fullEnv = envelopes([left.slice(fromStart), right.slice(fromStart)], sr, 0.01);
  const fullEnvBefore = envelopes(
    beforeLimiter([left.slice(fromStart), right.slice(fromStart)]),
    sr,
    0.01,
  );
  const maxJump = Math.max(0, ...fullEnv.jump);

  const offlineBuffer = await render({ ...opts, normalize: false });
  const oc = channelsOf(offlineBuffer).map((c) => c.slice(0, n));
  const offlineEnv = envelopes(oc, sr, 0.01);
  const offlineFull = envelopes(channelsOf(offlineBuffer), sr, 0.01);

  // Click check around each action.
  const clickMax = (env: number[], fromSec: number, toSec: number): number =>
    Math.max(0, ...env.slice(Math.max(0, Math.floor(fromSec / 0.01)), Math.ceil(toSec / 0.01)));
  /** Peak absolute sample (either channel) between two recording times, seconds. */
  const peakIn = (fromSec: number, toSec: number): number => {
    let p = 0;
    const i1 = Math.min(left.length, fromStart + Math.round(toSec * sr));
    for (let i = Math.max(0, fromStart + Math.round(fromSec * sr)); i < i1; i++) {
      p = Math.max(p, Math.abs(left[i] ?? 0), Math.abs(right[i] ?? 0));
    }
    return p;
  };
  const actionResults: ProbeResult['actions'] = [];
  interface RefEnvelopes {
    click: number[];
    jump: number[];
    clickBeforeLimiter: number[];
  }
  const refCache = new Map<string, RefEnvelopes>();
  const refEnvelopes = async (p: PropertyValues): Promise<RefEnvelopes> => {
    const key = JSON.stringify(p);
    let env = refCache.get(key);
    if (!env) {
      const ref = channelsOf(await render({ ...opts, props: p, normalize: false }));
      const out = envelopes(ref, sr, 0.01);
      const unlimited = envelopes(beforeLimiter(ref), sr, 0.01);
      env = { click: out.click, jump: out.jump, clickBeforeLimiter: unlimited.click };
      refCache.set(key, env);
    }
    return env;
  };
  const before = 0.02;
  const after = 0.15;
  for (const a of actions) {
    const recSec = a.ctx - offset;
    const previewClick = clickMax(fullEnv.click, recSec - before, recSec + after);
    const previewJump = clickMax(fullEnv.jump, recSec - before, recSec + after);
    const previewClickBeforeLimiter = clickMax(
      fullEnvBefore.click,
      recSec - before,
      recSec + after,
    );
    // Every setting heard inside the window: this action's before and after, plus any later
    // action that lands inside it (a slider drag changes values every ~50 ms).
    const settings = [a.before, a.after];
    for (const b of actions) {
      const t = b.ctx - offset;
      if (b !== a && t > recSec && t < recSec + after) settings.push(b.after);
    }
    // The material's own content around the composition times on both sides of the action.
    const spans: [number, number][] = [
      a.fromSpan ?? [a.compFrom - 0.05, a.compFrom + 0.2],
      [a.compTo - 0.05, a.compTo + 0.2],
    ];
    let referenceClick = 0;
    let referenceJump = 0;
    let referenceClickBeforeLimiter = 0;
    for (const p of settings) {
      const env = await refEnvelopes(p);
      for (const [from, to] of spans) {
        referenceClick = Math.max(referenceClick, clickMax(env.click, from, to));
        referenceJump = Math.max(referenceJump, clickMax(env.jump, from, to));
        referenceClickBeforeLimiter = Math.max(
          referenceClickBeforeLimiter,
          clickMax(env.clickBeforeLimiter, from, to),
        );
      }
    }
    const half = Math.round(((opts.samplesAroundActions ?? 0) * sr) / 2);
    const centre = fromStart + Math.round(recSec * sr);
    const levelBefore = peakIn(recSec - 0.04, recSec - 0.012);
    let quietMs = 0;
    let run = 0;
    for (let ms = -12; ms < 30; ms++) {
      const w = recSec + ms / 1000;
      run = peakIn(w, w + 0.001) <= 0.03 * levelBefore ? run + 1 : 0;
      quietMs = Math.max(quietMs, run);
    }
    actionResults.push({
      kind: a.kind,
      recSec,
      compFrom: a.compFrom,
      compTo: a.compTo,
      samples: half > 0 ? Array.from(left.slice(centre - half, centre + half)) : undefined,
      levelBefore,
      quietMs,
      previewClick,
      referenceClick,
      previewJump,
      referenceJump,
      previewClickBeforeLimiter,
      referenceClickBeforeLimiter,
    });
  }

  let maxClick: ProbeResult['maxClick'];
  if (opts.samplesAroundMaxClick) {
    let value = 0;
    let at = fromStart;
    for (let i = fromStart + 2; i < left.length; i++) {
      for (const data of [left, right]) {
        const c = Math.abs((data[i] ?? 0) - 2 * (data[i - 1] ?? 0) + (data[i - 2] ?? 0));
        if (c > value) {
          value = c;
          at = i;
        }
      }
    }
    const half = Math.round((opts.samplesAroundMaxClick * sr) / 2);
    maxClick = {
      recSec: (at - fromStart) / sr,
      value,
      left: Array.from(left.slice(at - half, at + half)),
      right: Array.from(right.slice(at - half, at + half)),
    };
  }

  const sumP = previewEnv.rms.reduce((s, x) => s + x, 0);
  const sumO = offlineEnv.rms.reduce((s, x) => s + x, 0);
  const span = (wallTimes[wallTimes.length - 1] ?? 0) - (wallTimes[0] ?? 0);
  const rateSamples = times.length >= 2 && span > 0;
  return {
    hopSec: previewEnv.hopSec,
    previewRms: previewEnv.rms,
    offlineRms: offlineEnv.rms,
    correlation: correlation(previewEnv.rms, offlineEnv.rms),
    levelDiffDb: sumO > 0 && sumP > 0 ? 20 * Math.log10(sumP / sumO) : Number.NaN,
    maxJump,
    maxJumpAtSec: fullEnv.jump.indexOf(maxJump) * fullEnv.hopSec,
    recording: { rms: fullEnv.rms, jump: fullEnv.jump, click: fullEnv.click },
    offlineMaxJump: Math.max(0, ...offlineFull.jump),
    clockRate: rateSamples ? clockRateOf(times, wallTimes) : Number.NaN,
    ended,
    wraps,
    times,
    contextState,
    actions: actionResults,
    scheduler,
    setPropsMs,
    maxPollGapMs,
    maxClick,
    bursts: bursts.map((b) => ({ recSec: (b.frame - first - fromStart) / sr, quanta: b.quanta })),
    skips: skips.map((s) => ({
      recSec: (s.frame - first - fromStart) / sr,
      frames: s.to - s.frame,
    })),
    raw: opts.raw
      ? {
          sampleRate: sr,
          left: float32ToBase64(left.slice(fromStart)),
          right: float32ToBase64(right.slice(fromStart)),
        }
      : undefined,
    trace: opts.raw
      ? callLog.map((c) => ({ kind: c.kind, recSec: c.ctx - offset, t0: c.t0, t1: c.t1 }))
      : undefined,
  };
}

/** Slope of composition time over wall time across the first contiguous stretch. */
function clockRateOf(times: number[], wallMs: number[]): number {
  let end = 1;
  while (end < times.length && (times[end] ?? 0) >= (times[end - 1] ?? 0)) end++;
  const i0 = Math.min(2, end - 1);
  const i1 = end - 1;
  const dt = (times[i1] ?? 0) - (times[i0] ?? 0);
  const dw = ((wallMs[i1] ?? 0) - (wallMs[i0] ?? 0)) / 1000;
  return dw > 0 ? dt / dw : Number.NaN;
}

function listMaterials(): {
  id: string;
  name: string;
  version: number;
  properties: PropertyDef[];
}[] {
  return listSoundMaterials().map((e) => ({
    id: e.meta.id,
    name: e.meta.name,
    version: e.meta.version,
    properties: e.meta.properties,
  }));
}

declare global {
  interface Window {
    spSound: {
      listMaterials: typeof listMaterials;
      renderHash: typeof renderHash;
      renderStats: typeof renderStats;
      renderRaw: typeof renderRaw;
      renderCompare: typeof renderCompare;
      workletCheck: typeof workletCheck;
      previewProbe: typeof previewProbe;
    };
  }
}

window.spSound = {
  listMaterials,
  renderHash,
  renderStats,
  renderRaw,
  renderCompare,
  workletCheck,
  previewProbe,
};

// ------------------------------------------------------------------------------------------
// Interactive page

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing #${id}`);
  return found as T;
}

const ui = {
  material: el<HTMLSelectElement>('material'),
  kind: el<HTMLSelectElement>('kind'),
  seed: el<HTMLInputElement>('seed'),
  loops: el<HTMLInputElement>('loops'),
  tail: el<HTMLInputElement>('tail'),
  props: el<HTMLDivElement>('props'),
  baseline: el<HTMLButtonElement>('baseline'),
  play: el<HTMLButtonElement>('play'),
  loop: el<HTMLInputElement>('loop'),
  mute: el<HTMLInputElement>('mute'),
  seek: el<HTMLInputElement>('seek'),
  time: el<HTMLSpanElement>('time'),
  render: el<HTMLButtonElement>('render'),
  player: el<HTMLAudioElement>('player'),
  download: el<HTMLAnchorElement>('download'),
  status: el<HTMLDivElement>('status'),
  plot: el<HTMLCanvasElement>('plot'),
};

let engine: AudioEngine | null = null;
let props: PropertyValues = {};
let sampler: SignatureSampler | null = null;
let needsLoad = true;
let seeking = false;

function currentEntry(): SoundMaterialEntry {
  return entryFor(ui.material.value);
}

function settings(): Omit<RenderOptions, 'materialId' | 'seconds'> {
  return {
    kind: ui.kind.value as SyntheticKind,
    seed: Number(ui.seed.value) || 0,
    loops: Math.min(8, Math.max(1, Number(ui.loops.value) || 1)),
    tailSec: Math.min(10, Math.max(0, Number(ui.tail.value) || 0)),
  };
}

function buildPropertyControls(): void {
  const entry = currentEntry();
  props = baselineValues(entry.meta.properties);
  ui.props.replaceChildren();
  for (const def of entry.meta.properties) {
    const row = document.createElement('div');
    row.className = 'prop';
    const label = document.createElement('label');
    label.textContent = def.label;
    label.title = def.description;
    if (!def.primary) label.className = 'more';
    const output = document.createElement('output');
    let input: HTMLInputElement | HTMLSelectElement;
    if (def.kind === 'choice') {
      const select = document.createElement('select');
      (def.choices ?? []).forEach((choice, i) => select.add(new Option(choice, String(i))));
      select.value = String(def.default);
      input = select;
      output.textContent = '';
    } else {
      const range = document.createElement('input');
      range.type = 'range';
      range.min = '0';
      range.max = '1';
      range.step = '0.01';
      range.value = String(def.default);
      range.addEventListener('dblclick', () => {
        range.value = String(def.default);
        range.dispatchEvent(new Event('input'));
      });
      input = range;
      output.textContent = def.default.toFixed(2);
    }
    input.id = `prop-${def.id}`;
    input.setAttribute('aria-label', def.label);
    label.htmlFor = input.id;
    input.addEventListener('input', () => {
      props = { ...props, [def.id]: Number(input.value) };
      if (def.kind !== 'choice') output.textContent = Number(input.value).toFixed(2);
      engine?.setProps(props);
    });
    row.append(label, input, output);
    ui.props.append(row);
  }
}

async function ensureLoaded(): Promise<AudioEngine> {
  engine ??= new AudioEngine();
  if (needsLoad) {
    const s = settings();
    sampler = makeSampler(s);
    await engine.load({ entry: currentEntry(), sampler, props, seed: s.seed ?? 0 });
    needsLoad = false;
  }
  return engine;
}

async function togglePlay(): Promise<void> {
  const e = await ensureLoaded();
  if (e.playing) {
    e.pause();
    ui.play.textContent = 'Play';
  } else {
    await e.play();
    ui.play.textContent = 'Pause';
  }
}

function drawPlot(buffer: AudioBuffer, stats: RenderStats): void {
  const g = ui.plot.getContext('2d');
  if (!g) return;
  const w = ui.plot.width;
  const h = ui.plot.height;
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  const mono = channelsOf(buffer);
  const mid = h * 0.35;
  const amp = h * 0.3;
  g.fillStyle = '#5e6f7a';
  const per = Math.max(1, Math.floor(buffer.length / w));
  for (let x = 0; x < w; x++) {
    let lo = 0;
    let hi = 0;
    for (let i = x * per; i < Math.min(buffer.length, (x + 1) * per); i++) {
      for (const c of mono) {
        const v = c[i] ?? 0;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    g.fillRect(x, mid - hi * amp, 1, Math.max(1, (hi - lo) * amp));
  }
  const n = stats.rmsEnvelope.length;
  const maxRms = Math.max(1e-6, ...stats.rmsEnvelope);
  g.strokeStyle = '#7fb7c9';
  g.lineWidth = 2;
  g.beginPath();
  stats.rmsEnvelope.forEach((r, i) => {
    const x = (i / n) * w;
    const y = mid - (r / maxRms) * amp;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  });
  g.stroke();
  // Pitch in the lower band, log scale fitted to the detected range (at least an octave).
  const top = h * 0.7;
  const band = h * 0.26;
  const voiced = (stats.pitchTrack ?? []).filter((f) => f > 0);
  if (voiced.length === 0) return;
  let lo = Math.min(...voiced);
  let hi = Math.max(...voiced);
  if (hi / lo < 2) {
    const mid = Math.sqrt(lo * hi);
    lo = mid / Math.SQRT2;
    hi = mid * Math.SQRT2;
  }
  const yOf = (f: number): number => top + band - (Math.log2(f / lo) / Math.log2(hi / lo)) * band;
  g.fillStyle = '#d9a441';
  (stats.pitchTrack ?? []).forEach((f, i) => {
    if (f > 0) g.fillRect((i / n) * w, yOf(f), 3, 3);
  });
  g.fillStyle = '#9aabb5';
  g.font = '22px system-ui';
  g.fillText(`pitch ${Math.round(hi)} Hz`, 12, yOf(hi) + 8);
  g.fillText(`${Math.round(lo)} Hz`, 12, yOf(lo) + 8);
}

async function doRender(): Promise<void> {
  ui.render.disabled = true;
  ui.status.textContent = 'Rendering…';
  try {
    const s = settings();
    const sampler = makeSampler(s);
    const opts: RenderOptions = {
      ...s,
      materialId: ui.material.value,
      seconds: sampler.duration,
      props,
    };
    const t0 = performance.now();
    const buffer = await render(opts);
    const ms = performance.now() - t0;
    const stats = await statsOf(buffer, true);
    drawPlot(buffer, stats);
    const blob = encodeWav(channelsOf(buffer), buffer.sampleRate);
    const url = URL.createObjectURL(blob);
    ui.player.src = url;
    ui.download.href = url;
    ui.download.download = `sound-${opts.materialId}-${s.kind}-${String(s.seed)}.wav`;
    ui.download.hidden = false;
    ui.status.textContent = `Rendered ${buffer.duration.toFixed(2)} s in ${ms.toFixed(0)} ms. Hash ${stats.hash.slice(0, 12)}…`;
  } catch (err) {
    ui.status.textContent = `Render failed: ${String(err)}`;
  } finally {
    ui.render.disabled = false;
  }
}

function frame(ts: number): void {
  if (engine && sampler) {
    const t = engine.compositionTimeAt(ts);
    const d = engine.duration;
    ui.time.textContent = `${t.toFixed(2)} / ${d.toFixed(2)} s`;
    if (!seeking) ui.seek.value = String(d > 0 ? t / d : 0);
    if (!engine.playing) ui.play.textContent = 'Play';
  }
  requestAnimationFrame(frame);
}

function markReload(): void {
  needsLoad = true;
  if (engine?.playing) void ensureLoaded();
}

for (const entry of listSoundMaterials())
  ui.material.add(new Option(entry.meta.name, entry.meta.id));
buildPropertyControls();
ui.material.addEventListener('change', () => {
  buildPropertyControls();
  markReload();
});
for (const input of [ui.kind, ui.seed, ui.loops, ui.tail]) {
  input.addEventListener('change', markReload);
}
ui.baseline.addEventListener('click', () => {
  buildPropertyControls();
  engine?.setProps(props);
});
ui.play.addEventListener('click', () => void togglePlay());
ui.loop.addEventListener('change', () => engine?.setLoop(ui.loop.checked));
ui.mute.addEventListener('change', () => engine?.setMuted(ui.mute.checked));
ui.seek.addEventListener('pointerdown', () => (seeking = true));
ui.seek.addEventListener('pointerup', () => (seeking = false));
ui.seek.addEventListener('input', () => {
  if (engine) engine.seek(Number(ui.seek.value) * engine.duration);
});
ui.render.addEventListener('click', () => void doRender());
requestAnimationFrame(frame);
