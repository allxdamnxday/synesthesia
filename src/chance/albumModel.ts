/**
 * Album record (`.spalbum.json`, SPEC 11.3, 12.3) and the human-readable album log
 * (`ALBUM_LOG.md`). The album is both artwork and research record: set-aside tracks stay
 * in the log.
 */
import type { Composition } from '../engine/composition';
import type { AlbumSettings } from './album';

export interface Album {
  format: 'sp-album';
  version: 1;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  signature: { id: string; contentHash: string; name: string };
  settings: AlbumSettings;
  /** Note from planning (grid filled or truncated), if any. */
  note: string | null;
  /** Track compositions in album order. */
  compositionIds: string[];
  /** Composition id → last render file name. */
  renders: Record<string, string>;
}

export const ALBUM_FORMAT = 'sp-album';
export const ALBUM_VERSION = 1;

export interface AlbumLogInput {
  album: Album;
  /** Compositions in album order (missing ones are reported, not skipped silently). */
  compositions: Array<Composition | undefined>;
  /** Display name of a material by kind and id. */
  materialName: (kind: 'visual' | 'sound', id: string) => string;
  /** Property label by id (falls back to the id). */
  propertyLabel?: (id: string) => string;
  /** ISO date/time the log was written (passed in; this module never reads the clock). */
  generatedAt: string;
}

const STATUS_LABEL: Record<Composition['status'], string> = {
  draft: 'Draft',
  kept: 'Kept',
  'set-aside': 'Set aside',
};

function formatValue(value: number): string {
  return value.toFixed(2);
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/** The album log as Markdown (SPEC 12.3 step 5). */
export function formatAlbumLog(input: AlbumLogInput): string {
  const { album } = input;
  const label = input.propertyLabel ?? ((id: string) => id);
  const lines: string[] = [];
  lines.push(`# ${album.title}`);
  lines.push('');
  lines.push(`- **Signature:** ${album.signature.name} (\`${album.signature.contentHash}\`)`);
  lines.push(`- **Master seed:** ${String(album.settings.masterSeed).padStart(6, '0')}`);
  lines.push(
    `- **Pairing:** ${album.settings.strategy === 'grid' ? 'Grid (every visual × sound pair)' : 'Pure chance'}`,
  );
  lines.push(`- **Open properties per track:** ${album.settings.openCount}`);
  lines.push(`- **Tracks:** ${album.compositionIds.length}`);
  lines.push(`- **Created:** ${album.createdAt}`);
  lines.push(`- **Log written:** ${input.generatedAt}`);
  if (album.note) lines.push(`- **Note:** ${album.note}`);
  lines.push('');

  const counts = { draft: 0, kept: 0, 'set-aside': 0 };
  for (const c of input.compositions) if (c) counts[c.status]++;
  lines.push(
    `Kept ${counts.kept} · Set aside ${counts['set-aside']} · Draft ${counts.draft}. ` +
      'Set-aside tracks stay in the record.',
  );
  lines.push('');

  album.compositionIds.forEach((id, i) => {
    const c = input.compositions[i];
    const number = String(i + 1).padStart(2, '0');
    if (!c) {
      lines.push(`## ${number}. (missing composition \`${id}\`)`);
      lines.push('');
      return;
    }
    lines.push(`## ${number}. ${c.name}`);
    lines.push('');
    lines.push(`| | |`);
    lines.push(`|---|---|`);
    lines.push(`| Status | ${STATUS_LABEL[c.status]} |`);
    lines.push(
      `| Visual material | ${escapeCell(input.materialName('visual', c.visual.materialId))} |`,
    );
    lines.push(
      `| Sound material | ${escapeCell(input.materialName('sound', c.sound.materialId))} |`,
    );
    const open = c.chance?.openProperties ?? [];
    lines.push(`| Open properties | ${open.length ? open.map(label).join(', ') : 'None'} |`);
    const overrides = c.chance?.overrides ?? [];
    lines.push(`| Overrides | ${overrides.length ? overrides.map(label).join(', ') : 'None'} |`);
    lines.push(`| Seed | ${String(c.seed).padStart(6, '0')} |`);
    lines.push(`| Render | ${escapeCell(album.renders[c.id] ?? 'Not rendered')} |`);
    lines.push('');
    const visualValues = Object.entries(c.visual.properties)
      .map(([k, v]) => `${label(k)} ${formatValue(v)}`)
      .join(', ');
    const soundValues = Object.entries(c.sound.properties)
      .map(([k, v]) => `${label(k)} ${formatValue(v)}`)
      .join(', ');
    lines.push(
      `**Final values.** Visual: ${visualValues || 'baseline'}. Sound: ${soundValues || 'baseline'}.`,
    );
    lines.push('');
    lines.push(`**Notes.** ${c.notes.trim() ? c.notes.trim() : '(none)'}`);
    lines.push('');
  });
  return lines.join('\n');
}
