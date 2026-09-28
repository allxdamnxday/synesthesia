/**
 * A clip dropped outside the Prepare screen, handed to Prepare as it opens. Held in memory
 * only for that moment; it is never stored and never shown anywhere but Prepare.
 */
let pending: File | null = null;

export function setPendingClip(file: File): void {
  pending = file;
}

export function takePendingClip(): File | null {
  const file = pending;
  pending = null;
  return file;
}

const CLIP_EXTENSIONS = /\.(mp4|m4v|mov|webm|mkv|avi|3gp)$/i;

export function looksLikeClip(file: File): boolean {
  return file.type.startsWith('video/') || CLIP_EXTENSIONS.test(file.name);
}
