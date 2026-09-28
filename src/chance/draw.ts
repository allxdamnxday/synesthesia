/**
 * Draw by chance (SPEC 12.2). From one seed, chance picks a visual material and a sound
 * material from the eligible pool, and opens K shared properties for play; every other
 * property stays locked at its baseline. Optionally it also chooses values for the open
 * properties.
 *
 * Interpretation (logged in docs/DECISIONS.md, to confirm with Freeman): open properties
 * are drawn from the shared properties that at least one of the two chosen materials
 * actually uses, so chance never opens a property that does nothing.
 */
import { SHARED_PROPERTY_IDS } from '../materials/properties';
import { createRng, hash32, randomInt, sampleWithoutReplacement } from './prng';

export interface MaterialChoiceInfo {
  id: string;
  /** Shared property ids this material uses. */
  sharedIds: readonly string[];
}

export interface DrawOptions {
  seed: number;
  visualPool: readonly MaterialChoiceInfo[];
  soundPool: readonly MaterialChoiceInfo[];
  /** K open properties: 1–3 (SPEC default 2). */
  openCount: number;
  /** Also choose seeded values (0–1) for the open properties. */
  chooseValues: boolean;
}

export interface DrawResult {
  visualId: string;
  soundId: string;
  /** Open (playable) shared properties, in vocabulary order. */
  openProperties: string[];
  /** Values for the open properties, when `chooseValues` was on. */
  values: Record<string, number> | null;
}

/** Salt so a draw's stream differs from other uses of the same seed. */
const DRAW_SALT = 0x0d1ce;

export function drawByChance(options: DrawOptions): DrawResult {
  if (options.visualPool.length === 0 || options.soundPool.length === 0) {
    throw new Error('Chance needs at least one eligible visual and one eligible sound material.');
  }
  const rng = createRng(hash32(options.seed, DRAW_SALT));
  const visual = options.visualPool[randomInt(rng, options.visualPool.length)];
  const sound = options.soundPool[randomInt(rng, options.soundPool.length)];
  if (!visual || !sound) throw new Error('Chance could not pick materials.');

  const used = new Set([...visual.sharedIds, ...sound.sharedIds]);
  const candidates = SHARED_PROPERTY_IDS.filter((id) => used.has(id));
  const k = Math.max(1, Math.min(3, Math.round(options.openCount)));
  const drawn = new Set(sampleWithoutReplacement(rng, candidates, k));
  const openProperties = SHARED_PROPERTY_IDS.filter((id) => drawn.has(id));

  let values: Record<string, number> | null = null;
  if (options.chooseValues) {
    values = {};
    for (const id of openProperties) values[id] = Math.round(rng() * 100) / 100;
  }
  return { visualId: visual.id, soundId: sound.id, openProperties, values };
}
