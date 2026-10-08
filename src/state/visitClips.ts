/**
 * The clips brought in during this visit, kept so the Studio can lay a clip over the wake
 * it left (SPEC 6.3 "Clip layer"). Held in memory only, by the signature's content hash:
 * nothing is stored, so a reload or a new visit starts with none. A `File` is a handle to
 * the file on disk, not a copy of it.
 */
const clips = new Map<string, File>();

/** Remember the clip a signature was made from, for as long as this page stays open. */
export function keepClipForVisit(contentHash: string, file: File): void {
  clips.set(contentHash, file);
}

/** The clip this signature was made from, if it was brought in during this visit. */
export function clipForVisit(contentHash: string): File | null {
  return clips.get(contentHash) ?? null;
}

/** Let go of a clip that can't be played any more (its file moved or changed). */
export function forgetVisitClip(contentHash: string): void {
  clips.delete(contentHash);
}

/** For tests. */
export function clearVisitClips(): void {
  clips.clear();
}
