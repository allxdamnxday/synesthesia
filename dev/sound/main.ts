/**
 * Sound materials harness: audition registered sound materials with synthetic signatures,
 * live through the preview engine and offline through the render path, and expose
 * `window.spSound` for the Playwright tests (tests/e2e/sound.spec.ts).
 */
import { AudioEngine } from '../../src/engine/audio/AudioEngine';
import { renderSoundOffline } from '../../src/engine/audio/offline';
import { baselineValues } from '../../src/materials/properties';
import { getSoundMaterial, listSoundMaterials } from '../../src/materials/registry';
import { createOnePoleSmoother } from '../../src/materials/sound/shared/worklets';
import type { PropertyDef, PropertyValues, SoundMaterialEntry } from '../../src/materials/types';
import { createSyntheticSampler, type SyntheticKind } from '../../src/signature/synthetic';
import type { LoopMode, SignatureSampler } from '../../src/signature/types';
import {
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
  /** Largest sample-to-sample jump in the offline render. */
  offlineMaxJump: number;
  /** Composition seconds per wall second while playing. */
  clockRate: number;
  ended: boolean;
  wraps: number;
  /** Composition times sampled every ~50 ms from compositionTimeAt(). */
  times: number[];
  contextState: string;
}

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
  let onFlushed: (() => void) | null = null;
  recorder.port.onmessage = (
    event: MessageEvent<{
      type: string;
      frame?: number;
      left?: Float32Array;
      right?: Float32Array;
    }>,
  ) => {
    const msg = event.data;
    if (msg.type === 'batch' && msg.left && msg.right && msg.frame !== undefined) {
      batches.push({ frame: msg.frame, left: msg.left, right: msg.right });
    } else if (msg.type === 'flushed') onFlushed?.();
  };

  const engine = new AudioEngine({ context: ctx, destination: recorder });
  const sampler = makeSampler(opts);
  const props = propsFor(entry, opts.props);
  await engine.load({ entry, sampler, props, seed: opts.seed ?? 1 });
  let ended = false;
  let wraps = 0;
  engine.onEnded = () => {
    ended = true;
  };
  engine.onLoop = () => {
    wraps++;
  };
  engine.setLoop(opts.loop ?? false);
  await engine.play(0);
  const probeCtx = ctx.currentTime + 0.05;
  const offset = probeCtx - engine.timeAtContextTime(probeCtx);

  const startWall = performance.now();
  const times: number[] = [];
  const wallTimes: number[] = [];
  let edited = false;
  let sought = false;
  const limit = (opts.playSeconds ?? sampler.duration + 1) * 1000;
  await new Promise<void>((resolve) => {
    const poll = setInterval(() => {
      const now = performance.now();
      const elapsed = (now - startWall) / 1000;
      times.push(engine.compositionTimeAt(now));
      wallTimes.push(now);
      if (!edited && opts.editAt !== undefined && elapsed >= opts.editAt) {
        edited = true;
        engine.setProps({ ...props, ...opts.editProps });
      }
      if (!sought && opts.seekAt !== undefined && elapsed >= opts.seekAt) {
        sought = true;
        engine.seek(opts.seekTo ?? 0);
      }
      if (ended || now - startWall > limit) {
        clearInterval(poll);
        resolve();
      }
    }, 50);
  });
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
    ) - 0.05;
  const n = Math.max(0, Math.floor(compareSec * sr));
  const pl = left.slice(Math.max(0, startFrame), Math.max(0, startFrame) + n);
  const pr = right.slice(Math.max(0, startFrame), Math.max(0, startFrame) + n);
  const previewEnv = envelopes([pl, pr], sr, 0.01);
  const fullEnv = envelopes([left, right], sr, 0.01);

  const offlineBuffer = await render({ ...opts, normalize: false });
  const oc = channelsOf(offlineBuffer).map((c) => c.slice(0, n));
  const offlineEnv = envelopes(oc, sr, 0.01);
  const offlineFull = envelopes(channelsOf(offlineBuffer), sr, 0.01);

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
    maxJump: Math.max(0, ...fullEnv.jump),
    offlineMaxJump: Math.max(0, ...offlineFull.jump),
    clockRate: rateSamples ? clockRateOf(times, wallTimes) : Number.NaN,
    ended,
    wraps,
    times,
    contextState,
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
  // Pitch (log scale, 100 Hz – 3.2 kHz) in the lower band.
  const top = h * 0.7;
  const band = h * 0.28;
  g.fillStyle = '#d9a441';
  (stats.pitchTrack ?? []).forEach((f, i) => {
    if (!(f > 0)) return;
    const y = top + band - (Math.log2(f / 100) / 5) * band;
    g.fillRect((i / n) * w, y, 3, 3);
  });
  g.fillStyle = '#9aabb5';
  g.font = '22px system-ui';
  g.fillText('pitch, 100 Hz – 3.2 kHz', 12, top + 22);
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
