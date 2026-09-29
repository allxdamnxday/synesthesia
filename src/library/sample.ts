/**
 * The bundled sample wink (`public/samples/sample-wink.sig.json`, the same file as the test
 * fixture): the first-run introduction and the Library's "How it works" steps both offer it
 * to someone who has no signature of their own yet.
 */
import { parseSignature } from '../signature/serialize';
import { LibraryError } from './errors';
import { importParsedSignature, type SignatureImportResult } from './signatures';

/** Where the sample lives, relative to the app (it is self-hosted and cached for offline use). */
export const SAMPLE_WINK_PATH = 'samples/sample-wink.sig.json';

const SAMPLE_MISSING =
  "The sample wink couldn't be loaded. Reload the page and try again; if it keeps happening, the Diagnostics page can help.";

/**
 * Add the sample wink to the library (or find it there already) and return its entry.
 * Throws a LibraryError with a plain message if the file can't be read.
 */
export async function importSampleWink(): Promise<SignatureImportResult> {
  const url = new URL(SAMPLE_WINK_PATH, document.baseURI);
  let response: Response;
  try {
    response = await fetch(url);
  } catch (err) {
    throw new LibraryError(SAMPLE_MISSING, `fetch ${url.pathname}: ${String(err)}`);
  }
  if (!response.ok) throw new LibraryError(SAMPLE_MISSING, `${url.pathname}: ${response.status}`);
  return importParsedSignature(parseSignature(await response.text()));
}
