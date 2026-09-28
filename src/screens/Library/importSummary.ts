/** Plain-language notices for the Library's Import file action. */
import type { Composition } from '../../engine/composition';
import type { ImportOutcome } from '../../state/libraryStore';
import type { NoticeTone } from '../../ui/Notice';
import { countOf } from './format';

export interface ImportNotice {
  tone: NoticeTone;
  text: string;
  /** A composition waiting for this signature: offer to import it. */
  needs?: Composition['signature'];
}

export const signatureName = (name: string) => name || 'Untitled signature';
export const compositionName = (name: string) => name || 'Untitled composition';

/**
 * One confirmation for a whole import, then a warning per composition still waiting for
 * its signature and an error per file that couldn't be imported.
 */
export function describeImport(outcomes: readonly ImportOutcome[]): ImportNotice[] {
  const addedSignatures: string[] = [];
  const addedCompositions: string[] = [];
  const addedAlbums: string[] = [];
  const present: string[] = [];
  const importedHashes = new Set<string>();
  const waiting: ImportNotice[] = [];
  const errors: ImportNotice[] = [];
  let reconnected = 0;
  for (const outcome of outcomes) {
    if (!outcome.ok) {
      errors.push({
        tone: 'error',
        text: `“${outcome.fileName}” wasn't imported. ${outcome.message}`,
      });
      continue;
    }
    const r = outcome.result;
    if (r.kind === 'album') {
      const title = r.album.title || 'Untitled album';
      if (r.status === 'already-present') present.push(title);
      else addedAlbums.push(title);
      if (r.missingTracks > 0) {
        waiting.push({
          tone: 'warning',
          text: `The album “${title}” has ${countOf(r.missingTracks, 'track', 'tracks')} whose compositions aren't in your library. Import those compositions, or restore a backup, to play them.`,
        });
      }
      continue;
    }
    if (r.kind === 'signature') {
      importedHashes.add(r.meta.contentHash);
      if (r.status === 'already-present') {
        present.push(signatureName(r.meta.name));
      } else {
        addedSignatures.push(signatureName(r.meta.name));
        reconnected += r.reconnected;
      }
    } else if (r.status === 'already-present') {
      present.push(compositionName(r.composition.name));
    } else {
      addedCompositions.push(compositionName(r.composition.name));
      if (r.missingSignature) {
        const needs = r.missingSignature;
        waiting.push({
          tone: 'warning',
          text: `“${compositionName(r.composition.name)}” needs the signature “${signatureName(needs.name)}”, which isn't in your library yet. Import that signature file to play it.`,
          needs,
        });
      }
    }
  }

  const parts: string[] = [];
  const added = addedSignatures.length + addedCompositions.length + addedAlbums.length;
  if (added === 1) {
    parts.push(
      addedSignatures.length === 1
        ? `Added the signature “${addedSignatures[0]}”.`
        : addedCompositions.length === 1
          ? `Added the composition “${addedCompositions[0]}”.`
          : `Added the album “${addedAlbums[0]}”.`,
    );
  } else if (added > 1) {
    const kinds = [
      addedSignatures.length > 0 ? countOf(addedSignatures.length, 'signature', 'signatures') : '',
      addedCompositions.length > 0
        ? countOf(addedCompositions.length, 'composition', 'compositions')
        : '',
      addedAlbums.length > 0 ? countOf(addedAlbums.length, 'album', 'albums') : '',
    ].filter(Boolean);
    parts.push(`Added ${kinds.join(' and ')}.`);
  }
  if (reconnected > 0) {
    parts.push(
      `${countOf(reconnected, 'composition that was waiting', 'compositions that were waiting')} can play again.`,
    );
  }
  if (present.length === 1) {
    parts.push(`“${present[0]}” is already in your library.`);
  } else if (present.length > 1) {
    parts.push(`${present.length} of them were already in your library.`);
  }

  const notices: ImportNotice[] = [];
  if (parts.length > 0) {
    notices.push({ tone: added > 0 ? 'success' : 'info', text: parts.join(' ') });
  }
  // A signature later in the same import may already have answered a composition's need.
  notices.push(...waiting.filter((n) => !(n.needs && importedHashes.has(n.needs.contentHash))));
  return [...notices, ...errors];
}
