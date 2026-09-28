/**
 * Visual materials harness: audition any registered visual material against the
 * synthetic signatures, with property sliders, transport, and a test API on
 * `window.spVisual` (used by tests/e2e/visual.spec.ts).
 *
 * URL options: ?material=water&kind=wink&quality=standard&seed=1&autoplay=0
 */
import { createRng } from '../../src/chance/prng';
import { baselineValues } from '../../src/materials/properties';
import { getVisualMaterial, listVisualMaterials } from '../../src/materials/registry';
import {
  FIXED_DT,
  type PropertyDef,
  type PropertyValues,
  type Quality,
  type VisualMaterial,
} from '../../src/materials/types';
import { getVisualContext, type RenderTargetOverrides } from '../../src/materials/visual/shared/gl';
import { WaterMaterial } from '../../src/materials/visual/water';
import { planSteps, stepsToReach } from '../../src/perf/fixedStep';
import { FpsMeter } from '../../src/perf/fpsMeter';
import { litFraction, meanLuma, renderOffscreen, sha256Hex } from '../../src/perf/offscreenRender';
import { createSyntheticSampler, type SyntheticKind } from '../../src/signature/synthetic';
import type { SignatureSampler } from '../../src/signature/types';

// ---------------------------------------------------------------------------------------
// Test API

export interface RenderOpts {
  materialId: string;
  kind: SyntheticKind;
  steps: number;
  props?: PropertyValues;
  seed?: number;
  width?: number;
  height?: number;
  quality?: Quality;
  /** Force capability fallbacks (Water only). */
  overrides?: RenderTargetOverrides;
}

export interface RenderStats {
  hash: string;
  meanLuma: number;
  litFraction: number;
  ms: number;
}

interface MaterialSummary {
  id: string;
  name: string;
  version: number;
  properties: Pick<PropertyDef, 'id' | 'label' | 'kind' | 'primary' | 'default' | 'choices'>[];
}

export interface SpVisualApi {
  ready: boolean;
  listMaterials(): MaterialSummary[];
  renderHash(opts: RenderOpts): Promise<string>;
  meanLuma(opts: RenderOpts): Promise<number>;
  renderStats(opts: RenderOpts): Promise<RenderStats>;
  renderImage(opts: RenderOpts): Promise<string>;
  renderFilmstrip(opts: RenderOpts & { checkpoints: number[] }): Promise<string[]>;
}

declare global {
  interface Window {
    spVisual?: SpVisualApi;
  }
}

function creatorFor(opts: RenderOpts): () => VisualMaterial {
  if (opts.overrides && opts.materialId === 'water') {
    const overrides = opts.overrides;
    return () => new WaterMaterial({ overrides });
  }
  const entry = getVisualMaterial(opts.materialId);
  if (!entry) throw new Error(`No visual material "${opts.materialId}".`);
  return entry.create;
}

function samplerFor(kind: SyntheticKind): SignatureSampler {
  return createSyntheticSampler(kind);
}

async function render(
  opts: RenderOpts,
  extra: Partial<Parameters<typeof renderOffscreen>[0]> = {},
) {
  return renderOffscreen({
    create: creatorFor(opts),
    sampler: samplerFor(opts.kind),
    steps: Math.max(0, Math.floor(opts.steps)),
    props: opts.props,
    seed: opts.seed ?? 1,
    quality: opts.quality ?? 'draft',
    width: opts.width ?? 480,
    height: opts.height ?? 270,
    ...extra,
  });
}

const api: SpVisualApi = {
  ready: false,
  listMaterials: () =>
    listVisualMaterials().map((entry) => ({
      id: entry.meta.id,
      name: entry.meta.name,
      version: entry.meta.version,
      properties: entry.meta.properties.map((p) => ({
        id: p.id,
        label: p.label,
        kind: p.kind,
        primary: p.primary,
        default: p.default,
        choices: p.choices,
      })),
    })),
  async renderHash(opts) {
    return sha256Hex((await render(opts)).pixels);
  },
  async meanLuma(opts) {
    return meanLuma((await render(opts)).pixels);
  },
  async renderStats(opts) {
    const start = performance.now();
    const { pixels } = await render(opts);
    const ms = performance.now() - start;
    return {
      hash: await sha256Hex(pixels),
      meanLuma: meanLuma(pixels),
      litFraction: litFraction(pixels),
      ms,
    };
  },
  async renderImage(opts) {
    let url = '';
    await render(opts, {
      onCapture: (step, canvas) => {
        if (step === opts.steps) url = canvas.toDataURL('image/png');
      },
    });
    return url;
  },
  async renderFilmstrip(opts) {
    const urls: string[] = [];
    const checkpoints = opts.checkpoints.filter((c) => c < opts.steps);
    await render(opts, {
      checkpoints,
      onCapture: (_step, canvas) => urls.push(canvas.toDataURL('image/png')),
    });
    return urls;
  },
};
window.spVisual = api;

