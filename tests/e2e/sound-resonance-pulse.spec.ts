/**
 * A4 Resonance and A5 Pulse (SPEC 9.5), measured through the sound harness (dev/sound,
 * window.spSound). tests/e2e/sound.spec.ts already checks what every sound material must do;
 * this spec pins down what these two promise: Resonance strikes at onsets and each Body sounds
 * different; Pulse plucks at onsets, quickens with energy, and locks to a grid when rigid; both
 * worklets run offline and in real time in the built app.
 *
 * The synthetic wink's onsets fall at 0.700 s (the close) and 1.233 s (the open).
 */
import { expect, test, type Page } from '@playwright/test';

interface RenderOptions {
  materialId: string;
  kind: 'wink' | 'sweep' | 'still' | 'swirl';
  seconds: number;
  props?: Record<string, number>;
  seed?: number;
  tailSec?: number;
  strength?: number;
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
  pitchTrack?: number[];
  centroid?: number[];
  hash: string;
}

interface ProbeOptions extends RenderOptions {
  /** Wall seconds after start to seek, and the composition time to seek to. */
  seekAt?: number;
  seekTo?: number;
  /** Stop after this many wall seconds (default: when playback ends). */
  playSeconds?: number;
}

interface ProbeResult {
  correlation: number;
  levelDiffDb: number;
  ended: boolean;
  contextState: string;
  /** RMS envelope (hop 0.01 s) of the whole preview, from composition time 0's start. */
  recording: { rms: number[] };
  /** Each live action, with its time in seconds into the recording. */
  actions: { kind: string; recSec: number }[];
}

interface MaterialInfo {
  id: string;
  properties: { id: string; kind: 'continuous' | 'choice'; choices?: string[] }[];
}

interface SpSound {
  listMaterials(): MaterialInfo[];
  renderHash(o: RenderOptions): Promise<string>;
  renderStats(o: RenderOptions): Promise<RenderStats>;
  previewProbe(o: ProbeOptions): Promise<ProbeResult>;
}

const CLOSE = 0.7;
const OPEN = 1.2333;
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
    { name, args },
  )) as Awaited<ReturnType<SpSound[K]>>;
}

const dB = (x: number): number => 20 * Math.log10(Math.max(1e-9, x));

/** Largest value of an envelope between two times. */
function maxIn(s: RenderStats, env: number[], from: number, to: number): number {
  return Math.max(...env.slice(Math.round(from / s.hopSec), Math.round(to / s.hopSec)));
}

/** Median of the non-zero values of an envelope between two times. */
function medianIn(s: RenderStats, env: number[], from: number, to: number): number {
  const v = env
    .slice(Math.round(from / s.hopSec), Math.round(to / s.hopSec))
    .filter((x) => x > 0)
    .sort((a, b) => a - b);
  return v[Math.floor(v.length / 2)] ?? 0;
}

/**
 * Attack times from the RMS envelope: a hop at least twice as loud as the one before it and
 * above −40 dB of the loudest hop (plucks with a short ring separate cleanly).
 */
function attacks(s: RenderStats): number[] {
  const env = s.rmsEnvelope;
  const loudest = Math.max(...env);
  const out: number[] = [];
  for (let i = 1; i < env.length; i++) {
    const rise = (env[i] ?? 0) > 2 * (env[i - 1] ?? 0) && (env[i] ?? 0) > 0.01 * loudest;
    if (rise && (out.length === 0 || i * s.hopSec - (out[out.length - 1] ?? 0) > 0.025)) {
      out.push(i * s.hopSec);
    }
  }
  return out;
}

