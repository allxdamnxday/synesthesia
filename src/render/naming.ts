/**
 * Render file names (SPEC 10.2 step 7): `SP_{signature}_{composition}_{seed}.mp4`, each
 * name sanitized (letters, digits, dash, underscore) and the seed written as six digits.
 * A composition sidecar (`.spcomp.json`) shares the MP4's stem, so the pair sorts together.
 *
 * Renders never overwrite: when a name is taken, " (2)", " (3)", … is added to the stem.
 * Names are compared ignoring case, because macOS and Windows folders usually do, so
 * "Wink" and "wink" would be the same file there.
 */
import { sanitizeFileName } from '../engine/composition';
import { COMPOSITION_FILE_EXTENSION } from '../engine/compositionSerialize';

export const MP4_EXTENSION = '.mp4';
export const SIDECAR_EXTENSION = COMPOSITION_FILE_EXTENSION;

/** Highest " (n)" suffix tried before giving up. */
export const MAX_NAME_NUMBER = 9999;

/** A seed as the six digits people see, e.g. 4217 → "004217". */
export function seedLabel(seed: number): string {
  const n = Number.isFinite(seed) ? Math.max(0, Math.trunc(seed)) % 1_000_000 : 0;
  return String(n).padStart(6, '0');
}

/** `SP_{signature}_{composition}_{seed}`: the file name without a number or extension. */
export function renderFileStem(
  signatureName: string,
  compositionName: string,
  seed: number,
): string {
  return `SP_${sanitizeFileName(signatureName)}_${sanitizeFileName(compositionName)}_${seedLabel(seed)}`;
}

/** The stem for the n-th file of that name: n ≤ 1 → the stem itself, else "stem (n)". */
export function numberedStem(stem: string, n: number): string {
  return n <= 1 ? stem : `${stem} (${Math.trunc(n)})`;
}

/**
 * The first number n (1, 2, 3, …) for which no `numberedStem(stem, n) + extension` is
 * taken, for every extension given. `taken` holds existing names in lower case.
 * Throws if every number up to MAX_NAME_NUMBER is taken.
 */
export function firstFreeNumber(
  stem: string,
  extensions: readonly string[],
  taken: ReadonlySet<string>,
): number {
  for (let n = 1; n <= MAX_NAME_NUMBER; n++) {
    const candidate = numberedStem(stem, n);
    if (extensions.every((ext) => !taken.has(`${candidate}${ext}`.toLowerCase()))) return n;
  }
  throw new Error(`Every name from "${stem}" to "${numberedStem(stem, MAX_NAME_NUMBER)}" is taken`);
}