// ---------------------------------------------------------------------------------------
// Interactive stage

const params = new URLSearchParams(location.search);
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('stage');
const materialSelect = $<HTMLSelectElement>('material');
const kindSelect = $<HTMLSelectElement>('kind');
const qualitySelect = $<HTMLSelectElement>('quality');
const seedInput = $<HTMLInputElement>('seed');
const tailInput = $<HTMLInputElement>('tail');
const propsPanel = $<HTMLDivElement>('props');
const playButton = $<HTMLButtonElement>('play');
const seekInput = $<HTMLInputElement>('seek');
const timeLabel = $<HTMLSpanElement>('time');
const fpsLabel = $<HTMLSpanElement>('fps');
const statusLine = $<HTMLDivElement>('status');
const baselineButton = $<HTMLButtonElement>('baseline');

for (const entry of listVisualMaterials()) {
  const option = document.createElement('option');
  option.value = entry.meta.id;
  option.textContent = entry.meta.name;
  materialSelect.append(option);
}
materialSelect.value = params.get('material') ?? 'water';
kindSelect.value = params.get('kind') ?? 'wink';
qualitySelect.value = params.get('quality') ?? 'standard';
seedInput.value = params.get('seed') ?? '1';

const gl = getVisualContext(canvas);
let material: VisualMaterial | null = null;
let sampler: SignatureSampler = samplerFor(kindSelect.value as SyntheticKind);
let props: PropertyValues = {};
let playing = params.get('autoplay') !== '0';
let stepIndex = 0;
let accumulator = 0;
let lastFrame = 0;
let dirty = true;
let generation = 0;
const fps = new FpsMeter();

function seed(): number {
  const value = Math.floor(Number(seedInput.value));
  return Number.isFinite(value) ? Math.min(999999, Math.max(0, value)) : 1;
}

function setStatus(extra = ''): void {
  const describe = (material as { describe?: () => string } | null)?.describe?.();
  statusLine.textContent = [
    `Canvas ${canvas.width}×${canvas.height} (device pixel ratio ${devicePixelRatio})`,
    describe,
    extra,
  ]
    .filter(Boolean)
    .join('\n');
}

function sizeCanvas(): boolean {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width * devicePixelRatio));
  const height = Math.max(1, Math.round(rect.height * devicePixelRatio));
  if (canvas.width === width && canvas.height === height) return false;
  canvas.width = width;
  canvas.height = height;
  return true;
}

function buildPropertyControls(defs: readonly PropertyDef[]): void {
  propsPanel.replaceChildren();
  for (const def of defs) {
    const row = document.createElement('div');
    row.className = 'row';
    const label = document.createElement('label');
    label.textContent = def.primary ? def.label : `${def.label} (more)`;
    label.htmlFor = `prop-${def.id}`;
    label.title = def.description;
    row.append(label);
    if (def.kind === 'choice') {
      const select = document.createElement('select');
      select.id = `prop-${def.id}`;
      (def.choices ?? []).forEach((choice, i) => {
        const option = document.createElement('option');
        option.value = String(i);
        option.textContent = choice;
        select.append(option);
      });
      select.value = String(props[def.id] ?? def.default);
      select.addEventListener('change', () => setProperty(def.id, Number(select.value)));
      row.append(select);
    } else {
      const input = document.createElement('input');
      input.type = 'range';
      input.id = `prop-${def.id}`;
      input.min = '0';
      input.max = '1';
      input.step = '0.01';
      input.value = String(props[def.id] ?? def.default);
      const output = document.createElement('output');
      output.value = Number(input.value).toFixed(2);
      input.addEventListener('input', () => {
        output.value = Number(input.value).toFixed(2);
        setProperty(def.id, Number(input.value));
      });
      input.addEventListener('dblclick', () => {
        input.value = String(def.default);
        output.value = def.default.toFixed(2);
        setProperty(def.id, def.default);
      });
      row.append(input, output);
    }
    propsPanel.append(row);
  }
}

