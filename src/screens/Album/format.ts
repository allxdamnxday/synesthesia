/** Plain-language text for the album screens. */
import type { Album } from '../../chance/albumModel';
import type { CompositionStatus } from '../../engine/composition';
import { propertyLabel, type TrackCounts } from '../../library';
import { formatSeed } from '../../state/seed';
import { countOf } from '../Library/format';

export const STATUS_OPTIONS: ReadonlyArray<{ value: CompositionStatus; label: string }> = [
  { value: 'draft', label: 'Draft' },
  { value: 'kept', label: 'Kept' },
  { value: 'set-aside', label: 'Set aside' },
];

export function statusLabel(status: CompositionStatus): string {
  return STATUS_OPTIONS.find((o) => o.value === status)?.label ?? 'Draft';
}

/** "25 tracks · 3 kept · 2 set aside · 20 draft" (and missing tracks, when there are any). */
export function countsLine(counts: TrackCounts): string {
  const total = counts.draft + counts.kept + counts.setAside + counts.missing;
  const parts = [
    countOf(total, 'track', 'tracks'),
    `${counts.kept} kept`,
    `${counts.setAside} set aside`,
    `${counts.draft} draft`,
  ];
  if (counts.missing > 0) parts.push(`${counts.missing} missing`);
  return parts.join(' · ');
}

/** The album's recipe: signature, master seed, pairing and open properties. */
export function albumRecipe(album: Album, signatureName: string): string[] {
  const s = album.settings;
  return [
    `From “${signatureName}”`,
    `master seed ${formatSeed(s.masterSeed)}`,
    s.strategy === 'grid' ? 'every pairing once' : 'pure chance',
    `${countOf(s.openCount, 'open property', 'open properties')} per track${s.chooseValues ? ', values by chance' : ''}`,
  ];
}

/** Shared property labels, e.g. "Viscosity, Persistence". */
export function propertyList(ids: readonly string[]): string {
  return ids.map(propertyLabel).join(', ');
}

/** The first line of a track's notes, shortened: what the track list shows. */
export function notesPreview(notes: string, max = 140): string {
  const line = notes
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l !== '');
  if (!line) return '';
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** "45 s", "6 min 12 s", "1 h 3 min". */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total} s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) {
    const seconds = total % 60;
    return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} s`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** "about 3 min left", "less than a minute left". */
export function formatRemaining(ms: number): string {
  if (ms < 60_000) return 'less than a minute left';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `about ${minutes} min left`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `about ${hours} h left` : `about ${hours} h ${rest} min left`;
}
