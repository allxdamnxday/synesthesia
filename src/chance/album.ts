/**
 * Album planning (SPEC 12.3). An album is an ordered set of draft compositions drawn from
 * one signature. The same master seed and settings produce identical drafts on any
 * machine: every choice comes from the seeded PRNG.
 */
import type { MaterialChoiceInfo } from './draw';
import { drawByChance } from './draw';
import { createRng, hash32, shuffleInPlace, toDisplaySeed } from './prng';

export type PairingStrategy = 'chance' | 'grid';

export interface AlbumSettings {
  title: string;
  /** 1–40, default 25. */
  trackCount: number;
  /** 0–999999 */
  masterSeed: number;
  visualPool: string[];
  soundPool: string[];
  /** K open properties per track, 1–3. */
  openCount: number;
  strategy: PairingStrategy;
  /** Chance also chooses values for the open properties. */
  chooseValues: boolean;
}

export const ALBUM_LIMITS = { minTracks: 1, maxTracks: 40, defaultTracks: 25 } as const;

export interface AlbumTrackPlan {
  /** 1-based position in the album. */
  index: number;
  /** "01", "02", … */
  name: string;
  /** hash32(masterSeed, index), shown as 6 digits. */
  seed: number;
  visualId: string;
  soundId: string;
  openProperties: string[];
  values: Record<string, number> | null;
}

export interface AlbumPlan {
  tracks: AlbumTrackPlan[];
  /** Plain-language note when the grid had to be filled or truncated. */
  note: string | null;
}

/** Per-track seed (SPEC 12.1): hash32(masterSeed, index), as a 6-digit seed. */
export function trackSeed(masterSeed: number, index: number): number {
  return toDisplaySeed(hash32(masterSeed, index));
}

export function trackName(index: number, total: number): string {
  return String(index).padStart(Math.max(2, String(total).length), '0');
}

const GRID_SALT = 0x6121d;

/**
 * Plan every track. `materials` describes the eligible materials (ids and the shared
 * properties each uses); pools in `settings` select which are eligible.
 */
export function planAlbum(
  settings: AlbumSettings,
  materials: { visual: readonly MaterialChoiceInfo[]; sound: readonly MaterialChoiceInfo[] },
): AlbumPlan {
  const count = Math.max(
    ALBUM_LIMITS.minTracks,
    Math.min(ALBUM_LIMITS.maxTracks, Math.round(settings.trackCount)),
  );
  const visualPool = materials.visual.filter((m) => settings.visualPool.includes(m.id));
  const soundPool = materials.sound.filter((m) => settings.soundPool.includes(m.id));
  if (visualPool.length === 0 || soundPool.length === 0) {
    throw new Error('Choose at least one visual and one sound material for the album.');
  }

  const tracks: AlbumTrackPlan[] = [];
  let note: string | null = null;

  if (settings.strategy === 'chance') {
    for (let index = 1; index <= count; index++) {
      const seed = trackSeed(settings.masterSeed, index);
      const draw = drawByChance({
        seed,
        visualPool,
        soundPool,
        openCount: settings.openCount,
        chooseValues: settings.chooseValues,
      });
      tracks.push({ index, name: trackName(index, count), seed, ...draw });
    }
    return { tracks, note };
  }

  // Grid: every eligible visual × sound pair exactly once per cycle, in seeded order.
  const pairs: Array<[MaterialChoiceInfo, MaterialChoiceInfo]> = [];
  for (const v of visualPool) for (const s of soundPool) pairs.push([v, s]);
  const order: Array<[MaterialChoiceInfo, MaterialChoiceInfo]> = [];
  let cycle = 0;
  while (order.length < count) {
    const rng = createRng(hash32(settings.masterSeed, GRID_SALT, cycle));
    order.push(...shuffleInPlace(rng, pairs.slice()));
    cycle++;
  }
  const pairWord = pairs.length === 1 ? 'pairing' : 'pairings';
  if (count < pairs.length) {
    note = `There are ${pairs.length} ${pairWord}; the album keeps the first ${count} in their chance order.`;
  } else if (count > pairs.length) {
    note = `There ${pairs.length === 1 ? 'is' : 'are'} ${pairs.length} ${pairWord}; after each has appeared once, they repeat in a new chance order to reach ${count} tracks.`;
  }
  for (let index = 1; index <= count; index++) {
    const pair = order[index - 1];
    if (!pair) break;
    const [visual, sound] = pair;
    const seed = trackSeed(settings.masterSeed, index);
    // Open properties (and values) still come from chance, restricted to this pair.
    const draw = drawByChance({
      seed,
      visualPool: [visual],
      soundPool: [sound],
      openCount: settings.openCount,
      chooseValues: settings.chooseValues,
    });
    tracks.push({ index, name: trackName(index, count), seed, ...draw });
  }
  return { tracks, note };
}