test.describe('A4 Resonance and A5 Pulse', () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
  });

  test.afterEach(() => {
    expect(errors).toEqual([]);
  });

  test('Resonance strikes the wink at its close and its open, for every body', async ({ page }) => {
    for (const body of [0, 1, 2]) {
      const s = await sp(page, 'renderStats', {
        materialId: 'resonance',
        kind: 'wink',
        seconds: 2.4,
        props: { body },
        normalize: false,
        pitch: false,
      });
      const env = s.rmsEnvelope;
      for (const [name, onset] of [
        ['close', CLOSE],
        ['open', OPEN],
      ] as const) {
        const before = maxIn(s, env, onset - 0.06, onset - 0.015);
        const after = maxIn(s, env, onset, onset + 0.04);
        // A clear event: at least 12 dB above what came just before.
        expect(dB(after / before), `body ${body}: ${name} strike`).toBeGreaterThan(12);
      }
      // The strongest rise of the whole render sits at one of the two onsets.
      let best = 1;
      for (let i = 1; i < env.length; i++) {
        if (
          (env[i] ?? 0) / Math.max(1e-6, env[i - 1] ?? 0) >
          (env[best] ?? 0) / Math.max(1e-6, env[best - 1] ?? 0)
        )
          best = i;
      }
      const at = best * s.hopSec;
      expect(
        Math.min(Math.abs(at - CLOSE), Math.abs(at - OPEN)),
        `body ${body}: largest rise at ${at}`,
      ).toBeLessThan(0.025);
    }
  });

  test('Resonance: each body has its own spectrum and ring', async ({ page }) => {
    const bodies = [];
    for (const body of [0, 1, 2]) {
      const s = await sp(page, 'renderStats', {
        materialId: 'resonance',
        kind: 'wink',
        seconds: 2.4,
        props: { body, dispersion: 0 },
        normalize: false,
      });
      bodies.push({
        centroid: medianIn(s, s.centroid ?? [], CLOSE + 0.01, 0.95),
        ring: dB(maxIn(s, s.rmsEnvelope, 0.95, 1.0) / maxIn(s, s.rmsEnvelope, CLOSE, CLOSE + 0.04)),
      });
    }
    const [glass, wood, metal] = bodies;
    // Glass rings highest, metal lowest.
    expect(glass?.centroid ?? 0).toBeGreaterThan(1.6 * (wood?.centroid ?? 0));
    expect(wood?.centroid ?? 0).toBeGreaterThan(1.1 * (metal?.centroid ?? 0));
    // Wood's knock dies soonest; metal rings on longest.
    expect(wood?.ring ?? 0).toBeLessThan((glass?.ring ?? 0) - 6);
    expect(metal?.ring ?? 0).toBeGreaterThan(wood?.ring ?? 0);
  });

  test('Resonance: the primary properties move the sound the way they say', async ({ page }) => {
    const stats = (props: Record<string, number>) =>
      sp(page, 'renderStats', {
        materialId: 'resonance',
        kind: 'wink',
        seconds: 2.6,
        props: { dispersion: 0, ...props },
        normalize: false,
      });
    const centroid = (s: RenderStats) => medianIn(s, s.centroid ?? [], CLOSE + 0.01, 0.9);
    // Rigidity: harder, brighter strikes. Viscosity: muffled, darker.
    expect(centroid(await stats({ rigidity: 0.9 }))).toBeGreaterThan(
      centroid(await stats({ rigidity: 0.1 })),
    );
    expect(centroid(await stats({ viscosity: 0.9 }))).toBeLessThan(
      0.8 * centroid(await stats({ viscosity: 0.1 })),
    );
    // Elasticity: the close rings on further into the hold.
    const ring = (s: RenderStats) =>
      dB(maxIn(s, s.rmsEnvelope, 1.1, 1.18) / maxIn(s, s.rmsEnvelope, CLOSE, CLOSE + 0.04));
    expect(ring(await stats({ elasticity: 0.9 }))).toBeGreaterThan(
      ring(await stats({ elasticity: 0.1 })) + 3,
    );
    // Persistence: a longer tail after the movement ends.
    const tail = (s: RenderStats) =>
      dB(maxIn(s, s.rmsEnvelope, 2.1, 2.4) / maxIn(s, s.rmsEnvelope, OPEN, OPEN + 0.04));
    expect(tail(await stats({ persistence: 0.9 }))).toBeGreaterThan(
      tail(await stats({ persistence: 0.1 })) + 20,
    );
    // Intensity: louder.
    expect((await stats({ intensity: 0.9 })).rms).toBeGreaterThan(
      2 * (await stats({ intensity: 0.1 })).rms,
    );
  });

  test('Pulse plucks the wink at its close and its open', async ({ page }) => {
    for (const seed of [1, 2, 3]) {
      const s = await sp(page, 'renderStats', {
        materialId: 'pulse',
        kind: 'wink',
        seconds: 2.4,
        seed,
        normalize: false,
        pitch: false,
      });
      const found = attacks(s);
      for (const onset of [CLOSE, OPEN]) {
        const nearest = Math.min(...found.map((t) => Math.abs(t - onset)));
        expect(nearest, `seed ${seed}: pluck at ${onset}`).toBeLessThan(0.015);
      }
      // Silent before the movement starts.
      expect(maxIn(s, s.rmsEnvelope, 0, 0.5)).toBe(0);
    }
  });

  test('Pulse quickens as the movement gathers energy', async ({ page }) => {
    const count = async (strength: number) =>
      attacks(
        await sp(page, 'renderStats', {
          materialId: 'pulse',
          kind: 'sweep',
          seconds: 3.2,
          strength,
          props: { density: 1, persistence: 0.1 },
          normalize: false,
          pitch: false,
        }),
      ).length;
    const gentle = await count(0.5);
    const strong = await count(2);
    expect(strong).toBeGreaterThan(gentle * 1.3);
  });

  test('Pulse: high Rigidity lands plucks on a steady grid', async ({ page }) => {
    // Range 0.5: the grid is the fastest pulse rate, 6 × √(expLerp(1.5, 12, 0.5)) ≈ 12.37 Hz.
    const period = 1 / (6 * Math.sqrt(1.5 * Math.sqrt(12 / 1.5)));
    const onGridShare = async (rigidity: number) => {
      const s = await sp(page, 'renderStats', {
        materialId: 'pulse',
        kind: 'sweep',
        seconds: 3.2,
        props: { rigidity, density: 1, persistence: 0.1 },
        normalize: false,
        pitch: false,
      });
      const found = attacks(s);
      // The attack lies within the hop found; compare the hop's centre with the grid.
      const onGrid = found.filter((t) => {
        const phase = ((t + s.hopSec / 2) / period) % 1;
        return Math.min(phase, 1 - phase) * period < 0.011;
      });
      return { share: onGrid.length / Math.max(1, found.length), count: found.length };
    };
    const rigid = await onGridShare(1);
    const free = await onGridShare(0.5);
    expect(rigid.count).toBeGreaterThan(6);
    expect(rigid.share).toBeGreaterThan(0.9);
    expect(free.share).toBeLessThan(0.75);
  });

  test('Pulse: Density fills the pulse and Persistence lets plucks ring', async ({ page }) => {
    const stats = (props: Record<string, number>) =>
      sp(page, 'renderStats', {
        materialId: 'pulse',
        kind: 'sweep',
        seconds: 3.2,
        props: { persistence: 0.1, ...props },
        normalize: false,
        pitch: false,
      });
    expect(attacks(await stats({ density: 0.9 })).length).toBeGreaterThan(
      attacks(await stats({ density: 0.1 })).length + 3,
    );
    const tail = (s: RenderStats) =>
      dB(maxIn(s, s.rmsEnvelope, 2.9, 3.1) / Math.max(...s.rmsEnvelope));
    expect(tail(await stats({ persistence: 0.9 }))).toBeGreaterThan(
      tail(await stats({ persistence: 0.1 })) + 20,
    );
  });

  test('renders are bit-identical at high Density, every choice and the property extremes', async ({
    page,
  }) => {
    // Many modes or strings sounding at once is where a summing order that varied between runs
    // would show (see mixPairwise in shared/graph.ts); both materials sum inside a worklet.
    const list = await sp(page, 'listMaterials');
    const extremes = (id: string, level: 0 | 1): Record<string, number> => {
      const props: Record<string, number> = {};
      for (const p of list.find((m) => m.id === id)?.properties ?? []) {
        props[p.id] = p.kind === 'choice' ? level * ((p.choices?.length ?? 1) - 1) : level;
      }
      return props;
    };
    const cases: RenderOptions[] = [];
    for (const materialId of ['resonance', 'pulse']) {
      cases.push(
        { materialId, kind: 'sweep', seconds: 2.4, props: { density: 1 } },
        { materialId, kind: 'wink', seconds: 2, props: extremes(materialId, 0) },
        { materialId, kind: 'sweep', seconds: 2.4, props: extremes(materialId, 1) },
        {
          materialId,
          kind: 'swirl',
          seconds: 2.4,
          props: { ...extremes(materialId, 1), range: 0 },
        },
      );
    }
    cases.push(
      { materialId: 'resonance', kind: 'wink', seconds: 2, props: { body: 1 } },
      { materialId: 'resonance', kind: 'sweep', seconds: 2, props: { body: 2, density: 1 } },
      { materialId: 'pulse', kind: 'sweep', seconds: 2, props: { scale: 0 } },
      { materialId: 'pulse', kind: 'wink', seconds: 2, props: { scale: 2, rigidity: 1 } },
    );
    for (const c of cases) {
      const label = `${c.materialId} ${c.kind} ${JSON.stringify(c.props)}`;
      const first = await sp(page, 'renderHash', c);
      expect(await sp(page, 'renderHash', c), label).toBe(first);
      expect(await sp(page, 'renderHash', { ...c, windowSec: 0.05 }), `${label}, windowed`).toBe(
        first,
      );
    }
    // The busiest settings, five times over.
    for (const materialId of ['resonance', 'pulse']) {
      const busiest: RenderOptions = {
        materialId,
        kind: 'sweep',
        seconds: 2.4,
        props: { ...extremes(materialId, 1), density: 1, range: 1 },
      };
      const hashes = new Set<string>();
      for (let i = 0; i < 5; i++) hashes.add(await sp(page, 'renderHash', busiest));
      expect(hashes.size, `${materialId}: five renders of the busiest settings`).toBe(1);
    }
  });

  test('both worklets run offline and in real time in the built app', async ({ page }) => {
    for (const materialId of ['resonance', 'pulse']) {
      const offline = await sp(page, 'renderStats', {
        materialId,
        kind: 'wink',
        seconds: 2,
        normalize: false,
        pitch: false,
      });
      expect(offline.rms, `${materialId}: offline`).toBeGreaterThan(0.01);
      const live = await sp(page, 'previewProbe', {
        materialId,
        kind: 'wink',
        seconds: 2,
        tailSec: 0.5,
      });
      expect(live.contextState, `${materialId}: real time`).toBe('running');
      expect(live.ended).toBe(true);
      expect(live.correlation, `${materialId}: preview follows the render`).toBeGreaterThan(0.9);
      expect(Math.abs(live.levelDiffDb), `${materialId}: preview level`).toBeLessThan(1.5);
    }
  });

  test('a seek onto an onset, or just before one, still strikes it', async ({ page }) => {
    // From the still start (nothing ringing) to the close: exactly onto its onset (a round
    // time, on the control grid) and 3 ms before it (inside the material's own seek dip,
    // before the body or strings are silenced). The strike must sound as in the render: not
    // skipped by the landing, not erased by the reset.
    const HOP = 0.01;
    const rmsOver = (env: number[], from: number, to: number): number => {
      const v = env.slice(Math.round(from / HOP), Math.round(to / HOP));
      return Math.sqrt(v.reduce((sum, x) => sum + x * x, 0) / Math.max(1, v.length));
    };
    for (const materialId of ['resonance', 'pulse']) {
      const render = await sp(page, 'renderStats', {
        materialId,
        kind: 'wink',
        seconds: 1.2,
        normalize: false,
        pitch: false,
      });
      for (const target of [CLOSE, CLOSE - 0.003]) {
        const probe = await sp(page, 'previewProbe', {
          materialId,
          kind: 'wink',
          seconds: 1.2,
          seekAt: 0.3,
          seekTo: target,
        });
        const seek = probe.actions.find((a) => a.kind === 'seek');
        expect(seek, `${materialId}: the seek happened`).toBeDefined();
        const landed = seek?.recSec ?? 0;
        // After the dips (the engine's, ~21 ms; the material's, ~40 ms), before the open.
        const preview = rmsOver(probe.recording.rms, landed + 0.06, landed + 0.2);
        const reference = rmsOver(render.rmsEnvelope, target + 0.05, target + 0.19);
        expect(dB(preview), `${materialId}: seek to ${target.toFixed(3)} s`).toBeGreaterThan(
          dB(reference) - 6,
        );
      }
    }
  });
});
