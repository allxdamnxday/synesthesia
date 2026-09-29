/**
 * Sound engine and sound materials (SPEC 9.1, 9.3, 9.5, 15.1; Milestone 3), driven through
 * the harness page dev/sound (window.spSound). Every registered sound material is checked.
 */
import { expect, test, type Page } from '@playwright/test';

interface PropertyInfo {
  id: string;
  kind: 'continuous' | 'choice';
  primary: boolean;
  choices?: string[];
}

interface MaterialInfo {
  id: string;
  name: string;
  properties: PropertyInfo[];
}

interface RenderOptions {
  materialId: string;
  kind: 'wink' | 'sweep' | 'still' | 'swirl';
  seconds: number;
  props?: Record<string, number>;
  seed?: number;
  loops?: number;
  tailSec?: number;
  excerpt?: [number, number];
  normalize?: boolean;
  windowSec?: number;
  pitch?: boolean;
}

interface RenderStats {
  peak: number;
  rms: number;
  hopSec: number;
  rmsEnvelope: number[];
  jumpEnvelope: number[];
  clickEnvelope: number[];
  pitchTrack?: number[];
  hash: string;
}

interface CompareResult {
  hashA: string;
  hashB: string;
  rmsA: number;
  rmsB: number;
  diffRms: number;
}

interface ProbeResult {
  correlation: number;
  levelDiffDb: number;
  maxJump: number;
  offlineMaxJump: number;
  clockRate: number;
  ended: boolean;
  wraps: number;
  times: number[];
  contextState: string;
  actions: {
    kind: 'edit' | 'seek' | 'pause' | 'play' | 'drag';
    recSec: number;
    previewClick: number;
    referenceClick: number;
    /** The same check on the signal going into the output limiter (dev/sound/analysis.ts). */
    previewClickBeforeLimiter: number;
    referenceClickBeforeLimiter: number;
  }[];
}

interface WorkletResult {
  ok: boolean;
  maxError?: number;
  value?: number;
  error?: string;
}

interface SpSound {
  listMaterials(): MaterialInfo[];
  renderHash(o: RenderOptions): Promise<string>;
  renderStats(o: RenderOptions): Promise<RenderStats>;
  renderCompare(a: RenderOptions, b: RenderOptions): Promise<CompareResult>;
  workletCheck(): Promise<{ offline: WorkletResult; realtime: WorkletResult }>;
  previewProbe(
    o: RenderOptions & {
      editAt?: number;
      editProps?: Record<string, number>;
      seekAt?: number;
      seekTo?: number;
      drag?: { prop: string; from: number; to: number; startAt: number; seconds: number };
      pauseAt?: number;
      resumeAfterMs?: number;
      loop?: boolean;
      playSeconds?: number;
    },
  ): Promise<ProbeResult>;
}

/** −1 dBFS, plus float32 rounding. */
const NORMALIZED_PEAK = Math.pow(10, -1 / 20) + 1e-6;

const errors: string[] = [];

async function open(page: Page): Promise<void> {
  errors.length = 0;
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.goto('./dev/sound/');
  await page.waitForFunction(() => 'spSound' in window);
}

/** Call a window.spSound function in the page. */
async function sp<K extends keyof SpSound>(
  page: Page,
  name: K,
  ...args: Parameters<SpSound[K]>
): Promise<Awaited<ReturnType<SpSound[K]>>> {
  return (await page.evaluate(
    ({ name, args }) => {
      const api = (window as unknown as { spSound: Record<string, (...a: unknown[]) => unknown> })
        .spSound;
      return api[name]?.(...args);
    },
    { name, args: args as unknown[] },
  )) as Awaited<ReturnType<SpSound[K]>>;
}

async function materials(page: Page): Promise<MaterialInfo[]> {
  const list = await sp(page, 'listMaterials');
  expect(list.length).toBeGreaterThan(0);
  return list;
}

