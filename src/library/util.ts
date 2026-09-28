/** Small helpers for library records: ids, timestamps, names, file names. */
import { sanitizeFileName } from '../engine/composition';

/** Longest name the library stores. */
export const MAX_NAME_LENGTH = 120;

/** A new record id (uuid v4). */
export function newId(): string {
  return crypto.randomUUID();
}

/** The current time as ISO 8601 (library records only; never in deterministic code). */
export function nowIso(): string {
  return new Date().toISOString();
}

/** Collapse whitespace, trim and shorten a name; empty names become `fallback`. */
export function cleanName(name: string, fallback: string): string {
  const cleaned = name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH).trim();
  return cleaned === '' ? fallback : cleaned;
}

/** Name for a duplicate: "Wink 01" → "Wink 01 copy". */
export function copyName(name: string): string {
  const suffix = ' copy';
  return `${name.slice(0, MAX_NAME_LENGTH - suffix.length).trimEnd()}${suffix}`;
}

/** A download name such as `Wink-01.sig.json`. */
export function fileNameFor(name: string, extension: string): string {
  return `${sanitizeFileName(name)}${extension}`;
}

/** Sort newest change first; ties by name, then id, so the order is stable. */
export function byUpdatedDesc<T extends { updatedAt: string; name: string; id: string }>(
  a: T,
  b: T,
): number {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
  const byName = a.name.localeCompare(b.name);
  return byName !== 0 ? byName : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
