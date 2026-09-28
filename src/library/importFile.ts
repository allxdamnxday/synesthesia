/**
 * The Library's Import file action: accepts signature (`.sig.json`), composition
 * (`.spcomp.json`) and album (`.spalbum.json`) files and tells them apart by their
 * contents, not their names.
 */
import { COMPOSITION_FORMAT } from '../engine/composition';
import { compositionFromJson } from '../engine/compositionSerialize';
import {
  FileFormatError,
  isJsonObject,
  parseJson,
  signatureFromJson,
} from '../signature/serialize';
import { SIGNATURE_FORMAT } from '../signature/types';
import { ALBUM_FORMAT } from '../chance/albumModel';
import { albumFromJson, importParsedAlbum, type AlbumImportResult } from './albums';
import { importParsedComposition, type CompositionImportResult } from './compositions';
import { importParsedSignature, type SignatureImportResult } from './signatures';

export type LibraryImportResult =
  SignatureImportResult | CompositionImportResult | AlbumImportResult;

export const IMPORT_MESSAGES = {
  unknown: "This file isn't a Synesthesia signature, composition or album.",
  backup: 'This is a backup. Use Restore from backup to bring it in.',
  tooLarge: "This file is too large to be a signature, composition or album, so it wasn't imported.",
} as const;

/** Far above the largest signature (60 s at 60 fps on a 32 × 48 grid is about 60 MB). */
const MAX_FILE_BYTES = 400 * 1024 * 1024;

/** Import one signature, composition or album file into the library. */
export async function importLibraryFile(file: File): Promise<LibraryImportResult> {
  if (/\.zip$/i.test(file.name)) throw new FileFormatError('wrong-kind', IMPORT_MESSAGES.backup);
  if (file.size > MAX_FILE_BYTES) {
    throw new FileFormatError('wrong-kind', IMPORT_MESSAGES.tooLarge, `${file.size} bytes`);
  }
  // Library files are JSON objects; don't read a whole video or image to find that out.
  // (trimStart also removes a byte-order mark.)
  const head = (await file.slice(0, 256).text()).trimStart();
  if (!head.startsWith('{')) {
    throw new FileFormatError('wrong-kind', IMPORT_MESSAGES.unknown, 'not a JSON object');
  }
  const raw = parseJson(await file.text());
  const format = isJsonObject(raw) ? raw.format : undefined;
  if (format === SIGNATURE_FORMAT) return importParsedSignature(signatureFromJson(raw));
  if (format === COMPOSITION_FORMAT) return importParsedComposition(compositionFromJson(raw));
  if (format === ALBUM_FORMAT) return importParsedAlbum(albumFromJson(raw));
  throw new FileFormatError(
    'wrong-kind',
    IMPORT_MESSAGES.unknown,
    `format: ${typeof format === 'string' ? format : typeof format}`,
  );
}
