/** The New album form (SPEC 12.3 step 1): its starting values, checks and live summary. */
import { ALBUM_LIMITS, planAlbum, type PairingStrategy } from '../../chance/album';
import {
  UNTITLED_ALBUM,
  defaultPools,
  materialChoiceInfo,
  normalizeAlbumSettings,
  type AlbumMaterials,
  type AlbumSettings,
} from '../../library';
import { formatSeed, parseSeed } from '../../state/seed';
import { countOf } from '../Library/format';

export interface NewAlbumForm {
  title: string;
  /** As typed. */
  trackText: string;
  /** As typed: up to six digits. */
  seedText: string;
  visualPool: string[];
  soundPool: string[];
  /** K open properties per track: 1–3. */
  openCount: number;
  strategy: PairingStrategy;
  chooseValues: boolean;
}

export const OPEN_COUNTS = [1, 2, 3] as const;

export const PAIRING_OPTIONS: ReadonlyArray<{
  value: PairingStrategy;
  label: string;
  description: string;
}> = [
  {
    value: 'chance',
    label: 'Pure chance',
    description:
      'Each track draws its own visual and sound material, so some pairings may come up twice and others not at all.',
  },
  {
    value: 'grid',
    label: 'Every pairing once',
    description: 'Every visual and sound pairing appears once, in an order chance decides.',
  },
];

export const FORM_MESSAGES = {
  tracks: `Choose from ${ALBUM_LIMITS.minTracks} to ${ALBUM_LIMITS.maxTracks} tracks.`,
  seed: 'A seed is six digits, from 000000 to 999999.',
  materials: 'Choose at least one visual and one sound material.',
} as const;

export function defaultAlbumTitle(signatureName: string): string {
  const name = signatureName.trim();
  return name === '' ? UNTITLED_ALBUM : `${name} album`;
}

/** Every material eligible except the Signature view; grid pairing; two open properties. */
export function initialForm(
  signatureName: string,
  seed: number,
  materials: AlbumMaterials,
): NewAlbumForm {
  return {
    title: defaultAlbumTitle(signatureName),
    trackText: String(ALBUM_LIMITS.defaultTracks),
    seedText: formatSeed(seed),
    ...defaultPools(materials),
    openCount: 2,
    strategy: 'grid',
    chooseValues: false,
  };
}

/** A whole number of tracks from 1 to 40, or null. */
export function parseTrackCount(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,3}$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return n >= ALBUM_LIMITS.minTracks && n <= ALBUM_LIMITS.maxTracks ? n : null;
}

export interface FormCheck {
  /** The album's settings, or null while something needs fixing. */
  settings: AlbumSettings | null;
  errors: { tracks?: string; seed?: string; materials?: string };
}

export function checkForm(form: NewAlbumForm, materials: AlbumMaterials): FormCheck {
  const trackCount = parseTrackCount(form.trackText);
  const masterSeed = parseSeed(form.seedText);
  const errors: FormCheck['errors'] = {};
  if (trackCount === null) errors.tracks = FORM_MESSAGES.tracks;
  if (masterSeed === null) errors.seed = FORM_MESSAGES.seed;
  const settings = normalizeAlbumSettings(
    {
      title: form.title,
      trackCount: trackCount ?? ALBUM_LIMITS.defaultTracks,
      masterSeed: masterSeed ?? 0,
      visualPool: form.visualPool,
      soundPool: form.soundPool,
      openCount: form.openCount,
      strategy: form.strategy,
      chooseValues: form.chooseValues,
    },
    materials,
  );
  if (settings.visualPool.length === 0 || settings.soundPool.length === 0) {
    errors.materials = FORM_MESSAGES.materials;
  }
  return { settings: Object.keys(errors).length === 0 ? settings : null, errors };
}

/** "25 tracks · every visual and sound pairing once", and so on. */
export function describeShape(
  trackCount: number,
  strategy: PairingStrategy,
  pairs: number,
): string {
  const tracks = countOf(trackCount, 'track', 'tracks');
  if (strategy === 'chance') return `${tracks} · pure chance`;
  if (pairs <= 0) return tracks;
  if (trackCount === pairs) return `${tracks} · every visual and sound pairing once`;
  if (trackCount < pairs)
    return `${tracks} · ${trackCount} of the ${pairs} visual and sound pairings`;
  if (pairs === 1) return `${tracks} · the one visual and sound pairing, each time`;
  return `${tracks} · every visual and sound pairing, then repeats`;
}

/** What chance does inside each track. */
export function describeOpen(openCount: number, chooseValues: boolean): string {
  const opens = `Each track opens ${countOf(openCount, 'property', 'properties')} for play; the rest stay at their baseline.`;
  return chooseValues ? `${opens} Chance also chooses where the open ones start.` : opens;
}

/** The note the album will carry when the grid is filled or truncated, as planning words it. */
export function planNote(settings: AlbumSettings, materials: AlbumMaterials): string | null {
  try {
    return planAlbum(settings, {
      visual: materials.visual.map(materialChoiceInfo),
      sound: materials.sound.map(materialChoiceInfo),
    }).note;
  } catch {
    return null;
  }
}