test.describe('sound materials', () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
  });

  test.afterEach(() => {
    expect(errors).toEqual([]);
  });

  test('offline renders are bitwise identical, and match preview-sized windows', async ({
    page,
  }) => {
    for (const m of await materials(page)) {
      const opts: RenderOptions = { materialId: m.id, kind: 'wink', seconds: 2 };
      const first = await sp(page, 'renderHash', opts);
      const second = await sp(page, 'renderHash', opts);
      expect(second, `${m.id}: two renders`).toBe(first);
      // Scheduling in 50 ms windows (as the preview does) writes the same samples.
      const windowed = await sp(page, 'renderHash', { ...opts, windowSec: 0.05 });
      expect(windowed, `${m.id}: windowed scheduling`).toBe(first);
      const other = await sp(page, 'renderHash', { ...opts, seed: 2 });
      expect(other, `${m.id}: another seed`).not.toBe(first);
    }
  });

  test('offline renders are bitwise identical at every setting (SPEC C6)', async ({ page }) => {
    test.setTimeout(300_000);
    // Chrome adds up an audio input's connections in an order that depends on memory
    // addresses, so three or more sounding sources on one input change the last bits from
    // one render to the next. Settings that add voices (Density), open or lengthen sounds
    // (every primary property at both ends) or overlap one-shots (a burst of onsets) must
    // still render the same bits every time.
    for (const m of await materials(page)) {
      const wink: RenderOptions = { materialId: m.id, kind: 'wink', seconds: 2 };
      const has = (id: string) => m.properties.some((p) => p.id === id);
      const configs: [string, RenderOptions][] = [['baseline', wink]];
      if (has('density')) configs.push(['density 1', { ...wink, props: { density: 1 } }]);
      for (const p of m.properties.filter((q) => q.primary)) {
        const top = p.kind === 'choice' ? Math.max(1, (p.choices?.length ?? 2) - 1) : 1;
        configs.push([`${p.id} 0`, { ...wink, props: { [p.id]: 0 } }]);
        configs.push([`${p.id} ${top}`, { ...wink, props: { [p.id]: top } }]);
      }
      // An onset every 0.25 s (the wink's close, looped) with long, dense sounds: several
      // one-shots (e.g. Water's droplets) overlap all the time.
      const dense: Record<string, number> = {};
      if (has('persistence')) dense.persistence = 1;
      if (has('density')) dense.density = 1;
      configs.push([
        'overlapping onsets',
        { ...wink, seconds: 2.5, loops: 8, excerpt: [0.6, 0.85], tailSec: 0.5, props: dense },
      ]);
      for (const [label, opts] of configs) {
        const a = await sp(page, 'renderHash', opts);
        const b = await sp(page, 'renderHash', opts);
        expect(b, `${m.id}: ${label}`).toBe(a);
      }
    }
  });

  test('renders are audible, peak-normalized to −1 dBFS, and stillness sounds different', async ({
    page,
  }) => {
    for (const m of await materials(page)) {
      const wink = await sp(page, 'renderStats', {
        materialId: m.id,
        kind: 'wink',
        seconds: 2,
        pitch: false,
      });
      expect(wink.peak, `${m.id}: peak`).toBeLessThanOrEqual(NORMALIZED_PEAK);
      expect(wink.peak, `${m.id}: normalized up to the target`).toBeGreaterThan(0.85);
      expect(wink.rms, `${m.id}: not silent`).toBeGreaterThan(0.02);

      const raw = { materialId: m.id, seconds: 2, normalize: false, pitch: false } as const;
      const moving = await sp(page, 'renderStats', { ...raw, kind: 'wink' });
      const still = await sp(page, 'renderStats', { ...raw, kind: 'still' });
      expect(still.hash).not.toBe(moving.hash);
      expect(still.rms, `${m.id}: still vs wink loudness`).toBeLessThan(moving.rms * 0.25);
    }
  });

  test('every primary continuous property changes the sound', async ({ page }) => {
    for (const m of await materials(page)) {
      const primary = m.properties.filter((p) => p.primary && p.kind === 'continuous');
      expect(primary.length).toBeGreaterThan(0);
      for (const p of primary) {
        const base: RenderOptions = {
          materialId: m.id,
          kind: 'wink',
          seconds: 2,
          normalize: false,
        };
        const c = await sp(
          page,
          'renderCompare',
          { ...base, props: { [p.id]: 0.15 } },
          { ...base, props: { [p.id]: 0.85 } },
        );
        expect(c.hashA, `${m.id}.${p.id}`).not.toBe(c.hashB);
        expect(c.diffRms / Math.max(c.rmsA, c.rmsB), `${m.id}.${p.id}`).toBeGreaterThan(0.05);
      }
    }
  });

  test('loops are click-free at the loop boundary', async ({ page }) => {
    const cases: {
      name: string;
      opts: Omit<RenderOptions, 'materialId' | 'seconds'>;
      pass: number;
    }[] = [
      { name: 'wink, twice', opts: { kind: 'wink', loops: 2, tailSec: 0.5 }, pass: 2.2 },
      // Excerpts put the boundary in the middle of a movement: loud and moving on both sides.
      {
        name: 'cut mid-open',
        opts: { kind: 'wink', loops: 2, tailSec: 0.5, excerpt: [0.45, 1.3] },
        pass: 0.85,
      },
      {
        name: 'cut mid-close to mid-open',
        opts: { kind: 'wink', loops: 2, tailSec: 0.5, excerpt: [0.72, 1.3] },
        pass: 0.58,
      },
      {
        name: 'sweep cut mid-rise',
        opts: { kind: 'sweep', loops: 2, tailSec: 0.5, excerpt: [0.5, 2.2] },
        pass: 1.7,
      },
    ];
    for (const m of await materials(page)) {
      for (const c of cases) {
        const s = await sp(page, 'renderStats', {
          materialId: m.id,
          ...c.opts,
          seconds: c.pass * 2 + 0.5,
          normalize: false,
          pitch: false,
        });
        const b = Math.round(c.pass / s.hopSec);
        const near = (env: number[]) => Math.max(...env.slice(b - 3, b + 4));
        const elsewhere = (env: number[]) =>
          Math.max(...env.filter((_, i) => i < b - 5 || i > b + 5));
        const label = `${m.id}: ${c.name}`;
        // A click is a step in the waveform: it shows as a spike in the sample-to-sample
        // jump and, much more sharply, in the second difference.
        expect(near(s.jumpEnvelope), label).toBeLessThanOrEqual(
          elsewhere(s.jumpEnvelope) * 1.25 + 1e-3,
        );
        expect(near(s.clickEnvelope), label).toBeLessThanOrEqual(
          elsewhere(s.clickEnvelope) * 1.25 + 1e-3,
        );
      }
    }
  });

  test('A1 Water: rising movement rises in pitch', async ({ page }) => {
    // Synthetic sweep: across the field (0.3–1.7 s), then upward (1.8–2.6 s).
    const s = await sp(page, 'renderStats', {
      materialId: 'water',
      kind: 'sweep',
      seconds: 3.2,
      normalize: false,
    });
    const track = s.pitchTrack ?? [];
    const median = (a: number, b: number): number => {
      const v = track
        .slice(Math.round(a / s.hopSec), Math.round(b / s.hopSec))
        .filter((f) => f > 0)
        .sort((x, y) => x - y);
      return v[Math.floor(v.length / 2)] ?? 0;
    };
    const across = median(0.7, 1.4);
    const riseEarly = median(1.85, 2.05);
    const riseLate = median(2.3, 2.6);
    expect(across).toBeGreaterThan(0);
    const semitones = (a: number, b: number): number => 12 * Math.log2(b / a);
    expect(semitones(across, riseLate)).toBeGreaterThan(5);
    expect(semitones(riseEarly, riseLate)).toBeGreaterThan(5);
  });

  test('the example AudioWorklet loads and runs in both context types', async ({ page }) => {
    const result = await sp(page, 'workletCheck');
    expect(result.offline, JSON.stringify(result.offline)).toMatchObject({ ok: true });
    expect(result.realtime, JSON.stringify(result.realtime)).toMatchObject({ ok: true });
  });

  test('preview playback matches the offline render and keeps time', async ({ page }) => {
    for (const m of await materials(page)) {
      // With a single voice (Density 0), preview and offline differ only in oscillator
      // start phase, so the loudness contours must match closely: same automation, same
      // timing. At baseline, detuned voices beat against each other, and where the beat
      // falls depends on when the voices started, so the contour match is looser there
      // (inaudible as a difference, but it moves an RMS comparison).
      for (const [label, props, minCorrelation] of [
        ['one voice', { density: 0 }, 0.97],
        ['baseline', {}, 0.85],
      ] as const) {
        const p = await sp(page, 'previewProbe', {
          materialId: m.id,
          kind: 'wink',
          seconds: 2,
          tailSec: 0.5,
          props,
        });
        const name = `${m.id} (${label})`;
        expect(p.contextState).toBe('running');
        expect(p.ended, `${name}: reaches the end`).toBe(true);
        expect(p.correlation, `${name}: loudness contour`).toBeGreaterThan(minCorrelation);
        expect(Math.abs(p.levelDiffDb), `${name}: level`).toBeLessThan(1.5);
        expect(p.clockRate, `${name}: clock`).toBeGreaterThan(0.9);
        expect(p.clockRate, `${name}: clock`).toBeLessThan(1.1);
        expect(p.maxJump, `${name}: no clicks`).toBeLessThanOrEqual(p.offlineMaxJump * 1.5 + 0.02);
      }
    }
  });

  test('preview stays click-free through live edits, slider drags, seeks, pauses and loop wraps', async ({
    page,
  }) => {
    for (const m of await materials(page)) {
      const edits: Record<string, number> = {};
      for (const prop of m.properties) edits[prop.id] = prop.kind === 'choice' ? 2 : 0.9;
      const edited = await sp(page, 'previewProbe', {
        materialId: m.id,
        kind: 'wink',
        seconds: 2,
        tailSec: 0.5,
        editAt: 0.75,
        editProps: edits,
        seekAt: 1.6,
        seekTo: 0.62,
      });
      expect(edited.actions.map((a) => a.kind)).toEqual(['edit', 'seek']);
      for (const a of edited.actions) {
        // Around the action, the preview is no rougher than steady renders of the settings
        // before and after it at the same moments: no click from the change itself.
        //
        // A seek is checked on the signal going into the output limiter (identical wherever
        // the output stays below the limiter's knee). After the jump the preview still
        // carries the reverb tail of what played before it, which no steady render has. At
        // these loud settings that tail lifts the new sound's peaks deeper into the limiter's
        // soft clip than any render goes, and the soft clip rounding a peak reads as roughness
        // to a second-difference check though nothing clicked. Measured on Resonance (Metal,
        // everything at 0.9), 127 ms after the jump: 0.065–0.077 after the limiter in about
        // half the runs, against 0.034–0.036 before it and 0.035 in the renders.
        const [preview, reference] =
          a.kind === 'seek'
            ? [a.previewClickBeforeLimiter, a.referenceClickBeforeLimiter]
            : [a.previewClick, a.referenceClick];
        expect(preview, `${m.id}: ${a.kind} at ${a.recSec.toFixed(2)} s`).toBeLessThanOrEqual(
          reference * 1.5 + 0.01,
        );
      }
      // The seek shows up in the clock: time jumps back to ~0.62 s.
      const jumpedBack = edited.times.some((t, i) => i > 0 && t < (edited.times[i - 1] ?? 0) - 0.5);
      expect(jumpedBack, `${m.id}: seek moves the clock`).toBe(true);

      // Drag sliders by hand-sized steps (~50 ms apart) while the sound moves. Persistence
      // regenerates the reverb; a choice property steps through its values.
      const choice = m.properties.find((p) => p.kind === 'choice');
      const drags = [
        { prop: 'persistence', from: 0.2, to: 1 },
        ...(choice ? [{ prop: choice.id, from: 0, to: 2 }] : []),
      ];
      for (const d of drags) {
        const dragged = await sp(page, 'previewProbe', {
          materialId: m.id,
          kind: 'sweep',
          seconds: 2.8,
          tailSec: 0.5,
          drag: { ...d, startAt: 0.6, seconds: 0.5 },
          playSeconds: 2.2,
        });
        expect(dragged.actions.length, `${m.id}: ${d.prop} drag steps`).toBeGreaterThanOrEqual(4);
        for (const a of dragged.actions) {
          expect(a.previewClick, `${m.id}: ${d.prop} drag`).toBeLessThanOrEqual(
            a.referenceClick * 1.5 + 0.01,
          );
        }
      }

      // Pause mid-movement and play on almost at once (the pause is still fading out).
      const paused = await sp(page, 'previewProbe', {
        materialId: m.id,
        kind: 'sweep',
        seconds: 2.8,
        tailSec: 0.5,
        pauseAt: 1.0,
        resumeAfterMs: 10,
        playSeconds: 2.5,
      });
      expect(paused.actions.map((a) => a.kind)).toEqual(['pause', 'play']);
      for (const a of paused.actions) {
        expect(a.previewClick, `${m.id}: ${a.kind}`).toBeLessThanOrEqual(
          a.referenceClick * 1.5 + 0.01,
        );
      }

      // Transport loop over an excerpt that ends mid-movement: the wrap lands while the
      // sound is loud and moving, where a reset would click.
      const looped = await sp(page, 'previewProbe', {
        materialId: m.id,
        kind: 'wink',
        seconds: 0.8,
        tailSec: 0,
        excerpt: [0.45, 1.3],
        loop: true,
        playSeconds: 2.3,
      });
      expect(looped.wraps, `${m.id}: loop wraps`).toBeGreaterThanOrEqual(2);
      expect(looped.ended).toBe(false);
      expect(looped.maxJump, `${m.id}: loop wrap`).toBeLessThanOrEqual(
        looped.offlineMaxJump * 1.5 + 0.02,
      );
    }
  });
});
