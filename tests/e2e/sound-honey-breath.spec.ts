/**
 * A2 Honey and A3 Breath (SPEC 9.3, 9.5; Milestone 6), measured on offline renders through
 * the sound harness (dev/sound, window.spSound). Nobody listens in CI, so each behaviour a
 * label or the SPEC promises is checked by measurement: RMS envelope, stutter syllables,
 * pitch track (YIN) and spectral centroid.
 *
 * The synthetic wink: the eyelid closes 0.55–0.95 s (downward, and gathering with the cheek:
 * a contraction), rests, and opens 1.1–1.5 s (upward). Onsets at 0.70 s and 1.23 s.
 */
import { expect, test, type Page } from '@playwright/test';

interface RenderOptions {
  materialId: string;
  kind: 'wink' | 'sweep' | 'still' | 'swirl';
  seconds: number;
  props?: Record<string, number>;
  seed?: number;
  loops?: number;
  tailSec?: number;
  strength?: number;
  loopMode?: 'loop' | 'pingpong';
  normalize?: boolean;
  pitch?: boolean;
}

interface RenderStats {
  peak: number;
  rms: number;
  hopSec: number;
  rmsEnvelope: number[];
  pitchTrack?: number[];
  centroid?: number[];
}

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

async function stats(page: Page, opts: RenderOptions): Promise<RenderStats> {
  return (await page.evaluate(
    (o) =>
      (
        window as unknown as { spSound: { renderStats(o: unknown): Promise<unknown> } }
      ).spSound.renderStats(o),
    { normalize: false, ...opts },
  )) as RenderStats;
}

// --- Measurements ---------------------------------------------------------------------------

const dB = (x: number): number => (x > 0 ? 20 * Math.log10(x) : -200);
const range = (s: RenderStats, a: number, b: number): [number, number] => [
  Math.round(a / s.hopSec),
  Math.round(b / s.hopSec),
];
const slice = (s: RenderStats, series: number[], a: number, b: number): number[] =>
  series.slice(...range(s, a, b));
const maxDb = (s: RenderStats, a: number, b: number): number =>
  dB(Math.max(...slice(s, s.rmsEnvelope, a, b)));
const minDb = (s: RenderStats, a: number, b: number): number =>
  dB(Math.min(...slice(s, s.rmsEnvelope, a, b)));
/** Energy (mean square) of the RMS envelope over [a, b), in dB. */
const energyDb = (s: RenderStats, a: number, b: number): number => {
  const v = slice(s, s.rmsEnvelope, a, b);
  return dB(Math.sqrt(v.reduce((acc, x) => acc + x * x, 0) / Math.max(1, v.length)));
};
/** Loudness-weighted spectral centroid over [a, b), Hz. */
function centroid(s: RenderStats, a: number, b: number): number {
  const c = slice(s, s.centroid ?? [], a, b);
  const r = slice(s, s.rmsEnvelope, a, b);
  let num = 0;
  let den = 0;
  c.forEach((hz, i) => {
    const w = (r[i] ?? 0) ** 2;
    if (hz > 0) {
      num += w * hz;
      den += w;
    }
  });
  return den > 0 ? num / den : 0;
}
/** Median pitch (Hz) of the voiced frames in [a, b); 0 if none. */
function medianPitch(s: RenderStats, a: number, b: number): number {
  const v = slice(s, s.pitchTrack ?? [], a, b)
    .filter((f) => f > 0)
    .sort((x, y) => x - y);
  return v[Math.floor(v.length / 2)] ?? 0;
}
const semitones = (from: number, to: number): number => 12 * Math.log2(to / from);
/** Share of audible frames in [a, b) where the pitch tracker hears a tone. */
function voicedShare(s: RenderStats, a: number, b: number): number {
  const p = slice(s, s.pitchTrack ?? [], a, b);
  const r = slice(s, s.rmsEnvelope, a, b);
  let audible = 0;
  let voiced = 0;
  p.forEach((f, i) => {
    if ((r[i] ?? 0) > 0.003) {
      audible++;
      if (f > 0) voiced++;
    }
  });
  return audible > 0 ? voiced / audible : 0;
}
/**
 * Stutter syllables: peaks of the RMS envelope that rise at least `prominence` dB above the
 * preceding trough and fall at least as far after (hysteresis), within 40 dB of the peak.
 */
