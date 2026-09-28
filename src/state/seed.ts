import { SEED_SPACE } from '../chance/prng';

/**
 * Pick a new 6-digit seed (SPEC 12.1). crypto.getRandomValues is the only allowed source
 * of entropy and is used solely to pick a seed; everything downstream is deterministic.
 * Lives outside the deterministic folders on purpose.
 */
export function newSeed(): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return (buffer[0] ?? 0) % SEED_SPACE;
}

/** Seeds are shown as six digits, e.g. 004217. */
export function formatSeed(seed: number): string {
  return String(Math.max(0, Math.trunc(seed)) % SEED_SPACE).padStart(6, '0');
}

/** Parse what a person typed into a seed field; null if it isn't a 6-digit number. */
export function parseSeed(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,6}$/.test(trimmed)) return null;
  return Number(trimmed);
}
