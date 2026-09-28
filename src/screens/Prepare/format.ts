/** Plain-language formatting for Prepare (pure; tested in tests/unit/prepare-format.test.ts). */
import { UNTITLED_SIGNATURE } from '../../library/signatures';

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Clip time with hundredths of a second, e.g. "0:01.27" or "1:05.00". */
export function formatClipTime(seconds: number): string {
  const s = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const hundredths = Math.round(s * 100);
  const minutes = Math.floor(hundredths / 6000);
  const rest = hundredths - minutes * 6000;
  return `${minutes}:${pad2(Math.floor(rest / 100))}.${pad2(rest % 100)}`;
}

/** Longest signature name the Library shows comfortably. */
export const MAX_NAME_LENGTH = 120;

/**
 * A signature name from a clip's file name: no folders, no extension, underscores as
 * spaces. "IMG_1234.MOV" → "IMG 1234"; "left-eye wink.mp4" → "left-eye wink".
 */
export function nameFromFileName(fileName: string): string {
  const base = fileName.replace(/^.*[\\/]/, '');
  const stem = base.replace(/\.[^.]*$/, '');
  const name = stem.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
  return name === '' ? UNTITLED_SIGNATURE : name.slice(0, MAX_NAME_LENGTH).trim();
}

/** Playback speed: "1×", "0.25×", "1.5×". */
export function formatSpeed(speed: number): string {
  const v = Number.isFinite(speed) ? speed : 1;
  return `${Number(v.toFixed(2))}×`;
}

/** Whole seconds in words: "1 second", "12 seconds", "1 min 5 s". */
export function describeSeconds(seconds: number): string {
  const s = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));
  if (s < 60) return `${s} ${s === 1 ? 'second' : 'seconds'}`;
  const minutes = Math.floor(s / 60);
  const rest = s - minutes * 60;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}

/** "1 moment of sudden movement", "3 moments of sudden movement", "No sudden movement". */
export function describeOnsets(count: number): string {
  if (count <= 0) return 'No moments of sudden movement';
  return `${count} ${count === 1 ? 'moment' : 'moments'} of sudden movement`;
}