function syllables(s: RenderStats, a: number, b: number, prominence = 4): number[] {
  const env = s.rmsEnvelope.map(dB);
  const floor = Math.max(...env) - 40;
  const [i0, i1] = range(s, a, b);
  const peaks: number[] = [];
  let rising = false;
  let lo = Infinity;
  let hi = -Infinity;
  let hiAt = 0;
  for (let i = i0; i < Math.min(i1, env.length); i++) {
    const x = env[i] ?? -200;
    if (!rising) {
      lo = Math.min(lo, x);
      if (x >= lo + prominence) {
        rising = true;
        hi = x;
        hiAt = i;
      }
    } else {
      if (x > hi) {
        hi = x;
        hiAt = i;
      }
      if (x <= hi - prominence) {
        if (hi > floor) peaks.push(hiAt * s.hopSec);
        rising = false;
        lo = x;
      }
    }
  }
  return peaks;
}
/** Syllables per second over [a, b) (from the first to the last syllable found there). */
function stutterRate(s: RenderStats, a: number, b: number): number {
  const p = syllables(s, a, b);
  const first = p[0] ?? 0;
  const last = p[p.length - 1] ?? 0;
  return p.length >= 2 ? (p.length - 1) / (last - first) : 0;
}
/** Seconds after `from` until the RMS stays below (overall peak − dropDb). */
function ringsFor(s: RenderStats, from: number, dropDb: number): number {
  const env = s.rmsEnvelope;
  const limit = Math.max(...env) * Math.pow(10, -dropDb / 20);
  let last = Math.round(from / s.hopSec);
  for (let i = last; i < env.length; i++) if ((env[i] ?? 0) > limit) last = i;
  return last * s.hopSec - from;
}

const wink = (materialId: string, extra: Partial<RenderOptions> = {}): RenderOptions => ({
  materialId,
  kind: 'wink',
  seconds: 3.2,
  ...extra,
});