function setProperty(id: string, value: number): void {
  props = { ...props, [id]: value };
  applyProperties();
}

/** Show display-only changes while paused (materials that offer setProperties). */
function applyProperties(): void {
  (material as { setProperties?: (p: PropertyValues) => void } | null)?.setProperties?.(props);
  dirty = true;
}

async function mountMaterial(): Promise<void> {
  if (!gl) {
    statusLine.textContent = 'WebGL2 is not available in this browser.';
    return;
  }
  const mine = ++generation;
  material?.dispose();
  material = null;
  const entry = getVisualMaterial(materialSelect.value);
  if (!entry) return;
  sizeCanvas();
  const next = entry.create();
  props = baselineValues(entry.meta.properties);
  buildPropertyControls(entry.meta.properties);
  try {
    await next.init({
      gl,
      width: canvas.width,
      height: canvas.height,
      quality: qualitySelect.value as Quality,
      seed: seed(),
      rng: createRng(seed()),
    });
  } catch (error) {
    next.dispose();
    statusLine.textContent = `Could not start ${entry.meta.name}: ${String(error)}`;
    return;
  }
  if (mine !== generation) {
    next.dispose();
    return;
  }
  material = next;
  restart();
  setStatus();
}

function restart(): void {
  sampler = samplerFor(kindSelect.value as SyntheticKind);
  sampler.configure({ tailSec: Number(tailInput.value) || 0 });
  material?.reset(seed());
  stepIndex = 0;
  accumulator = 0;
  dirty = true;
}

function stepOnce(): void {
  if (!material) return;
  material.step(sampler.sample(stepIndex * FIXED_DT), props, FIXED_DT);
  stepIndex++;
  if (stepIndex * FIXED_DT >= sampler.duration) {
    // Loop the composition: back to the seeded initial state.
    material.reset(seed());
    stepIndex = 0;
  }
}

function seekTo(t: number): void {
  if (!material) return;
  const start = performance.now();
  material.reset(seed());
  stepIndex = 0;
  const target = stepsToReach(t, FIXED_DT);
  for (let i = 0; i < target; i++) {
    material.step(sampler.sample(stepIndex * FIXED_DT), props, FIXED_DT);
    stepIndex++;
  }
  accumulator = 0;
  dirty = true;
  const ms = performance.now() - start;
  setStatus(`Seek to ${t.toFixed(2)} s: ${target} steps in ${ms.toFixed(0)} ms`);
}

function frame(now: number): void {
  const elapsed = lastFrame > 0 ? (now - lastFrame) / 1000 : 0;
  lastFrame = now;
  if (sizeCanvas()) {
    material?.resize(canvas.width, canvas.height);
    dirty = true;
    setStatus();
  }
  if (playing && material) {
    const plan = planSteps(accumulator, elapsed, FIXED_DT);
    accumulator = plan.accumulator;
    for (let i = 0; i < plan.steps; i++) stepOnce();
    dirty = dirty || plan.steps > 0;
  }
  if (material && dirty) {
    material.draw();
    dirty = false;
  }
  fps.tick(now);
  const t = stepIndex * FIXED_DT;
  timeLabel.textContent = `${t.toFixed(2)} / ${sampler.duration.toFixed(2)} s`;
  fpsLabel.textContent = `${fps.fps.toFixed(0)} fps`;
  if (document.activeElement !== seekInput) {
    seekInput.value = String(Math.round((t / Math.max(1e-6, sampler.duration)) * 1000));
  }
  requestAnimationFrame(frame);
}

playButton.textContent = playing ? 'Pause' : 'Play';
playButton.addEventListener('click', () => {
  playing = !playing;
  playButton.textContent = playing ? 'Pause' : 'Play';
  accumulator = 0;
});
seekInput.addEventListener('input', () => {
  seekTo((Number(seekInput.value) / 1000) * sampler.duration);
});
materialSelect.addEventListener('change', () => void mountMaterial());
qualitySelect.addEventListener('change', () => void mountMaterial());
seedInput.addEventListener('change', () => restart());
kindSelect.addEventListener('change', () => restart());
tailInput.addEventListener('change', () => restart());
baselineButton.addEventListener('click', () => {
  if (!material) return;
  props = baselineValues(material.properties);
  buildPropertyControls(material.properties);
  applyProperties();
});
canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  statusLine.textContent = 'The graphics context was lost. Reload the page.';
});

void mountMaterial().then(() => {
  api.ready = true;
  requestAnimationFrame(frame);
});
