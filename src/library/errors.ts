/**
 * Library errors carry a plain-language `message` for the artist (what happened and
 * what to do next) and an optional technical `detail` for the console and Diagnostics.
 */
import { FileFormatError } from '../signature/serialize';

export class LibraryError extends Error {
  readonly detail: string | undefined;

  constructor(message: string, detail?: string) {
    super(message);
    this.name = 'LibraryError';
    this.detail = detail;
  }
}

export const MESSAGES = {
  notFound: "That item isn't in your library any more. It may have been deleted in another window.",
  tampered:
    'This signature file has been changed or damaged since it was exported, so it was not imported. Export it again from the original.',
  wrongSignature:
    "This is a different signature from the one the composition needs, so it wasn't imported.",
  quota:
    "There isn't enough storage space left. Free up some space on this computer, then try again.",
  versionChanged: 'Your library was updated in another window. Reload this page to keep working.',
  unavailable:
    "Your library couldn't be opened. Close other Synesthesia windows and reload this page. If that doesn't help, the Diagnostics page can show what's wrong.",
  generic: 'Something went wrong. Try again; if it keeps happening, the Diagnostics page can help.',
} as const;

/** A sentence the UI can show for any error. */
export function userMessage(err: unknown): string {
  if (err instanceof LibraryError || err instanceof FileFormatError) return err.message;
  if (err instanceof DOMException) {
    if (err.name === 'QuotaExceededError') return MESSAGES.quota;
    if (err.name === 'VersionError') return MESSAGES.versionChanged;
    if (err.name === 'InvalidStateError' || err.name === 'UnknownError') {
      return MESSAGES.unavailable;
    }
  }
  return MESSAGES.generic;
}

/** Technical description for the console or a Diagnostics report. */
export function errorDetail(err: unknown): string {
  if (err instanceof LibraryError || err instanceof FileFormatError) {
    return err.detail ? `${err.message} (${err.detail})` : err.message;
  }
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}