test.describe('A2 Honey and A3 Breath', () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
  });

  test.afterEach(() => {
    expect(errors).toEqual([]);
  });

  test("the wink's close and open read in Water, Honey and Breath alike (SPEC 9.3)", async ({
    page,
  }) => {
    for (const id of ['water', 'honey', 'breath']) {
      const s = await stats(page, wink(id, { seconds: 2.4, pitch: false }));
      const close = maxDb(s, 0.6, 1.0);
      const openPeak = maxDb(s, 1.15, 1.6);
      const gap = minDb(s, 1.0, 1.25);
      const peak = dB(Math.max(...s.rmsEnvelope));
      // Both gestures are loud, and something close to silence separates them.
      expect(close, `${id}: close`).toBeGreaterThan(peak - 6);
      expect(openPeak, `${id}: open`).toBeGreaterThan(peak - 6);
      expect(Math.min(close, openPeak) - gap, `${id}: gap`).toBeGreaterThan(10);
      // Nothing sounds before the movement starts.
      expect(maxDb(s, 0, 0.5), `${id}: before`).toBeLessThan(peak - 60);
    }
  });

  test('Honey stutters faster with faster movement, and slows as the honey settles', async ({
    page,
  }) => {
    const slow = await stats(page, wink('honey', { strength: 0.5, pitch: false }));
    const fast = await stats(page, wink('honey', { strength: 1.5, pitch: false }));
    const base = await stats(page, wink('honey', { pitch: false }));
    const rateSlow = stutterRate(slow, 0.6, 1.6);
    const rateFast = stutterRate(fast, 0.6, 1.6);
    expect(rateSlow).toBeGreaterThan(3);
    expect(rateFast).toBeGreaterThan(rateSlow + 1.5);
    // Within one wink: quick "roo"s while it moves, slow "rooo"s as it settles.
    expect(stutterRate(base, 0.6, 1.6)).toBeGreaterThan(stutterRate(base, 1.7, 3.2) + 1);
    // It is a stutter: several syllables, each at least 6 dB above the dips around it.
    expect(syllables(base, 0.6, 3.2, 6).length).toBeGreaterThanOrEqual(6);
  });

  test('Honey glides down at the end of each movement (the "oot"), low and slow', async ({
    page,
  }) => {
    const s = await stats(page, wink('honey', { props: { density: 0 } }));
    const risen = medianPitch(s, 1.55, 1.75); // after the open lifts it (with a lag)
    const oot = medianPitch(s, 1.95, 2.35); // as the honey settles
    const closeEnd = medianPitch(s, 1.0, 1.12); // the close's own fall
    const closeStart = medianPitch(s, 0.7, 0.9);
    expect(risen).toBeGreaterThan(0);
    expect(oot).toBeGreaterThan(0);
    expect(semitones(risen, oot)).toBeLessThan(-2);
    expect(semitones(closeStart, closeEnd)).toBeLessThan(-1);
    // Low: around A2 (110 Hz), two octaves below Water.
    expect(risen).toBeGreaterThan(80);
    expect(risen).toBeLessThan(160);
  });

  test('Honey and Water: the same wink in two substances', async ({ page }) => {
    const honey = await stats(page, wink('honey'));
    const water = await stats(page, wink('water'));
    // Both fall on the close and rise on the open…
    for (const [label, s] of [
      ['honey', honey],
      ['water', water],
    ] as const) {
      const afterClose = medianPitch(s, 1.0, 1.15);
      const afterOpen = medianPitch(s, 1.4, 1.75);
      expect(semitones(afterClose, afterOpen), `${label}: open rises`).toBeGreaterThan(2);
    }
    // …but Honey is two octaves lower, far darker, and drawn out long after the movement.
    expect(semitones(medianPitch(water, 1.4, 1.6), medianPitch(honey, 1.4, 1.75))).toBeLessThan(
      -18,
    );
    expect(centroid(honey, 0.6, 1.6)).toBeLessThan(centroid(water, 0.6, 1.6) * 0.6);
    expect(ringsFor(honey, 1.5, 30)).toBeGreaterThan(ringsFor(water, 1.5, 30) + 0.4);
  });

  test("Honey's primary properties do what their labels say", async ({ page }) => {
    const at = (props: Record<string, number>) => stats(page, wink('honey', { props }));
    // Viscosity: darker, slower stutter, longer drawn-out tail.
    const thin = await at({ viscosity: 0.15 });
    const thick = await at({ viscosity: 0.85 });
    expect(centroid(thick, 0.6, 2)).toBeLessThan(centroid(thin, 0.6, 2) * 0.75);
    expect(stutterRate(thick, 0.6, 1.6)).toBeLessThan(stutterRate(thin, 0.6, 1.6));
    expect(energyDb(thick, 1.8, 2.8)).toBeGreaterThan(energyDb(thin, 1.8, 2.8) + 4);
    // Elasticity: a more resonant (brighter-peaked) tone that bounces further in pitch.
    const loose = await at({ elasticity: 0.15 });
    const springy = await at({ elasticity: 0.85 });
    expect(centroid(springy, 0.6, 2)).toBeGreaterThan(centroid(loose, 0.6, 2) * 1.1);
    expect(
      semitones(medianPitch(springy, 1.1, 1.2), medianPitch(springy, 1.55, 1.75)),
    ).toBeGreaterThan(semitones(medianPitch(loose, 1.1, 1.2), medianPitch(loose, 1.55, 1.75)));
    // Persistence: a longer tail.
    const short = await at({ persistence: 0.15 });
    const long = await at({ persistence: 0.85 });
    expect(energyDb(long, 1.8, 2.8)).toBeGreaterThan(energyDb(short, 1.8, 2.8) + 6);
    // Brightness: brighter.
    const dark = await at({ brightness: 0.15 });
    const bright = await at({ brightness: 0.85 });
    expect(centroid(bright, 0.6, 2)).toBeGreaterThan(centroid(dark, 0.6, 2) * 3);
    // Intensity: louder.
    const soft = await at({ intensity: 0.15 });
    const loud = await at({ intensity: 0.85 });
    expect(dB(loud.rms) - dB(soft.rms)).toBeGreaterThan(15);
    // Stutter depth: deeper dips between the syllables.
    const smooth = await at({ stutterDepth: 0.15 });
    const choppy = await at({ stutterDepth: 0.85 });
    const dips = (s: RenderStats) => maxDb(s, 0.65, 0.95) - minDb(s, 0.7, 0.9);
    expect(dips(choppy)).toBeGreaterThan(dips(smooth) + 12);
  });

  test("Breath's band opens on expansion and closes on contraction", async ({ page }) => {
    // Pingpong plays the wink backwards on its second pass: the close's contraction becomes
    // an expansion, with exactly the same energy, position and spread.
    const s = await stats(
      page,
      wink('breath', { seconds: 4.6, loops: 2, loopMode: 'pingpong', tailSec: 0.5 }),
    );
    const contraction = [0.6, 0.98] as const;
    const expansion = [3.42, 3.8] as const;
    expect(centroid(s, ...expansion)).toBeGreaterThan(centroid(s, ...contraction) * 1.3);
    // The inhale swells.
    expect(maxDb(s, ...expansion)).toBeGreaterThan(maxDb(s, ...contraction) + 2);
    // On the wink itself, the close (gathering) sounds darker than the open.
    const w = await stats(page, wink('breath', { seconds: 2.4 }));
    expect(centroid(w, 0.65, 0.95)).toBeLessThan(centroid(w, 1.2, 1.5) * 0.9);
  });

  test("Breath's properties do what their labels say", async ({ page }) => {
    const at = (props: Record<string, number>) =>
      stats(page, wink('breath', { seconds: 2.4, props }));
    // Viscosity: darker and slower to swell.
    const thin = await at({ viscosity: 0.15 });
    const thick = await at({ viscosity: 0.85 });
    expect(centroid(thick, 0.6, 1.6)).toBeLessThan(centroid(thin, 0.6, 1.6) * 0.9);
    const swell = (s: RenderStats) => {
      const target = maxDb(s, 0.6, 1.0) - 6;
      const i = s.rmsEnvelope.findIndex((x) => dB(x) >= target);
      return i * s.hopSec;
    };
    expect(swell(thick)).toBeGreaterThan(swell(thin) + 0.02);
    // Elasticity: a narrower band that whistles at the top.
    const loose = await at({ elasticity: 0.15 });
    const springy = await at({ elasticity: 0.85 });
    expect(voicedShare(loose, 0.6, 1.6)).toBeLessThan(0.05);
    expect(voicedShare(springy, 0.6, 1.6)).toBeGreaterThan(0.3);
    expect(centroid(springy, 0.6, 1.6)).toBeLessThan(centroid(loose, 0.6, 1.6) * 0.85);
    // Persistence: a longer tail.
    const short = await at({ persistence: 0.15 });
    const long = await at({ persistence: 0.85 });
    expect(energyDb(long, 1.6, 2.2)).toBeGreaterThan(energyDb(short, 1.6, 2.2) + 10);
    // Dispersion: a broader band of air.
    const narrow = await at({ dispersion: 0.15 });
    const wide = await at({ dispersion: 0.85 });
    expect(centroid(wide, 0.6, 1.6)).toBeGreaterThan(centroid(narrow, 0.6, 1.6) * 1.04);
    // Brightness: higher and airier.
    const dark = await at({ brightness: 0.15 });
    const bright = await at({ brightness: 0.85 });
    expect(centroid(bright, 0.6, 1.6)).toBeGreaterThan(centroid(dark, 0.6, 1.6) * 1.8);
    // Intensity: louder.
    const soft = await at({ intensity: 0.15 });
    const loud = await at({ intensity: 0.85 });
    expect(dB(loud.rms) - dB(soft.rms)).toBeGreaterThan(15);
    // Formant: "ah" is more open than "oo"; both colour the plain air.
    const none = await at({ formant: 0 });
    const ah = await at({ formant: 1 });
    const oo = await at({ formant: 2 });
    expect(centroid(oo, 0.6, 1.6)).toBeLessThan(centroid(ah, 0.6, 1.6) * 0.95);
    expect(centroid(ah, 0.6, 1.6)).toBeLessThan(centroid(none, 0.6, 1.6));
  });
});
